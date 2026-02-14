/**
 * Glean Agent API client for running agents and collecting responses
 *
 * Auth: CHAT-scoped API key (Bearer token) — no cookies needed
 * Endpoint: POST /rest/api/v1/runworkflow
 * Payload format: { workflowId, fields/messages, stream: false, enableTrace: true }
 *
 * Returns: response text, trace ID, tool calls, reasoning chain (search queries, docs read)
 * Known limitation: token counts require /api/v1/getworkflowtrace (session-auth only, not exposed to API keys)
 */

import { config } from '../lib/config'
import type { AgentResult } from '../types'

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

// Cache schemas within a run to avoid repeated fetches
const schemaCache = new Map<string, AgentSchema>()

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
 * Run a Glean agent and collect the full response with trace metadata
 */
export async function runAgent(
  agentId: string,
  query: string,
  caseId: string
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
    payload.fields = { [inputFields[0]]: query }
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
    }
  )

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`runworkflow error: ${response.status} - ${error}`)
  }

  const data = await response.json() as RunWorkflowResponse
  const latencyMs = Date.now() - startTime

  // Trace metadata
  const firstMsg = data.messages?.[0]
  const traceId = firstMsg?.workflowTraceId

  if (traceId) {
    console.log(`  → Trace: ${traceId.slice(0, 16)}...`)
  }

  // Tool calls from action fragments
  const toolCalls = extractToolCalls(data.messages)
  if (toolCalls.length > 0) {
    console.log(`  → Tools: ${toolCalls.map(t => t.name).join(', ')}`)
  }

  // Final response text — CONTENT messages only (not intermediate UPDATE steps)
  const responseText = extractFinalResponse(data.messages)

  // Reasoning chain — search queries, docs read, steps taken
  const reasoningChain = extractReasoningChain(data.messages)

  return {
    caseId,
    query,
    response: responseText,
    latencyMs,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    traceId,
    reasoningChain: reasoningChain.length > 0 ? reasoningChain : undefined,
    timestamp: new Date(),
  }
}

/**
 * Extract final response text from CONTENT-type messages only
 * Skips intermediate UPDATE messages (search queries, "Searching...", etc.)
 */
function extractFinalResponse(messages: RunWorkflowMessage[]): string {
  const contentMessages = messages.filter(
    m => m.author === 'GLEAN_AI' && m.messageType === 'CONTENT'
  )

  const texts = contentMessages
    .flatMap(m => m.fragments || [])
    .map(f => f.text)
    .filter(t => t)
    .join('')

  if (!texts) {
    // Fallback: try all GLEAN_AI messages if no CONTENT type found
    const fallback = messages
      .filter(m => m.author === 'GLEAN_AI')
      .flatMap(m => m.fragments || [])
      .map(f => f.text)
      .filter(t => t)
      .join('')

    if (!fallback) throw new Error('No response text found in agent output')
    return fallback
  }

  return texts
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

    // Only include steps that have meaningful content
    if (step.type) {
      steps.push(step)
    }
  }

  return steps
}
