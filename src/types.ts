/**
 * Core domain types for Seer agent evaluation framework
 */

// Eval case: single query with expected behavior
export interface EvalCase {
  id: string
  query: string
  expectedAnswer?: string  // Optional reference answer
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
    judgeModel: string
    ensemble?: {
      models: string[]
      requireConsensus: boolean
      consensusThreshold: number
    }
  }
}

// Judge configuration
export interface JudgeConfig {
  primaryModel: string  // 'claude-sonnet-4'

  ensemble?: {
    enabled: boolean
    models: string[]  // ['gpt-4', 'gemini-pro']
    aggregation: 'mean' | 'median'
    requireConsensus: boolean
    consensusThreshold: number  // e.g., 0.3 (max std dev before flagging)
  }

  temperature: number
  requireChainOfThought: boolean
}

// Ensemble result with confidence metrics
export interface EnsembleResult {
  finalScore: number | string  // number for continuous, string for categorical
  individualScores: JudgeScore[]
  agreement: number  // 0-1, higher = more agreement
  flaggedForReview: boolean
  confidenceInterval?: [number, number]  // For continuous only
  consensusCategory?: string  // For categorical - majority vote
}
