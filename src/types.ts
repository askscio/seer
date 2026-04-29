/**
 * Core domain types for Seer agent evaluation framework
 */

// Agent classification based on capabilities and execution mode
export type AgentType = 'workflow' | 'autonomous' | 'unknown'

// Agent info with capabilities for routing decisions
export interface AgentCapabilities {
  'ap.io.messages'?: boolean   // Accepts chat-style messages (autonomous agents)
  'ap.io.streaming'?: boolean  // Supports streaming output
  [key: string]: boolean | undefined
}

// Simulator strategy — how the simulated user should interact with the agent
// Generated once per case based on agent behavior patterns and case context.
// Distinct from evalGuidance (which is for judges) and simulatorContext (which is persona).
export interface SimulatorStrategy {
  expectedAgentBehavior: string  // What the agent will likely do (ask questions, propose options, etc.)
  userResponseApproach: string   // How the simulated user should respond at each stage
  informationToProvide: string   // Specific details the user should share when asked
  boundaries: string             // What the user should NOT do (e.g., don't ask questions back)
}

// Single turn in a multi-turn conversation
export interface ConversationTurn {
  role: 'user' | 'agent'
  content: string
  toolCalls?: any[]
  traceId?: string
  timestamp: Date
}

// Eval case: single query with expected behavior
export interface EvalCase {
  id: string
  query: string
  evalGuidance?: string  // Optional thematic guidance for coverage judge
  goldenAnswer?: string  // Optional golden answer for benchmark accuracy/completeness
  goldenSources?: string[]  // Optional source URLs used for golden-answer verification
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
  chatId?: string            // For multi-turn conversation continuation
  transcript?: ConversationTurn[]  // Full multi-turn conversation history
  agentType?: AgentType      // How the agent was executed
  timestamp: Date
  // Note: token counts not available via REST API (see docs/TRACE_API_LIMITATIONS.md)
}

// Judge score for single criterion
export interface JudgeScore {
  criterionId: string
  scoreValue?: number  // For binary (0 or 1) or numeric metrics
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
