/**
 * Glean Agent API client for running agents and collecting responses
 *
 * Two execution paths based on agent type:
 * - Workflow agents: POST /rest/api/v1/runworkflow (single-turn, fields or messages)
 * - Autonomous agents: POST /rest/api/v1/chat with agentId (multi-turn via chatId)
 *
 * Agent type is detected from capabilities (ap.io.messages → autonomous).
 *
 * Returns: response text, trace ID, tool calls, reasoning chain, transcript (for multi-turn)
 * Known limitation: token counts require /api/v1/getworkflowtrace (session-auth only)
 */

import { config } from '../lib/config'
import { extractContentWithFallback } from '../lib/extract-content'
import { fetchAgentInfo } from '../lib/fetch-agent'
import { generateUserReply } from '../lib/simulator'
import type { AgentResult, AgentType, ConversationTurn } from '../types'

interface RunWorkflowFragment {
  text?: string
  action?: {
    metadata?: {
      type?: string
      name?: string
      displayName?: string
    }
  }
  structuredResults?: Array<{ document?: { title?: string; url?: string } }>
  querySuggestion?: { query?: string; datasource?: string }
  citation?: { sourceDocument?: { id?: string; title?: string; url?: string } }
}

interface RunWorkflowMessage {
  author: string
  fragments: RunWorkflowFragment[]
  workflowTraceId?: string
  agentTraceInfo?: { traceId: string; startTimeMillis: number }
  stepId?: string
  messageType?: string  // CONTENT = final output, UPDATE = intermediate steps
}

interface RunWorkflowResponse {
  messages: RunWorkflowMessage[]
  chatId?: string
}

interface AgentSchema {
  agent_id: string
  input_schema?: Record<string, { type: string }>
  output_schema?: any
}

// Cache schemas and agent types within a run
const schemaCache = new Map<string, AgentSchema>()
const agentTypeCache = new Map<string, AgentType>()

async function getAgentSchema(agentId: string): Promise<AgentSchema> {
  if (schemaCache.has(agentId)) return schemaCache.get(agentId)!

  const resp = await fetch(
    `${config.gleanBackend}/rest/api/v1/agents/${agentId}/schemas`,
    { headers: { 'Authorization': `Bearer ${config.gleanApiKey}` } }
  )

  if (!resp.ok) {
    throw new Error(`Failed to fetch agent schema: ${resp.status} ${resp.statusText}`)
  }

  const schema = await resp.json() as AgentSchema
  schemaCache.set(agentId, schema)
  return schema
}

/**
 * Detect agent type: autonomous (Chat API) vs workflow (runworkflow).
 * Caches the result for the session.
 */
export async function getAgentType(agentId: string): Promise<AgentType> {
  if (agentTypeCache.has(agentId)) return agentTypeCache.get(agentId)!

  const info = await fetchAgentInfo(agentId)
  const agentType = info?.agentType ?? 'unknown'
  agentTypeCache.set(agentId, agentType)
  return agentType
}

/**
 * Run a Glean agent — routes to the correct API based on agent type.
 *
 * - Workflow agents → /runworkflow (single-turn)
 * - Autonomous agents → /chat with agentId (single-turn for now, multi-turn later)
 */
export async function runAgent(
  agentId: string,
  query: string,
  caseId: string,
  structuredFields?: Record<string, string>,
): Promise<AgentResult> {
  const agentType = await getAgentType(agentId)

  if (agentType === 'autonomous') {
    return runAutonomousAgent(agentId, query, caseId)
  }

  return runWorkflowAgent(agentId, query, caseId, structuredFields)
}

/**
 * Run an autonomous agent via /chat with agentId.
 * These agents have ap.io.messages capability and support multi-turn via chatId.
 */
