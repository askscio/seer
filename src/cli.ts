#!/usr/bin/env bun

/**
 * Seer CLI - Agent evaluation framework
 *
 * Full parity with Web UI — every operation is non-interactive
 * when --yes flag is used, enabling agentic orchestration.
 */

import { program } from 'commander'
import { eq, inArray } from 'drizzle-orm'
import { generateId } from './lib/id'
import { db, initializeDB } from './db/index'
import { evalSets, evalCases, evalRuns, evalResults, evalScores, evalCriteria } from './db/schema'
import { runAgent } from './data/glean'
import { judgeResponseBatch, JUDGE_MODELS } from './lib/judge'
import { DEFAULT_CRITERIA, getCriterion } from './criteria/defaults'
import { smartGenerate } from './lib/generate-agent'
import { fetchAgentInfo } from './lib/fetch-agent'
import { config } from './lib/config'
import { readFileSync } from 'fs'
import type { JudgeScore } from './types'
import type { CriterionDefinition } from './criteria/defaults'
import * as readline from 'readline'

// Initialize database before running commands
await initializeDB()

program
  .name('seer')
  .description('Agent evaluation framework with LLM-as-judge')
  .version('0.1.0')

// ===== Agent Commands =====

program
  .command('agent-info <agent-id>')
  .description('Fetch and display agent details from Glean')
  .action(async (agentId) => {
    try {
      const agentInfo = await fetchAgentInfo(agentId)
      if (!agentInfo) {
        console.error(`Agent ${agentId} not found`)
        process.exit(1)
      }

      console.log(`\n=== Agent Info ===`)
      console.log(`ID:          ${agentInfo.agent_id}`)
      console.log(`Name:        ${agentInfo.name}`)
      console.log(`Description: ${agentInfo.description || '(none)'}`)

      // Also fetch schema
      const schemaResp = await fetch(
        `${config.gleanBackend}/rest/api/v1/agents/${agentId}/schemas`,
        { headers: { 'Authorization': `Bearer ${config.gleanApiKey}` } }
      )

      if (schemaResp.ok) {
        const schema = await schemaResp.json() as any
        const inputFields = Object.keys(schema.input_schema || {})
        console.log(`Type:        ${inputFields.length > 0 ? 'Form-based' : 'Chat-style'}`)
        if (inputFields.length > 0) {
          console.log(`Fields:`)
          for (const [field, cfg] of Object.entries(schema.input_schema)) {
            const fc = cfg as any
            console.log(`  • ${field}: ${fc.type || 'unknown'}${fc.description ? ` (${fc.description})` : ''}`)
          }
        }
      }
    } catch (error) {
      console.error('Error fetching agent info:', error instanceof Error ? error.message : String(error))
      process.exit(1)
    }
  })

// ===== Eval Set Commands =====

const setCmd = program
  .command('set')
  .description('Manage evaluation sets')

