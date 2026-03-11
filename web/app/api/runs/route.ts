import { NextResponse } from 'next/server'
import { db, evalSets, evalCases, evalCriteria, evalRuns, evalResults, evalScores } from '@/lib/db'
import { eq, inArray } from 'drizzle-orm'

// Import from CLI code
import { runAgent, runMultiTurnAgent, getAgentType } from '../../../../src/data/glean'
import { judgeResponseBatch, JUDGE_MODELS } from '../../../../src/lib/judge'
import { getCriterion } from '../../../../src/criteria/defaults'
import { generateId } from '../../../../src/lib/id'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const {
      evalSetId,
      criteria = ['topical_coverage', 'response_quality', 'groundedness', 'hallucination_risk'],
      judges = ['OPUS_4_6_VERTEX'],
      mode = 'quick',
      multiTurn = false,
      maxTurns = 5,
    } = body

    if (!evalSetId) {
      return NextResponse.json({ error: 'Missing eval set ID' }, { status: 400 })
    }

    // Get eval set
    const sets = await db.select().from(evalSets).where(eq(evalSets.id, evalSetId))
    if (sets.length === 0) {
      return NextResponse.json({ error: 'Eval set not found' }, { status: 404 })
    }
    const set = sets[0]

    // Get test cases
    const cases = await db.select().from(evalCases).where(eq(evalCases.evalSetId, evalSetId))
    if (cases.length === 0) {
      return NextResponse.json({ error: 'No test cases found' }, { status: 400 })
    }

    // Resolve criteria definitions (defaults + custom from DB)
    const criteriaObjs = await Promise.all(criteria.map(async (id: string) => {
      const criterion = getCriterion(id)
      if (criterion) return criterion

      // Check DB for custom criteria
      const custom = await db.select().from(evalCriteria).where(eq(evalCriteria.id, id)).limit(1)
      if (custom[0]) {
        const scale = custom[0].scaleConfig ? JSON.parse(custom[0].scaleConfig) : undefined
        return {
          id: custom[0].id,
          name: custom[0].name,
          description: custom[0].description || '',
          rubric: custom[0].rubric,
          scoreType: custom[0].scoreType as 'categorical' | 'binary' | 'metric',
          judgeCall: 'custom' as const,
          scaleConfig: scale,
          weight: custom[0].weight,
        }
      }

      throw new Error(`Unknown criterion: ${id}`)
    }))

    // Detect agent type for routing
    const agentType = await getAgentType(set.agentId)

    // Create run
    const runId = generateId()

    await db.insert(evalRuns).values({
      id: runId,
      evalSetId,
      status: 'running',
      startedAt: new Date(),
      completedAt: null,
      config: JSON.stringify({
        criteria,
        judgeModel: judges.length > 1
          ? 'ensemble'
          : JUDGE_MODELS.find(m => m.id === judges[0])?.displayName || judges[0],
        judges,
        mode,
        multiJudge: judges.length > 1,
        multiTurn,
        maxTurns,
        agentType,
      })
    })

    // Process cases (async - don't block response)
    processCases(runId, set.agentId, cases, criteriaObjs, judges, multiTurn, maxTurns, agentType).catch(console.error)

    return NextResponse.json({ runId, status: 'started' })
  } catch (error) {
    console.error('Error starting evaluation:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to start evaluation' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json()
    const { evalSetId } = body

    if (!evalSetId) {
      return NextResponse.json({ error: 'Missing eval set ID' }, { status: 400 })
    }

    // 1. Get all run IDs for this eval set
    const runs = await db.select({ id: evalRuns.id }).from(evalRuns).where(eq(evalRuns.evalSetId, evalSetId))
    const runIds = runs.map(r => r.id)

    if (runIds.length === 0) {
      return NextResponse.json({ deleted: 0 })
    }

    // 2. Get all result IDs for those runs
    const results = await db.select({ id: evalResults.id }).from(evalResults).where(inArray(evalResults.runId, runIds))
    const resultIds = results.map(r => r.id)

    // 3. Cascade delete: scores → results → runs
    if (resultIds.length > 0) {
      await db.delete(evalScores).where(inArray(evalScores.resultId, resultIds))
      await db.delete(evalResults).where(inArray(evalResults.runId, runIds))
    }
    await db.delete(evalRuns).where(eq(evalRuns.evalSetId, evalSetId))

    return NextResponse.json({ deleted: runIds.length })
  } catch (error) {
    console.error('Error clearing runs:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to clear runs' },
      { status: 500 }
    )
  }
}

