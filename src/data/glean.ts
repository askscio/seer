/**
 * Glean Agent API client for running agents and collecting responses
 *
 * Uses the public REST API: POST /rest/api/v1/agents/runs/wait
 *
 * Note on trace metadata:
 * - Public API does NOT include token counts or tool call details
 * - Internal API (/api/v1/runworkflow) has trace data but requires browser session cookies
 * - Session cookies can't be replayed from CLI due to Cloudflare TLS fingerprinting
 * - We keep internal API code for future use (e.g., Playwright-based approach, service account)
 */

import { config } from '../lib/config'
import type { AgentResult } from '../types'
import {
  runAgentInternal,
  getWorkflowTrace,
  extractMetricsFromTrace,
  SessionExpiredError
} from '../lib/internal-agent'

interface GleanAgentResponse {
  run?: {
    agent_id?: string
    status?: string
  }
  messages?: Array<{
    role?: string
    content?: Array<{
      text?: string
      type?: string
    }>
    workflowTraceId?: string
  }>
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
 *
 * Tries internal API first (if session cookie available) for trace metadata,
 * otherwise uses public REST API (response quality + latency only).
 */
export async function runAgent(
  agentId: string,
  query: string,
  caseId: string
): Promise<AgentResult> {
  const startTime = Date.now()

  // Try internal API first if session cookie is available
  if (config.gleanSessionCookie) {
    try {
      return await runAgentWithTrace(agentId, query, caseId, startTime)
    } catch (error) {
      if (error instanceof SessionExpiredError) {
        console.warn('  ⚠ Session cookie expired, falling back to public API')
      } else {
        console.warn('  ⚠ Internal API failed, falling back to public API:', error instanceof Error ? error.message : String(error))
      }
    }
  }

  // Public REST API (primary path)
  return await runAgentPublic(agentId, query, caseId, startTime)
}

/**
 * Run agent via public REST API
 * Endpoint: POST /rest/api/v1/agents/runs/wait
 *
 * For form-based agents: { agent_id, input: { fieldName: query } }
 * For chat-style agents: { agent_id, messages: [...] }
 */
async function runAgentPublic(
  agentId: string,
  query: string,
  caseId: string,
  startTime: number
): Promise<AgentResult> {
  const schema = await getAgentSchema(agentId)
  const inputSchema = schema.input_schema || {}
  const inputFields = Object.keys(inputSchema)
  const hasFormInputs = inputFields.length > 0

  // Build request body based on agent type
  const requestBody = hasFormInputs
    ? {
        agent_id: agentId,
        input: { [inputFields[0]]: query },
      }
    : {
        agent_id: agentId,
        messages: [{ role: 'USER', content: [{ text: query, type: 'text' }] }],
      }

  // POST to the correct endpoint (agent_id goes in body, NOT in URL path)
  const response = await fetch(
    `${config.gleanBackend}/rest/api/v1/agents/runs/wait`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.gleanAgentApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    }
  )

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Agent API error: ${response.status} - ${error}`)
  }

  const data = await response.json() as GleanAgentResponse

  return {
    caseId,
    query,
    response: extractResponse(data),
    latencyMs: Date.now() - startTime,
    totalTokens: undefined,  // Not available in public API
    toolCalls: undefined,     // Not available in public API
    timestamp: new Date(),
  }
}

/**
 * Run agent via internal API with full trace metadata
 * Requires GLEAN_SESSION_COOKIE from browser SSO
 */
async function runAgentWithTrace(
  agentId: string,
  query: string,
  caseId: string,
  startTime: number
): Promise<AgentResult> {
  const schema = await getAgentSchema(agentId)
  const inputSchema = schema.input_schema || {}
  const inputFields = Object.keys(inputSchema)
  const hasFormInputs = inputFields.length > 0

  const request = hasFormInputs
    ? {
        agent_id: agentId,
        input: { [inputFields[0]]: query },
      }
    : {
        agent_id: agentId,
        messages: [{ role: 'USER', content: [{ text: query, type: 'text' }] }],
      }

  const agentResponse = await runAgentInternal(request)

  // Extract workflow trace ID
  const workflowTraceId = agentResponse.messages
    .find(m => m.workflowTraceId)
    ?.workflowTraceId

  let totalTokens: number | undefined
  let toolCalls: any[] | undefined

  if (workflowTraceId) {
    try {
      const trace = await getWorkflowTrace(
        workflowTraceId,
        new Date(startTime),
        new Date()
      )
      const metrics = extractMetricsFromTrace(trace)
      totalTokens = metrics.totalTokens
      toolCalls = metrics.llmCalls.map((call, i) => ({
        name: `llm_call_${i}`,
        inputTokens: call.inputTokens,
        outputTokens: call.outputTokens,
      }))

      console.log(`  → Tokens: ${totalTokens} (${metrics.inputTokens} in, ${metrics.outputTokens} out)`)
      console.log(`  → Tool calls: ${metrics.toolCallCount}`)
    } catch (error) {
      console.warn('  ⚠ Failed to fetch trace:', error instanceof Error ? error.message : String(error))
    }
  }

  return {
    caseId,
    query,
    response: agentResponse.messages
      .filter(m => m.role === 'GLEAN_AI')
      .flatMap(m => m.fragments || [])
      .map(f => f.text)
      .join(''),
    latencyMs: Date.now() - startTime,
    totalTokens,
    toolCalls,
    timestamp: new Date(),
  }
}

/**
 * Extract text response from Glean API response
 */
function extractResponse(data: GleanAgentResponse): string {
  const aiMessages = data.messages?.filter(m => m.role === 'GLEAN_AI' || m.role === 'assistant')

  if (!aiMessages || aiMessages.length === 0) {
    const anyMessage = data.messages?.[0]
    if (anyMessage?.content?.[0]?.text) {
      return anyMessage.content[0].text
    }
    throw new Error('No response text found in agent output')
  }

  const texts = aiMessages
    .flatMap(msg => msg.content || [])
    .filter(c => c.type === 'text')
    .map(c => c.text)
    .filter(t => t)
    .join('')

  if (!texts) {
    throw new Error('No response text found in agent output')
  }

  return texts
}
