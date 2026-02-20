/**
 * Core domain types for Seer agent evaluation framework
 */

// Eval case: single query with expected behavior
export interface EvalCase {
  id: string
  query: string
  evalGuidance?: string  // Optional thematic guidance for coverage judge
  context?: string  // Additional context for judge
  metadata?: Record<string, any>
}

// Eval set: collection of cases for an agent
export interface EvalSet {
  id: string
  name: string
  description: string
  agentId: string
  cases: EvalCase[]
  criteria: string[]  // Which criteria to evaluate
  createdAt: Date
}

// Agent result: response from Glean Agent API
export interface AgentResult {
  caseId: string
  query: string
  response: string
  latencyMs: number
  toolCalls?: any[]          // Tools used: Glean Search, Think, Generate, etc.
  traceId?: string           // workflowTraceId for linking to debug UI
  reasoningChain?: any[]     // Search queries, docs read, steps taken
  timestamp: Date
  // Note: token counts not available via REST API (see docs/TRACE_API_LIMITATIONS.md)
}

// Judge score for single criterion
export interface JudgeScore {
  criterionId: string
  scoreValue?: number  // For continuous/binary (0-10 or 0-1)
  scoreCategory?: string  // For categorical
  reasoning: string
  judgeModel: string
}

// Complete eval result
export interface EvalResult {
  id: string
  runId: string
  caseId: string
  agentResult: AgentResult
  scores: JudgeScore[]
  overallScore: number  // Weighted average
}

// Eval run configuration
export interface EvalRun {
  id: string
  evalSetId: string
  startedAt: Date
  completedAt?: Date
  status: 'running' | 'completed' | 'failed'
  config: {
    criteria: string[]
    judgeModel: string | string[]
    judges?: string[]
    mode?: string
    multiJudge?: boolean
  }
}
