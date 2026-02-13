#!/usr/bin/env bun

/**
 * Seer CLI - Agent evaluation framework
 */

import { program } from 'commander'
import { eq } from 'drizzle-orm'
import { generateId } from './lib/id'
import { db, initializeDB } from './db/index'
import { evalSets, evalCases, evalRuns, evalResults, evalScores, evalCriteria } from './db/schema'
import { runAgent } from './data/glean'
import { judgeResponse } from './lib/judge'
import { DEFAULT_CRITERIA, getCriterion } from './criteria/defaults'
import { generateEvalSet } from './lib/generate'
import { fetchAgentInfo } from './lib/fetch-agent'
import { config } from './lib/config'
import type { JudgeScore } from './types'
import type { CriterionDefinition } from './criteria/defaults'
import * as readline from 'readline'

// Initialize database before running commands
await initializeDB()

program
  .name('seer')
  .description('Agent evaluation framework with LLM-as-judge')
  .version('0.1.0')

// ===== Eval Set Commands =====

const setCmd = program
  .command('set')
  .description('Manage evaluation sets')

setCmd
  .command('create')
  .description('Create a new evaluation set')
  .requiredOption('--name <name>', 'Eval set name')
  .requiredOption('--agent-id <id>', 'Glean agent ID')
  .option('--description <desc>', 'Description of the eval set')
  .action(async (opts) => {
    try {
      const setId = generateId()
      const now = new Date()

      // Insert eval set
      await db.insert(evalSets).values({
        id: setId,
        name: opts.name,
        description: opts.description || '',
        agentId: opts.agentId,
        createdAt: now
      })

      console.log(`✓ Created eval set: ${opts.name}`)
      console.log(`  ID: ${setId}`)
      console.log(`  Agent: ${opts.agentId}`)
      console.log(`\nNext step: Add test cases with:`)
      console.log(`  seer set add-case ${setId} --query "Your test query"`)
    } catch (error) {
      console.error('Error creating eval set:', error instanceof Error ? error.message : String(error))
      process.exit(1)
    }
  })