setCmd
  .command('create')
  .description('Create a new evaluation set (optionally with cases)')
  .requiredOption('--agent-id <id>', 'Glean agent ID')
  .option('--name <name>', 'Eval set name (auto-fetched from agent if omitted)')
  .option('--description <desc>', 'Description of the eval set')
  .option('--generate <count>', 'Auto-generate N test cases using AI')
  .option('--csv <file>', 'Import test cases from CSV file')
  .action(async (opts) => {
    try {
      // If no name provided, fetch from agent
      let setName = opts.name
      let setDescription = opts.description
      if (!setName) {
        const agentInfo = await fetchAgentInfo(opts.agentId)
        if (agentInfo?.name) {
          setName = agentInfo.name
          if (!setDescription) setDescription = `Evaluation of ${agentInfo.name}`
          console.log(`Agent: ${agentInfo.name}`)
        } else {
          setName = `Agent ${opts.agentId.slice(0, 8)} Evaluation`
        }
      }

      const setId = generateId()
      await db.insert(evalSets).values({
        id: setId,
        name: setName,
        description: setDescription || '',
        agentId: opts.agentId,
        createdAt: new Date()
      })

      console.log(`✓ Created eval set: ${setName}`)
      console.log(`  ID: ${setId}`)
      console.log(`  Agent: ${opts.agentId}`)

      let caseCount = 0

      // Import CSV if provided
      if (opts.csv) {
        caseCount += await importCSVToSet(setId, opts.csv)
      }

      // Generate cases if requested
      if (opts.generate) {
        const count = parseInt(opts.generate)
        console.log(`\nGenerating ${count} test cases...`)

        const agentInfo = await fetchAgentInfo(opts.agentId)
        const schemaResp = await fetch(
          `${config.gleanBackend}/rest/api/v1/agents/${opts.agentId}/schemas`,
          { headers: { 'Authorization': `Bearer ${config.gleanApiKey}` } }
        )
        if (!schemaResp.ok) {
          throw new Error(`Failed to fetch agent schema: ${schemaResp.status}`)
        }
        const schema = await schemaResp.json() as { input_schema?: Record<string, any> }

        const generated = await smartGenerate({
          agentId: opts.agentId,
          agentName: agentInfo?.name || setName,
          agentDescription: agentInfo?.description || '',
          schema,
          count,
        })

        for (const testCase of generated.cases) {
          const hasMultiFields = Object.keys(testCase.input).length > 1
          await db.insert(evalCases).values({
            id: generateId(),
            evalSetId: setId,
            query: testCase.query,
            evalGuidance: testCase.evalGuidance || null,
            metadata: hasMultiFields ? JSON.stringify({ fields: testCase.input }) : null,
            createdAt: new Date()
          })
        }
        caseCount += generated.cases.length
        console.log(`  ✓ Generated ${generated.cases.length} cases`)
      }

      if (caseCount > 0) {
        console.log(`\nTotal cases: ${caseCount}`)
      }

      console.log(`\nRun evaluation with:`)
      console.log(`  seer run ${setId}`)
    } catch (error) {
      console.error('Error creating eval set:', error instanceof Error ? error.message : String(error))
      process.exit(1)
    }
  })

setCmd
  .command('add-case <set-id>')
  .description('Add a test case to an existing eval set')
  .requiredOption('--query <query>', 'Test query')
  .option('--expected <answer>', 'Eval guidance (optional)')
  .option('--guidance <guidance>', 'Eval guidance (optional, alias for --expected)')
  .option('--context <context>', 'Additional context for judge')
  .action(async (setId, opts) => {
    try {
      const set = await db.select().from(evalSets).where(eq(evalSets.id, setId))
      if (set.length === 0) {
        throw new Error(`Eval set ${setId} not found`)
      }

      const caseId = generateId()
      const guidance = opts.guidance || opts.expected
      await db.insert(evalCases).values({
        id: caseId,
        evalSetId: setId,
        query: opts.query,
        evalGuidance: guidance || null,
        context: opts.context || null,
        createdAt: new Date()
      })

      console.log(`✓ Added test case to set ${set[0].name}`)
      console.log(`  Case ID: ${caseId}`)
      console.log(`  Query: ${opts.query}`)
    } catch (error) {
      console.error('Error adding test case:', error instanceof Error ? error.message : String(error))
      process.exit(1)
    }
  })

setCmd
  .command('edit-case <case-id>')
  .description('Edit an existing test case')
  .option('--query <query>', 'New query text')
  .option('--guidance <guidance>', 'New eval guidance')
  .option('--context <context>', 'New context')
  .action(async (caseId, opts) => {
    try {
      const existing = await db.select().from(evalCases).where(eq(evalCases.id, caseId))
      if (existing.length === 0) {
        throw new Error(`Case ${caseId} not found`)
      }

      const updates: any = {}
      if (opts.query !== undefined) updates.query = opts.query
      if (opts.guidance !== undefined) updates.evalGuidance = opts.guidance
      if (opts.context !== undefined) updates.context = opts.context

      if (Object.keys(updates).length === 0) {
        console.log('No updates specified. Use --query, --guidance, or --context.')
        process.exit(1)
      }

      await db.update(evalCases).set(updates).where(eq(evalCases.id, caseId))

      console.log(`✓ Updated case ${caseId}`)
      if (opts.query) console.log(`  Query: ${opts.query}`)
      if (opts.guidance) console.log(`  Guidance: ${opts.guidance}`)
      if (opts.context) console.log(`  Context: ${opts.context}`)
    } catch (error) {
      console.error('Error editing case:', error instanceof Error ? error.message : String(error))
      process.exit(1)
    }
  })