async function processCases(
  runId: string,
  agentId: string,
  cases: any[],
  criteria: any[],
  judgeModelIds: string[],
  multiTurn: boolean = false,
  maxTurns: number = 5,
  agentType: string = 'workflow',
) {
  const results: any[] = []

  for (const testCase of cases) {
    try {
      // 1. Run agent — multi-turn or single-turn based on config + agent type
      const caseMetadata = testCase.metadata ? JSON.parse(testCase.metadata) : null
      const structuredFields = caseMetadata?.fields as Record<string, string> | undefined
      const useMultiTurn = multiTurn && agentType === 'autonomous'

      const agentResult = useMultiTurn
        ? await runMultiTurnAgent(agentId, testCase.query, testCase.id, {
            maxTurns,
            evalGuidance: testCase.evalGuidance || undefined,
            simulatorContext: caseMetadata?.simulatorContext,
            simulatorStrategy: caseMetadata?.simulatorStrategy,
          })
        : await runAgent(agentId, testCase.query, testCase.id, structuredFields)

      // 2. Judge (batched by call type — coverage, quality, faithfulness, factuality)
      const scores = await judgeResponseBatch(
        criteria,
        testCase.query,
        agentResult.response,
        agentResult,
        testCase.evalGuidance || undefined,
        judgeModelIds,
      )

      // 3. Calculate overall score (weighted average, converting categories to numeric)
      // Skipped dimensions are excluded from aggregation (no weight contributed)
      let totalWeightedScore = 0
      let totalWeight = 0

      for (const score of scores) {
        const criterion = getCriterion(score.criterionId)
        if (!criterion || criterion.scoreType === 'metric') continue
        if (score.scoreCategory === 'skipped') continue

        let numericValue: number | undefined
        if (score.scoreValue !== undefined) {
          // Binary scores: 0 or 1, scale to 0-10
          numericValue = score.scoreValue * 10
        } else if (score.scoreCategory && criterion.scaleConfig?.categoryValues) {
          // Categorical scores: map to numeric via categoryValues
          numericValue = criterion.scaleConfig.categoryValues[score.scoreCategory.toLowerCase()] ?? 0
        }

        if (numericValue !== undefined) {
          totalWeightedScore += numericValue * criterion.weight
          totalWeight += criterion.weight
        }
      }

      const overallScore = totalWeight > 0 ? totalWeightedScore / totalWeight : 0

      // 4. Store result
      const resultId = generateId()

      await db.insert(evalResults).values({
        id: resultId,
        runId,
        caseId: testCase.id,
        agentResponse: agentResult.response,
        agentTrace: agentResult.reasoningChain ? JSON.stringify(agentResult.reasoningChain) : null,
        transcript: agentResult.transcript ? JSON.stringify(agentResult.transcript) : null,
        latencyMs: agentResult.latencyMs,
        totalTokens: null, // Not available via REST API
        toolCalls: JSON.stringify(agentResult.toolCalls || []),
        overallScore,
        timestamp: new Date()
      })

      // 5. Store individual scores
      for (const score of scores) {
        await db.insert(evalScores).values({
          id: generateId(),
          resultId,
          criterionId: score.criterionId,
          scoreValue: score.scoreValue !== undefined ? score.scoreValue : null,
          scoreCategory: score.scoreCategory || null,
          reasoning: score.reasoning,
          judgeModel: score.judgeModel || null,
          timestamp: new Date()
        })
      }

      results.push({ caseId: testCase.id, overallScore })
    } catch (error) {
      console.error(`Error processing case ${testCase.id}:`, error)
    }
  }

  // Update run as completed
  await db.update(evalRuns)
    .set({
      status: 'completed',
      completedAt: new Date()
    })
    .where(eq(evalRuns.id, runId))
}