setCmd
  .command('add-case <set-id>')
  .description('Add a test case to an existing eval set')
  .requiredOption('--query <query>', 'Test query')
  .option('--expected <answer>', 'Expected answer (optional)')
  .option('--context <context>', 'Additional context for judge')
  .action(async (setId, opts) => {
    try {
      // Verify set exists
      const set = await db.select().from(evalSets).where(eq(evalSets.id, setId))
      if (set.length === 0) {
        throw new Error(`Eval set ${setId} not found`)
      }

      const caseId = generateId()
      await db.insert(evalCases).values({
        id: caseId,
        evalSetId: setId,
        query: opts.query,
        expectedAnswer: opts.expected,
        context: opts.context,
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
        console.log(`\n${i + 1}. ${c.query}`)
        if (c.expectedAnswer) {
          console.log(`   Expected: ${c.expectedAnswer}`)
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
  .option('--criteria <list>', 'Comma-separated criteria IDs', 'task_success,factuality')
  .option('--judge-model <model>', 'Judge model (uses Glean chat)', 'glean-chat')
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
      const criteria = criteriaIds.map((id: string) => {
        const c = getCriterion(id)
        if (!c) throw new Error(`Unknown criterion: ${id}`)
        return c
      })

      console.log(`\n🔍 Running evaluation: ${set.name}`)
      console.log(`   Agent: ${set.agentId}`)
      console.log(`   Cases: ${cases.length}`)
      console.log(`   Criteria: ${criteriaIds.join(', ')}`)
      console.log(`   Judge: ${opts.judgeModel}\n`)

      // Create run
      const runId = generateId()
      await db.insert(evalRuns).values({
        id: runId,
        evalSetId: setId,
        startedAt: new Date(),
        status: 'running',
        config: JSON.stringify({
          criteria: criteriaIds,
          judgeModel: opts.judgeModel
        })
      })

      const results: any[] = []

      // Process each case
      for (let i = 0; i < cases.length; i++) {
        const testCase = cases[i]
        const caseNum = i + 1

        process.stdout.write(`[${caseNum}/${cases.length}] Evaluating case ${testCase.id.slice(0, 8)}... `)

        try {
          // 1. Run agent
          const agentResult = await runAgent(set.agentId, testCase.query, testCase.id)

          // 2. Judge each criterion
          const scores: JudgeScore[] = []
          for (const criterion of criteria) {
            const score = await judgeResponse(
              criterion,
              testCase.query,
              agentResult.response,
              agentResult,
              testCase.expectedAnswer || undefined,
              opts.judgeModel
            )
            scores.push(score)
          }

          // 3. Calculate overall score (weighted average of continuous/binary scores only, exclude metrics)
          const qualityScores = scores.filter(s => {
            const criterion = getCriterion(s.criterionId)!
            return s.scoreValue !== undefined && criterion.scoreType !== 'metric'
          })

          const weightedScores = qualityScores.map(s => {
            const criterion = getCriterion(s.criterionId)!
            return s.scoreValue! * criterion.weight
          })

          const totalWeight = qualityScores.reduce((sum, s) => {
            return sum + getCriterion(s.criterionId)!.weight
          }, 0)

          const overallScore = totalWeight > 0
            ? weightedScores.reduce((sum, s) => sum + s, 0) / totalWeight
            : 0

          // 4. Save result
          const resultId = generateId()
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

        if (criterion.scoreType === 'continuous' || criterion.scoreType === 'binary') {
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
  .action(async (agentId, opts) => {
    try {
      console.log(`Generating eval set for agent ${agentId}...`)

      // Fetch agent schema
      console.log('Fetching agent schema...')
      const schemaResp = await fetch(
        `${config.gleanBackend}/rest/api/v1/agents/${agentId}/schemas`,
        {
          headers: {
            'Authorization': `Bearer ${config.gleanAgentApiKey}`
          }
        }
      )

      if (!schemaResp.ok) {
        throw new Error(`Failed to fetch agent schema: ${schemaResp.status} ${schemaResp.statusText}`)
      }

      const schema = await schemaResp.json()

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
        for (const [field, config] of Object.entries(schema.input_schema)) {
          const fieldConfig = config as any
          console.log(`  • ${field}: ${fieldConfig.type || 'unknown'}`)
          if (fieldConfig.description) {
            console.log(`    ${fieldConfig.description}`)
          }
        }
      }

      // Generate eval set using AI
      console.log('\nGenerating test cases with AI (grounded in company knowledge)...\n')
      const generated = await generateEvalSet({
        agentId,
        count: parseInt(opts.count),
        schema,
        agentName
      })

      // Show preview
      console.log(`\n✨ Generated Eval Set:\n`)
      console.log(`Name: ${opts.name || generated.name}`)
      console.log(`Description: ${opts.description || generated.description}`)
      console.log(`\nTest Cases (${generated.cases.length}):\n`)

      generated.cases.forEach((c, i) => {
        console.log(`${i + 1}. ${c.query}`)
        if (c.expectedAnswer) {
          console.log(`   Expected: ${c.expectedAnswer}`)
        }
        console.log()
      })

      // Ask for approval
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      })

      rl.question('Save this eval set? (y/n): ', async (answer: string) => {
        if (answer.toLowerCase() === 'y') {
          try {
            // Save to database
            const setId = generateId()
            await db.insert(evalSets).values({
              id: setId,
              name: opts.name || generated.name,
              description: opts.description || generated.description,
              agentId,
              createdAt: new Date()
            })

            // Save cases
            for (const testCase of generated.cases) {
              const caseId = generateId()
              await db.insert(evalCases).values({
                id: caseId,
                evalSetId: setId,
                query: testCase.query,
                expectedAnswer: testCase.expectedAnswer || null,
                context: testCase.context || null,
                createdAt: new Date()
              })
            }

            console.log(`\n✓ Saved eval set: ${setId}`)
            console.log(`\nRun evaluation with:`)
            console.log(`  seer run ${setId} --criteria task_success,factuality,relevance`)
          } catch (error) {
            console.error('Error saving eval set:', error)
          }
        } else {
          console.log('Cancelled')
        }
        rl.close()
        process.exit(0)
      })

    } catch (error) {
      console.error('Error generating eval set:', error instanceof Error ? error.message : String(error))
      process.exit(1)
    }
  })

program.parse()