setCmd
  .command('remove-case <case-id>')
  .description('Delete a test case')
  .action(async (caseId) => {
    try {
      const existing = await db.select().from(evalCases).where(eq(evalCases.id, caseId))
      if (existing.length === 0) {
        throw new Error(`Case ${caseId} not found`)
      }

      await db.delete(evalCases).where(eq(evalCases.id, caseId))
      console.log(`✓ Deleted case ${caseId}`)
    } catch (error) {
      console.error('Error removing case:', error instanceof Error ? error.message : String(error))
      process.exit(1)
    }
  })

setCmd
  .command('import-csv <set-id> <file>')
  .description('Import test cases from a CSV file (columns: query,eval_guidance)')
  .action(async (setId, file) => {
    try {
      const set = await db.select().from(evalSets).where(eq(evalSets.id, setId))
      if (set.length === 0) {
        throw new Error(`Eval set ${setId} not found`)
      }

      const count = await importCSVToSet(setId, file)
      console.log(`\n✓ Imported ${count} cases to ${set[0].name}`)
    } catch (error) {
      console.error('Error importing CSV:', error instanceof Error ? error.message : String(error))
      process.exit(1)
    }
  })

setCmd
  .command('delete <set-id>')
  .description('Delete an eval set and all its cases, runs, and results')
  .option('--yes', 'Skip confirmation')
  .action(async (setId, opts) => {
    try {
      const set = await db.select().from(evalSets).where(eq(evalSets.id, setId))
      if (set.length === 0) {
        throw new Error(`Eval set ${setId} not found`)
      }

      if (!opts.yes) {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
        const answer = await new Promise<string>(resolve => {
          rl.question(`Delete "${set[0].name}" and all associated data? (y/n): `, resolve)
        })
        rl.close()
        if (answer.toLowerCase() !== 'y') {
          console.log('Cancelled')
          process.exit(0)
        }
      }

      // Cascade delete: scores → results → runs → cases → set
      const runs = await db.select({ id: evalRuns.id }).from(evalRuns).where(eq(evalRuns.evalSetId, setId))
      const runIds = runs.map(r => r.id)

      if (runIds.length > 0) {
        const results = await db.select({ id: evalResults.id }).from(evalResults).where(inArray(evalResults.runId, runIds))
        const resultIds = results.map(r => r.id)
        if (resultIds.length > 0) {
          await db.delete(evalScores).where(inArray(evalScores.resultId, resultIds))
          await db.delete(evalResults).where(inArray(evalResults.runId, runIds))
        }
        await db.delete(evalRuns).where(eq(evalRuns.evalSetId, setId))
      }

      await db.delete(evalCases).where(eq(evalCases.evalSetId, setId))
      await db.delete(evalSets).where(eq(evalSets.id, setId))

      console.log(`✓ Deleted eval set "${set[0].name}" (${runIds.length} runs, all cases and scores)`)
    } catch (error) {
      console.error('Error deleting eval set:', error instanceof Error ? error.message : String(error))
      process.exit(1)
    }
  })

setCmd
  .command('view <set-id>')
  .description('View details of an eval set')
  .action(async (setId) => {
    try {
      const set = await db.select().from(evalSets).where(eq(evalSets.id, setId))
      if (set.length === 0) {
        throw new Error(`Eval set ${setId} not found`)
      }

      const cases = await db.select().from(evalCases).where(eq(evalCases.evalSetId, setId))

      console.log(`\n=== ${set[0].name} ===`)
      console.log(`ID: ${set[0].id}`)
      console.log(`Agent: ${set[0].agentId}`)
      console.log(`Description: ${set[0].description || '(none)'}`)
      console.log(`Created: ${set[0].createdAt.toLocaleString()}`)
      console.log(`\nTest Cases (${cases.length}):`)

      cases.forEach((c, i) => {
        console.log(`\n${i + 1}. [${c.id}] ${c.query}`)
        if (c.evalGuidance) {
          console.log(`   Guidance: ${c.evalGuidance}`)
        }
      })
    } catch (error) {
      console.error('Error viewing eval set:', error instanceof Error ? error.message : String(error))
      process.exit(1)
    }
  })

