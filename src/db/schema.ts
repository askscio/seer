/**
 * Database schema for Seer evaluation framework
 * Using Drizzle ORM with SQLite
 */

import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'

// Eval Sets - Collections of test cases for an agent
export const evalSets = sqliteTable('eval_sets', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  agentId: text('agent_id').notNull(),
  agentSchema: text('agent_schema'), // JSON: full agent schema snapshot at creation time
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
})

// Eval Cases - Individual test queries within an eval set
export const evalCases = sqliteTable('eval_cases', {
  id: text('id').primaryKey(),
  evalSetId: text('eval_set_id').notNull().references(() => evalSets.id),
  query: text('query').notNull(),
  evalGuidance: text('eval_guidance'),
  context: text('context'),
  metadata: text('metadata'), // JSON
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
})

// Eval Criteria - Scoring dimensions (default + custom)
export const evalCriteria = sqliteTable('eval_criteria', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  rubric: text('rubric').notNull(),
  scoreType: text('score_type').notNull(), // 'binary' | 'categorical' | 'metric'
  scaleConfig: text('scale_config'), // JSON: { type: '0-10', categories: [...], etc }
  weight: real('weight').notNull().default(1.0),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false)
})

// Eval Runs - Execution of an eval set
export const evalRuns = sqliteTable('eval_runs', {
  id: text('id').primaryKey(),
  evalSetId: text('eval_set_id').notNull().references(() => evalSets.id),
  startedAt: integer('started_at', { mode: 'timestamp' }).notNull(),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
  status: text('status').notNull(), // 'running' | 'completed' | 'failed'
  config: text('config') // JSON: judge models, criteria, etc
})

// Eval Results - Agent response and scores for a case
export const evalResults = sqliteTable('eval_results', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull().references(() => evalRuns.id),
  caseId: text('case_id').notNull().references(() => evalCases.id),

  // Agent response
  agentResponse: text('agent_response').notNull(),
  agentTrace: text('agent_trace'), // JSON: reasoning chain (searches, docs read, tool invocations)
  latencyMs: integer('latency_ms').notNull(),
  totalTokens: integer('total_tokens'),
  toolCalls: text('tool_calls'), // JSON array

  // Overall score
  overallScore: real('overall_score').notNull(),

  timestamp: integer('timestamp', { mode: 'timestamp' }).notNull()
})

// Eval Scores - Individual criterion scores (supports all score types)
export const evalScores = sqliteTable('eval_scores', {
  id: text('id').primaryKey(),
  resultId: text('result_id').notNull().references(() => evalResults.id),
  criterionId: text('criterion_id').notNull().references(() => evalCriteria.id),

  // Score data (flexible for all types)
  scoreValue: real('score_value'), // For continuous/binary
  scoreCategory: text('score_category'), // For categorical
  reasoning: text('reasoning').notNull(),
  judgeModel: text('judge_model'),

  // Ensemble tracking
  ensembleRunId: text('ensemble_run_id'), // Groups judges in same ensemble

  timestamp: integer('timestamp', { mode: 'timestamp' }).notNull()
})