async function runAutonomousAgent(
  agentId: string,
  query: string,
  caseId: string,
): Promise<AgentResult> {
  const startTime = Date.now()

  const payload = {
    messages: [{ fragments: [{ text: query }] }],
    agentId,
    saveChat: false,
    timeoutMillis: 300_000,
  }

  const response = await fetch(
    `${config.gleanBackend}/rest/api/v1/chat`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.gleanApiKey}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(300_000),
    }
  )

  if (!response.ok) {
    const error = await response.text()
    if (process.env.SEER_DEBUG) {
      console.error(`\n[DEBUG] chat API failed:`)
      console.error(`  Status: ${response.status}`)
      console.error(`  AgentId: ${agentId}`)
      console.error(`  Response: ${error.slice(0, 500)}`)
    }
    throw new Error(`chat API error: ${response.status} - ${error}`)
  }

  const data = await response.json() as RunWorkflowResponse
  const latencyMs = Date.now() - startTime

  // Extract trace from any message
  const traceMsg = data.messages?.find(m => m.workflowTraceId)
  const traceId = traceMsg?.workflowTraceId

  if (traceId) {
    console.log(`  → Trace: ${traceId.slice(0, 16)}...`)
  }

  const toolCalls = extractToolCalls(data.messages)
  if (toolCalls.length > 0) {
    console.log(`  → Tools: ${toolCalls.map(t => t.name).join(', ')}`)
  }

  const responseText = extractFinalResponse(data)
  const reasoningChain = extractReasoningChain(data.messages)

  // Build initial transcript (single turn for now)
  const transcript: ConversationTurn[] = [
    { role: 'user', content: query, timestamp: new Date(startTime) },
    { role: 'agent', content: responseText, toolCalls: toolCalls.length > 0 ? toolCalls : undefined, traceId, timestamp: new Date() },
  ]

  console.log(`  → Mode: autonomous (Chat API)`)

  return {
    caseId,
    query,
    response: responseText,
    latencyMs,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    traceId,
    reasoningChain: reasoningChain.length > 0 ? reasoningChain : undefined,
    chatId: data.chatId,
    transcript,
    agentType: 'autonomous',
    timestamp: new Date(),
  }
}

/**
 * Run a workflow agent via /runworkflow (original single-turn path).
 * Used for agents without ap.io.messages capability.
 */
async function runWorkflowAgent(
  agentId: string,
  query: string,
  caseId: string,
  structuredFields?: Record<string, string>,
): Promise<AgentResult> {
  const startTime = Date.now()

  const schema = await getAgentSchema(agentId)
  const inputSchema = schema.input_schema || {}
  const inputFields = Object.keys(inputSchema)
  const hasFormInputs = inputFields.length > 0

  const payload: any = {
    workflowId: agentId,
    stream: false,
    enableTrace: true,
  }

  if (hasFormInputs) {
    // Populate all schema fields — Glean agents 500 if fields are missing.
    const fields: Record<string, string> = {}
    for (const field of inputFields) {
      fields[field] = ''
    }
    if (structuredFields) {
      for (const [key, value] of Object.entries(structuredFields)) {
        if (key in fields) {
          fields[key] = value
        }
      }
    } else {
      fields[inputFields[0]] = query
    }
    payload.fields = fields
  } else {
    payload.messages = [{
      author: 'USER',
      fragments: [{ text: query }],
    }]
  }

  const response = await fetch(
    `${config.gleanBackend}/rest/api/v1/runworkflow`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.gleanApiKey}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(300_000),
    }
  )

  if (!response.ok) {
    const error = await response.text()
    if (process.env.SEER_DEBUG) {
      console.error(`\n[DEBUG] runworkflow failed:`)
      console.error(`  Status: ${response.status}`)
      console.error(`  Payload: ${JSON.stringify(payload, null, 2)}`)
      console.error(`  Response: ${error.slice(0, 500)}`)
    }
    throw new Error(`runworkflow error: ${response.status} - ${error}`)
  }

  const data = await response.json() as RunWorkflowResponse
  const latencyMs = Date.now() - startTime

  const firstMsg = data.messages?.[0]
  const traceId = firstMsg?.workflowTraceId

  if (traceId) {
    console.log(`  → Trace: ${traceId.slice(0, 16)}...`)
  }

  const toolCalls = extractToolCalls(data.messages)
  if (toolCalls.length > 0) {
    console.log(`  → Tools: ${toolCalls.map(t => t.name).join(', ')}`)
  }

  const responseText = extractFinalResponse(data)
  const reasoningChain = extractReasoningChain(data.messages)

  return {
    caseId,
    query,
    response: responseText,
    latencyMs,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    traceId,
    reasoningChain: reasoningChain.length > 0 ? reasoningChain : undefined,
    agentType: 'workflow',
    timestamp: new Date(),
  }
}