// ===== Run Commands =====

program
  .command('run <set-id>')
  .description('Run evaluation on an eval set')
  .option('--criteria <list>', 'Comma-separated criteria IDs', 'topical_coverage,response_quality,groundedness,hallucination_risk')
  .option('--deep', 'Include factual accuracy verification (adds 4th judge call with company search)', false)
  .option('--multi-judge', 'Run with multiple judge models (Opus 4.6 + GPT-5)', false)
  .action(async (setId, opts) => {
    try {
      // Get eval set
      const sets = await db.select().from(evalSets).where(eq(evalSets.id, setId))
      if (sets.length === 0) {
        throw new Error(`Eval set ${setId} not found`)
      }
      const set = sets[0]

      // Get test cases
      const cases = await db.select().from(evalCases).where(eq(evalCases.evalSetId, setId))
      if (cases.length === 0) {
        throw new Error(`No test cases found in eval set ${setId}`)
      }

      // Parse criteria
      const criteriaIds = opts.criteria.split(',').map((s: string) => s.trim())
      if (opts.deep) criteriaIds.push('factual_accuracy')
      const criteria = criteriaIds.map((id: string) => {
        const c = getCriterion(id)
        if (!c) throw new Error(`Unknown criterion: ${id}. Available: topical_coverage, response_quality, groundedness, hallucination_risk, factual_accuracy, latency, tool_call_count`)
        return c
      })

      const judgeModelIds = opts.multiJudge
        ? JUDGE_MODELS.map(m => m.id)
        : [JUDGE_MODELS[0].id]
      const judgeDisplay = judgeModelIds.length > 1
        ? `Ensemble (${judgeModelIds.map(id => JUDGE_MODELS.find(m => m.id === id)?.name).join(', ')})`
        : JUDGE_MODELS.find(m => m.id === judgeModelIds[0])?.displayName || judgeModelIds[0]

      const mode = opts.deep
        ? (opts.multiJudge ? 'Deep + Multi-Judge' : 'Deep (with factuality)')
        : (opts.multiJudge ? 'Multi-Judge' : 'Quick')

      console.log(`\n🔍 Running evaluation: ${set.name}`)
      console.log(`   Agent: ${set.agentId}`)
      console.log(`   Cases: ${cases.length}`)
      console.log(`   Criteria: ${criteriaIds.join(', ')}`)
      console.log(`   Mode: ${mode}`)
      console.log(`   Judge: ${judgeDisplay}\n`)

      // Create run
      const runId = generateId()
      await db.insert(evalRuns).values({
        id: runId,
        evalSetId: setId,
        startedAt: new Date(),
        status: 'running',
        config: JSON.stringify({
          criteria: criteriaIds,
          judgeModel: judgeModelIds.length > 1 ? 'ensemble' : JUDGE_MODELS.find(m => m.id === judgeModelIds[0])?.name || 'opus-4-6',
          judges: judgeModelIds,
          mode,
          multiJudge: opts.multiJudge,
        })
      })

      const results: any[] = []

      // Process each case
      for (let i = 0; i < cases.length; i++) {
        const testCase = cases[i]
        const caseNum = i + 1

        process.stdout.write(`[${caseNum}/${cases.length}] Evaluating case ${testCase.id.slice(0, 8)}... `)

        try {
          // 1. Run agent (use structured fields from metadata if available)
          const caseMetadata = testCase.metadata ? JSON.parse(testCase.metadata) : null
          const structuredFields = caseMetadata?.fields as Record<string, string> | undefined
          const agentResult = await runAgent(set.agentId, testCase.query, testCase.id, structuredFields)

          // 2. Judge (batch by call type — coverage, faithfulness, factuality)
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
              // Categorical scores: map to numeric
              numericValue = criterion.scaleConfig.categoryValues[score.scoreCategory.toLowerCase()] ?? 0
            }

            if (numericValue !== undefined) {
              totalWeightedScore += numericValue * criterion.weight
              totalWeight += criterion.weight
            }
          }

          const overallScore = totalWeight > 0 ? totalWeightedScore / totalWeight : 0

          // 4. Save result
          const resultId = generateId()
          await db.insert(evalResults).values({
            id: resultId,
            runId,
            caseId: testCase.id,
            agentResponse: agentResult.response,
            agentTrace: agentResult.reasoningChain ? JSON.stringify(agentResult.reasoningChain) : null,
            latencyMs: agentResult.latencyMs,
            totalTokens: null,  // Not available via REST API (see TRACE_API_LIMITATIONS.md)
            toolCalls: JSON.stringify(agentResult.toolCalls || []),
            overallScore,
            timestamp: new Date()
          })

          // 5. Save individual scores
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

          results.push({ testCase, agentResult, scores, overallScore })
          console.log(`✓ (${(agentResult.latencyMs / 1000).toFixed(1)}s)`)

        } catch (error) {
          console.log(`✗ Error: ${error instanceof Error ? error.message : String(error)}`)
        }
      }

      // Mark run complete
      await db.update(evalRuns)
        .set({ completedAt: new Date(), status: 'completed' })
        .where(eq(evalRuns.id, runId))

      // Display summary
      console.log(`\n=== Results Summary ===`)
      const avgScore = results.reduce((sum, r) => sum + r.overallScore, 0) / results.length
      console.log(`Overall Score: ${avgScore.toFixed(1)}/10`)
      console.log(`\nPer Criterion:`)

      criteria.forEach((criterion: CriterionDefinition) => {
        const criterionScores = results
          .flatMap(r => r.scores)
          .filter(s => s.criterionId === criterion.id)

        if (criterion.scoreType === 'binary') {
          const avg = criterionScores.reduce((sum, s) => sum + (s.scoreValue || 0), 0) / criterionScores.length
          console.log(`  ${criterion.name}: ${avg.toFixed(1)}/10`)
        } else if (criterion.scoreType === 'categorical') {
          const categories = criterionScores.map(s => s.scoreCategory)
          const counts = categories.reduce((acc, cat) => {
            acc[cat!] = (acc[cat!] || 0) + 1
            return acc
          }, {} as Record<string, number>)
          console.log(`  ${criterion.name}: ${JSON.stringify(counts)}`)
        } else if (criterion.scoreType === 'metric') {
          const values = criterionScores.map(s => s.scoreValue!)
          const avg = values.reduce((sum, v) => sum + v, 0) / values.length
          console.log(`  ${criterion.name}: ${avg.toFixed(0)}`)
        }
      })

      console.log(`\nRun ID: ${runId}`)
      console.log(`View detailed results: seer results ${runId}`)

    } catch (error) {
      console.error('Error running evaluation:', error instanceof Error ? error.message : String(error))
      process.exit(1)
    }
  })

