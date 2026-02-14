import { NextResponse } from 'next/server'
import { db, evalSets, evalCases, evalRuns, evalResults, evalScores, evalCriteria } from '@/lib/db'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'

// Import from CLI code
import { runAgent } from '../../../../src/data/glean'
import { judgeResponse } from '../../../../src/lib/judge'
import { getCriterion } from '../../../../src/criteria/defaults'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { evalSetId, criteria = ['task_success', 'factuality', 'relevance'], judgeModel = 'glean-chat' } = body

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

    // Get criteria
    const criteriaObjs = criteria.map(id => {
      const criterion = getCriterion(id)
      if (!criterion) throw new Error(`Unknown criterion: ${id}`)
      return criterion
    })

    // Create run
    let runId = nanoid(12)
    while (runId.startsWith('-')) {
      runId = nanoid(12)
    }

    await db.insert(evalRuns).values({
      id: runId,
      evalSetId,
      status: 'running',
      startedAt: new Date(),
      completedAt: null,
      config: JSON.stringify({ criteria, judgeModel })
    })

    // Process cases (async - don't block response)
    processCases(runId, set.agentId, cases, criteriaObjs, judgeModel).catch(console.error)

    return NextResponse.json({ runId, status: 'started' })
  } catch (error) {
    console.error('Error starting evaluation:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to start evaluation' },
      { status: 500 }
    )
  }
}

async function processCases(runId: string, agentId: string, cases: any[], criteria: any[], judgeModel: string) {
  const results: any[] = []

  for (const testCase of cases) {
    try {
      // Run agent
      const agentResult = await runAgent(agentId, testCase.query, testCase.id)

      // Judge each criterion
      const scores: any[] = []
      for (const criterion of criteria) {
        const score = await judgeResponse(
          criterion,
          testCase.query,
          agentResult.response,
          agentResult,
          testCase.expectedAnswer || undefined,
          judgeModel
        )
        scores.push(score)
      }

      // Calculate overall score (average of scored criteria, excluding metrics)
      const scoredValues = scores
        .filter(s => s.scoreValue !== null && s.scoreValue !== undefined)
        .map(s => s.scoreValue!)
      const overallScore = scoredValues.length > 0
        ? scoredValues.reduce((sum, val) => sum + val, 0) / scoredValues.length
        : 0

      // Store result
      let resultId = nanoid(12)
      while (resultId.startsWith('-')) {
        resultId = nanoid(12)
      }

      await db.insert(evalResults).values({
        id: resultId,
        runId,
        caseId: testCase.id,
        agentResponse: agentResult.response,
        latencyMs: agentResult.latencyMs,
        totalTokens: agentResult.totalTokens || null,
        toolCalls: JSON.stringify(agentResult.toolCalls || []),
        overallScore,
        timestamp: new Date()
      })

      // Store individual scores
      for (const score of scores) {
        let scoreId = nanoid(12)
        while (scoreId.startsWith('-')) {
          scoreId = nanoid(12)
        }

        await db.insert(evalScores).values({
          id: scoreId,
          resultId,
          criterionId: score.criterionId,
          scoreValue: score.scoreValue,
          scoreCategory: score.scoreCategory || null,
          reasoning: score.reasoning,
          judgeModel,
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