/**
 * Extract final response text from CONTENT-type messages only
 * Skips intermediate UPDATE messages (search queries, "Searching...", etc.)
 * Delegates to shared extract-content utility with GLEAN_AI fallback.
 */
function extractFinalResponse(data: RunWorkflowResponse): string {
  const text = extractContentWithFallback(data)
  if (!text) throw new Error('No response text found in agent output')
  return text
}

/**
 * Extract tool calls from action fragments
 */
function extractToolCalls(messages: RunWorkflowMessage[]): any[] {
  const toolCalls: any[] = []

  for (const msg of messages) {
    if (msg.author !== 'GLEAN_AI') continue
    for (const frag of msg.fragments || []) {
      if (frag.action?.metadata) {
        const meta = frag.action.metadata
        toolCalls.push({
          name: meta.displayName || meta.name || 'unknown',
          type: meta.type,
          stepId: msg.stepId,
        })
      }
    }
  }

  return toolCalls
}

/**
 * Extract the reasoning chain — what the agent searched, read, and how it got to the answer
 */
function extractReasoningChain(messages: RunWorkflowMessage[]): any[] {
  const steps: any[] = []

  for (const msg of messages) {
    if (msg.author !== 'GLEAN_AI' || msg.messageType !== 'UPDATE') continue

    const step: any = { stepId: msg.stepId }

    // Collect search queries
    const queries = msg.fragments
      ?.filter(f => f.querySuggestion?.query)
      .map(f => f.querySuggestion!.query!) || []

    if (queries.length > 0) {
      step.type = 'search'
      step.queries = queries
    }

    // Collect documents read
    const docs = msg.fragments
      ?.filter(f => f.structuredResults)
      .flatMap(f => f.structuredResults!)
      .filter(r => r.document)
      .map(r => ({ title: r.document!.title, url: r.document!.url })) || []

    if (docs.length > 0) {
      step.type = step.type || 'read'
      step.documentsRead = docs
    }

    // Collect action metadata
    const action = msg.fragments?.find(f => f.action?.metadata)
    if (action?.action?.metadata) {
      step.action = action.action.metadata.displayName || action.action.metadata.name
      step.type = step.type || 'action'
    }

    // Collect text content (thinking, intermediate output, generated content)
    const textParts = msg.fragments
      ?.filter(f => f.text && f.text.trim())
      .map(f => f.text!.trim()) || []

    if (textParts.length > 0) {
      step.text = textParts.join(' ')
      step.type = step.type || 'thinking'
    }

    // Collect citations
    const citations = msg.fragments
      ?.filter(f => f.citation?.sourceDocument)
      .map(f => ({
        title: f.citation!.sourceDocument!.title,
        url: f.citation!.sourceDocument!.url,
      })) || []

    if (citations.length > 0) {
      step.citations = citations
    }

    // Only include steps that have meaningful content
    if (step.type) {
      steps.push(step)
    }
  }

  return steps
}

// ===== Multi-Turn Conversation =====

/**
 * Run a multi-turn conversation with an autonomous agent.
 *
 * Flow:
 * 1. Send initial query to agent via Chat API
 * 2. If agent asks a follow-up → simulator generates a user reply
 * 3. Send reply to agent (via chatId continuation)
 * 4. Repeat until agent gives a final answer or max turns reached
 *
 * Returns the full transcript and final response for judging.
 */