program
  .command('results <run-id>')
  .description('View results of an evaluation run')
  .option('--format <format>', 'Output format (table|json)', 'table')
  .action(async (runId, opts) => {
    try {
      // Get run
      const runs = await db.select().from(evalRuns).where(eq(evalRuns.id, runId))
      if (runs.length === 0) {
        throw new Error(`Run ${runId} not found`)
      }
      const run = runs[0]

      // Get results
      const results = await db.select().from(evalResults).where(eq(evalResults.runId, runId))

      if (opts.format === 'json') {
        const data = {
          run,
          results: await Promise.all(results.map(async r => {
            const scores = await db.select().from(evalScores).where(eq(evalScores.resultId, r.id))
            const testCase = await db.select().from(evalCases).where(eq(evalCases.id, r.caseId))
            return {
              case: testCase[0],
              result: r,
              scores
            }
          }))
        }
        console.log(JSON.stringify(data, null, 2))
        return
      }

      // Table format
      console.log(`\n=== Evaluation Run Results ===`)
      console.log(`Run ID: ${runId}`)
      console.log(`Status: ${run.status}`)
      console.log(`Started: ${run.startedAt.toLocaleString()}`)
      if (run.completedAt) {
        console.log(`Completed: ${run.completedAt.toLocaleString()}`)
      }

      const avgScore = results.reduce((sum, r) => sum + r.overallScore, 0) / results.length
      console.log(`\nOverall Score: ${avgScore.toFixed(1)}/10`)

      console.log(`\n--- Detailed Results ---\n`)

      for (const result of results) {
        const testCase = await db.select().from(evalCases).where(eq(evalCases.id, result.caseId))
        const scores = await db.select().from(evalScores).where(eq(evalScores.resultId, result.id))

        console.log(`Query: ${testCase[0].query}`)
        console.log(`Overall: ${result.overallScore.toFixed(1)}/10 | Latency: ${result.latencyMs}ms`)

        scores.forEach(score => {
          const criterion = getCriterion(score.criterionId)!
          let scoreDisplay = ''
          if (score.scoreValue !== null) {
            scoreDisplay = `${score.scoreValue}`
          } else if (score.scoreCategory) {
            scoreDisplay = score.scoreCategory
          }
          console.log(`  • ${criterion.name}: ${scoreDisplay}`)
          console.log(`    ${score.reasoning}`)
        })

        console.log(`\nAgent Response:`)
        console.log(`${result.agentResponse}\n`)
        console.log('---\n')
      }

    } catch (error) {
      console.error('Error viewing results:', error instanceof Error ? error.message : String(error))
      process.exit(1)
    }
  })

