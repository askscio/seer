/**
 * Glean Agent API client for running agents and collecting responses
 *
 * Uses the internal runworkflow endpoint: POST /rest/api/v1/runworkflow
 * with CHAT-scoped API key for trace metadata access.
 *
 * Discovery path:
 * - Public API (/rest/api/v1/agents/runs/wait) → no trace metadata
 * - Internal API (/api/v1/runworkflow) → requires browser session cookies
 * - REST-fronted internal (/rest/api/v1/runworkflow) → WORKS with CHAT-scoped key!
 *   Returns workflowTraceId, agentTraceInfo, and tool call details.
 */

import { config } from '../lib/config'
import type { AgentResult } from '../types'

interface RunWorkflowMessage {
  author: string
  fragments: Array<{
    text?: string
    action?: {
      metadata?: {
        type?: string
        name?: string
        displayName?: string
      }
    }
  }>
  workflowTraceId?: string
  agentTraceInfo?: {
    traceId: string
    startTimeMillis: number
  }
  stepId?: string
  messageType?: string
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

// Cache agent schemas to avoid repeated fetches within a run
const schemaCache = new Map<string, AgentSchema>()

/**
 * Fetch and cache agent schema
 */
async function getAgentSchema(agentId: string): Promise<AgentSchema> {
  if (schemaCache.has(agentId)) return schemaCache.get(agentId)!

  const resp = await fetch(
    `${config.gleanBackend}/rest/api/v1/agents/${agentId}/schemas`,
    { headers: { 'Authorization': `Bearer ${config.gleanAgentApiKey}` } }
  )

  if (!resp.ok) {
    throw new Error(`Failed to fetch agent schema: ${resp.status} ${resp.statusText}`)
  }

  const schema = await resp.json() as AgentSchema
  schemaCache.set(agentId, schema)
  return schema
}

/**
 * Run a Glean agent with a query and collect the response
 * Uses /rest/api/v1/runworkflow with CHAT-scoped key for trace access
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

  // Build payload in internal API format (discovered from Glean source)
  const payload: any = {
    workflowId: agentId,   // Internal API uses workflowId, not agent_id
    stream: false,
    enableTrace: true,      // Request trace metadata
  }

  if (hasFormInputs) {
    payload.fields = { [inputFields[0]]: query }  // Internal API uses "fields"
  } else {
    payload.messages = [{
      author: 'USER',                      // Internal API uses "author", not "role"
      fragments: [{ text: query }],        // Internal API uses "fragments", not "content"
    }]
  }

  // Use CHAT-scoped key on /rest/api/v1/runworkflow
  const response = await fetch(
    `${config.gleanBackend}/rest/api/v1/runworkflow`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.gleanChatApiKey}`,  // CHAT scope required!
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

  // Extract trace metadata from response messages
  const firstMsg = data.messages?.[0]
  const traceId = firstMsg?.workflowTraceId
  const traceInfo = firstMsg?.agentTraceInfo

  if (traceId) {
    console.log(`  → Trace ID: ${traceId.slice(0, 16)}...`)
  }

  // Extract tool calls from message fragments
  const toolCalls = extractToolCalls(data.messages)
  if (toolCalls.length > 0) {
    console.log(`  → Tool calls: ${toolCalls.length}`)
  }

  // Extract response text from GLEAN_AI messages
  const responseText = data.messages
    .filter(m => m.author === 'GLEAN_AI')
    .flatMap(m => m.fragments || [])
    .map(f => f.text)
    .filter(t => t)
    .join('')

  if (!responseText) {
    throw new Error('No response text found in agent output')
  }

  return {
    caseId,
    query,
    response: responseText,
    latencyMs,
    totalTokens: undefined,  // Token counts require getworkflowtrace (not yet accessible)
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    traceId,
    timestamp: new Date(),
  }
}

/**
 * Extract tool call information from message fragments
 * The runworkflow response embeds action metadata in fragments
 */
function extractToolCalls(messages: RunWorkflowMessage[]): any[] {
  const toolCalls: any[] = []

  for (const msg of messages) {
    if (msg.author !== 'GLEAN_AI') continue

    for (const fragment of msg.fragments || []) {
      if (fragment.action?.metadata) {
        const meta = fragment.action.metadata
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