export async function runMultiTurnAgent(
  agentId: string,
  query: string,
  caseId: string,
  opts: {
    maxTurns?: number
    timeoutMs?: number
    evalGuidance?: string
    simulatorContext?: string
  } = {},
): Promise<AgentResult> {
  const maxTurns = opts.maxTurns ?? 5
  const timeoutMs = opts.timeoutMs ?? 300_000
  const startTime = Date.now()
  const transcript: ConversationTurn[] = []
  let chatId: string | undefined
  let lastAgentResponse = ''
  let allToolCalls: any[] = []
  let allReasoningSteps: any[] = []
  let traceId: string | undefined
  let stoppedReason: 'complete' | 'max_turns' | 'timeout' = 'max_turns'

  // Turn 1: Send initial query
  transcript.push({ role: 'user', content: query, timestamp: new Date() })

  for (let turn = 1; turn <= maxTurns; turn++) {
    // Check timeout
    if (Date.now() - startTime > timeoutMs) {
      stoppedReason = 'timeout'
      break
    }

    const userMessage = transcript[transcript.length - 1]
    if (userMessage.role !== 'user') break // Should never happen

    // Call the agent
    const payload: any = {
      messages: [{ fragments: [{ text: userMessage.content }] }],
      agentId,
      saveChat: false,
      timeoutMillis: Math.min(120_000, timeoutMs - (Date.now() - startTime)),
    }
    if (chatId) payload.chatId = chatId

    console.log(`  → Turn ${turn}/${maxTurns}...`)

    const response = await fetch(
      `${config.gleanBackend}/rest/api/v1/chat`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.gleanApiKey}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(120_000),
      }
    )

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Multi-turn chat error (turn ${turn}): ${response.status} - ${error}`)
    }

    const data = await response.json() as RunWorkflowResponse
    chatId = data.chatId

    // Extract agent response
    const responseText = extractContentWithFallback(data)
    if (!responseText) throw new Error(`No response from agent at turn ${turn}`)

    const turnToolCalls = extractToolCalls(data.messages)
    allToolCalls = allToolCalls.concat(turnToolCalls)

    const turnReasoningChain = extractReasoningChain(data.messages)
    allReasoningSteps = allReasoningSteps.concat(turnReasoningChain)

    const turnTraceId = data.messages?.find(m => m.workflowTraceId)?.workflowTraceId
    if (!traceId && turnTraceId) traceId = turnTraceId

    lastAgentResponse = responseText
    transcript.push({
      role: 'agent',
      content: responseText,
      toolCalls: turnToolCalls.length > 0 ? turnToolCalls : undefined,
      traceId: turnTraceId,
      timestamp: new Date(),
    })

    if (turnToolCalls.length > 0) {
      console.log(`    Tools: ${turnToolCalls.map(t => t.name).join(', ')}`)
    }

    // Check if we've reached max turns (don't simulate after last allowed turn)
    if (turn >= maxTurns) break

    // Ask simulator: is this conversation complete, or should we continue?
    const simResult = await generateUserReply(
      responseText,
      transcript,
      {
        originalQuery: query,
        evalGuidance: opts.evalGuidance,
        simulatorContext: opts.simulatorContext,
      }
    )

    if (simResult.isComplete) {
      stoppedReason = 'complete'
      console.log(`    → Conversation complete (${turn} turns)`)
      break
    }

    // Add simulated user reply and continue
    transcript.push({ role: 'user', content: simResult.reply, timestamp: new Date() })
    console.log(`    → Simulator: "${simResult.reply.slice(0, 80)}${simResult.reply.length > 80 ? '...' : ''}"`)
  }

  const latencyMs = Date.now() - startTime

  if (traceId) {
    console.log(`  → Trace: ${traceId.slice(0, 16)}...`)
  }
  console.log(`  → Mode: multi-turn (${transcript.filter(t => t.role === 'agent').length} agent turns, ${stoppedReason})`)

  return {
    caseId,
    query,
    response: lastAgentResponse,
    latencyMs,
    toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
    traceId,
    reasoningChain: allReasoningSteps.length > 0 ? allReasoningSteps : undefined,
    chatId,
    transcript,
    agentType: 'autonomous',
    timestamp: new Date(),
  }
}