// ===== List Commands =====

program
  .command('list <type>')
  .description('List eval sets or runs')
  .action(async (type) => {
    try {
      if (type === 'sets') {
        const sets = await db.select().from(evalSets)
        console.log(`\n=== Eval Sets (${sets.length}) ===\n`)

        for (const set of sets) {
          const cases = await db.select().from(evalCases).where(eq(evalCases.evalSetId, set.id))
          console.log(`${set.name}`)
          console.log(`  ID: ${set.id}`)
          console.log(`  Agent: ${set.agentId}`)
          console.log(`  Cases: ${cases.length}`)
          console.log(`  Created: ${set.createdAt.toLocaleString()}`)
          console.log()
        }

      } else if (type === 'runs') {
        const runs = await db.select().from(evalRuns)
        console.log(`\n=== Eval Runs (${runs.length}) ===\n`)

        for (const run of runs) {
          const set = await db.select().from(evalSets).where(eq(evalSets.id, run.evalSetId))
          const results = await db.select().from(evalResults).where(eq(evalResults.runId, run.id))
          const avgScore = results.length > 0
            ? results.reduce((sum, r) => sum + r.overallScore, 0) / results.length
            : 0

          console.log(`${run.id}`)
          console.log(`  Set: ${set[0]?.name || run.evalSetId}`)
          console.log(`  Status: ${run.status}`)
          console.log(`  Score: ${avgScore.toFixed(1)}/10`)
          console.log(`  Cases: ${results.length}`)
          console.log(`  Started: ${run.startedAt.toLocaleString()}`)
          console.log()
        }

      } else {
        throw new Error('type must be "sets" or "runs"')
      }
    } catch (error) {
      console.error('Error listing:', error instanceof Error ? error.message : String(error))
      process.exit(1)
    }
  })

// ===== Generate Command =====

program
  .command('generate <agent-id>')
  .description('Generate eval set using AI (Glean chat)')
  .option('--count <n>', 'Number of test cases to generate', '10')
  .option('--name <name>', 'Override generated name')
  .option('--description <desc>', 'Override generated description')
  .option('--yes', 'Skip confirmation and save immediately')
  .action(async (agentId, opts) => {
    try {
      console.log(`Generating eval set for agent ${agentId}...`)

      // Fetch agent schema
      console.log('Fetching agent schema...')
      const schemaResp = await fetch(
        `${config.gleanBackend}/rest/api/v1/agents/${agentId}/schemas`,
        {
          headers: {
            'Authorization': `Bearer ${config.gleanApiKey}`
          }
        }
      )

      if (!schemaResp.ok) {
        throw new Error(`Failed to fetch agent schema: ${schemaResp.status} ${schemaResp.statusText}`)
      }

      const schema = await schemaResp.json() as { input_schema?: Record<string, any> }

      // Fetch agent name
      console.log('Fetching agent details...')
      const agentInfo = await fetchAgentInfo(agentId)
      const agentName = agentInfo?.name

      if (agentName) {
        console.log(`Agent: ${agentName}`)
      }

      // Show schema info
      const inputFields = Object.keys(schema.input_schema || {})
      const hasFormInputs = inputFields.length > 0

      console.log(`Type: ${hasFormInputs ? 'Form-based' : 'Chat-style'}`)
      if (hasFormInputs) {
        console.log(`Fields: ${inputFields.join(', ')}`)
        console.log('\nField Details:')
        for (const [field, config] of Object.entries(schema.input_schema || {})) {
          const fieldConfig = config as any
          console.log(`  • ${field}: ${fieldConfig.type || 'unknown'}`)
          if (fieldConfig.description) {
            console.log(`    ${fieldConfig.description}`)
          }
        }
      }

      // Generate eval set using smart agent (search + chat grounding)
      const generated = await smartGenerate({
        agentId,
        agentName: agentName || `Agent ${agentId.slice(0, 8)}`,
        agentDescription: agentInfo?.description || '',
        schema,
        count: parseInt(opts.count),
      })

      // Show preview
      console.log(`\n✨ Generated Eval Set:\n`)
      console.log(`Name: ${opts.name || generated.name}`)
      console.log(`Description: ${opts.description || generated.description}`)
      console.log(`\nTest Cases (${generated.cases.length}):\n`)

      generated.cases.forEach((c, i) => {
        console.log(`${i + 1}. ${c.query}`)
        if (c.evalGuidance) {
          console.log(`   Guidance: ${c.evalGuidance}`)
        }
        console.log()
      })

      // Save (skip confirmation with --yes)
      const shouldSave = opts.yes ? true : await askConfirmation('Save this eval set? (y/n): ')

      if (shouldSave) {
        const setId = generateId()
        await db.insert(evalSets).values({
          id: setId,
          name: opts.name || generated.name,
          description: opts.description || generated.description,
          agentId,
          createdAt: new Date()
        })

        for (const testCase of generated.cases) {
          const hasMultiFields = Object.keys(testCase.input).length > 1
          await db.insert(evalCases).values({
            id: generateId(),
            evalSetId: setId,
            query: testCase.query,
            evalGuidance: testCase.evalGuidance || null,
            metadata: hasMultiFields ? JSON.stringify({ fields: testCase.input }) : null,
            createdAt: new Date()
          })
        }

        console.log(`\n✓ Saved eval set: ${setId}`)
        console.log(`\nRun evaluation with:`)
        console.log(`  seer run ${setId}`)
      } else {
        console.log('Cancelled')
      }

      process.exit(0)

    } catch (error) {
      console.error('Error generating eval set:', error instanceof Error ? error.message : String(error))
      process.exit(1)
    }
  })

program.parse()

// ===== Utilities =====

/**
 * Parse a CSV file and import cases into an eval set.
 * Format: query,eval_guidance (header row optional, guidance column optional)
 */
async function importCSVToSet(setId: string, filePath: string): Promise<number> {
  const text = readFileSync(filePath, 'utf-8')
  const lines = text.split('\n').filter(l => l.trim())

  if (lines.length === 0) {
    throw new Error('CSV file is empty')
  }

  // Check for header row
  const firstLine = lines[0].toLowerCase()
  const hasHeader = firstLine.includes('query') || firstLine.includes('eval_guidance') || firstLine.includes('guidance')
  const dataLines = hasHeader ? lines.slice(1) : lines

  let count = 0
  for (const line of dataLines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const fields = parseCSVLine(trimmed)
    if (fields.length > 0 && fields[0]) {
      await db.insert(evalCases).values({
        id: generateId(),
        evalSetId: setId,
        query: fields[0],
        evalGuidance: fields[1] || null,
        createdAt: new Date()
      })
      count++
    }
  }

  console.log(`  ✓ Imported ${count} cases from ${filePath}`)
  return count
}

/**
 * Parse a single CSV line, handling quoted fields.
 */
function parseCSVLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        current += ch
      }
    } else {
      if (ch === '"') {
        inQuotes = true
      } else if (ch === ',') {
        fields.push(current.trim())
        current = ''
      } else {
        current += ch
      }
    }
  }

  fields.push(current.trim())
  return fields
}

/**
 * Interactive yes/no confirmation (used when --yes is not set)
 */
function askConfirmation(prompt: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => {
    rl.question(prompt, (answer: string) => {
      rl.close()
      resolve(answer.toLowerCase() === 'y')
    })
  })
}
