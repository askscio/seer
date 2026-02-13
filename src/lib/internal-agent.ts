/**
 * Internal Glean API client for trace metadata access
 * Requires session cookie authentication (internal employees only)
 *
 * Why this exists:
 * - Internal APIs (/api/v1/*) provide trace metadata (token counts, tool calls)
 * - They require session cookies from browser SSO login, not Bearer tokens
 * - Public REST API (/rest/api/v1/*) does NOT include trace metadata
 */

import { config } from './config'

export interface InternalAgentRunRequest {
  agent_id: string
  messages?: Array<{
    role: string
    content: Array<{ text: string; type: string }>
  }>
  input?: Record<string, any>
}

export interface InternalAgentRunResponse {
  messages: Array<{
    role: string
    fragments: Array<{ text: string }>
    workflowTraceId?: string  // KEY: This is what we need for trace access!
  }>
}

export interface WorkflowTrace {
  trace: {
    spans: Array<{
      name: string
      attributes?: Record<string, {
        strValue?: string
        intValue?: string
        boolValue?: boolean
      }>
    }>
  }
}

/**
 * Custom error for expired session cookies
 */
export class SessionExpiredError extends Error {
  constructor() {
    super('Session cookie expired. Please refresh cookies from browser.')
    this.name = 'SessionExpiredError'
  }
}

/**
 * Run agent using internal API with session cookie authentication
 * Returns response with workflowTraceId for trace fetching
 */
export async function runAgentInternal(
  request: InternalAgentRunRequest
): Promise<InternalAgentRunResponse> {
  if (!config.gleanSessionCookie) {
    throw new Error(
      'GLEAN_SESSION_COOKIE not set. Required for internal API access.\n' +
      'See README for cookie extraction instructions.'
    )
  }

  const response = await fetch(
    `${config.gleanBackend}/api/v1/runworkflow`,  // Internal API endpoint
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': config.gleanSessionCookie,  // Session cookie auth (NOT Bearer token!)
      },
      body: JSON.stringify(request),
    }
  )

  if (response.status === 401) {
    throw new SessionExpiredError()
  }

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Internal API error: ${response.status} - ${error}`)
  }

  return response.json()
}

/**
 * Fetch workflow trace using internal API
 * Provides token counts, tool calls, execution spans
 */
export async function getWorkflowTrace(
  workflowTraceId: string,
  traceStartTime?: Date,
  traceEndTime?: Date
): Promise<WorkflowTrace> {
  if (!config.gleanSessionCookie) {
    throw new Error(
      'GLEAN_SESSION_COOKIE not set. Required for internal API access.\n' +
      'See README for cookie extraction instructions.'
    )
  }

  const response = await fetch(
    `${config.gleanBackend}/api/v1/getworkflowtrace`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': config.gleanSessionCookie,
      },
      body: JSON.stringify({
        workflowTraceId,
        isInternal: true,  // Flag for internal users
        pollUntilFound: true,
        // Optional: Add trace start/end times for faster Tempo queries
        ...(traceStartTime && { traceStartTime: traceStartTime.toISOString() }),
        ...(traceEndTime && { traceEndTime: traceEndTime.toISOString() }),
      }),
    }
  )

  if (response.status === 401) {
    throw new SessionExpiredError()
  }

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Trace API error: ${response.status} - ${error}`)
  }

  return response.json()
}

/**
 * Extract metrics from workflow trace spans
 * Returns token counts, tool calls, and LLM call details
 */
export function extractMetricsFromTrace(trace: WorkflowTrace): {
  totalTokens: number
  inputTokens: number
  outputTokens: number
  toolCallCount: number
  llmCalls: Array<{ inputTokens: number; outputTokens: number }>
} {
  let totalInputTokens = 0
  let totalOutputTokens = 0
  let toolCallCount = 0
  const llmCalls: Array<{ inputTokens: number; outputTokens: number }> = []

  for (const span of trace.trace?.spans || []) {
    const spanType = span.attributes?.['span.type']?.strValue

    // LLM calls - extract token usage
    if (spanType === 'llm_call') {
      const inputTokens = parseInt(span.attributes?.['input_tokens']?.intValue || '0')
      const outputTokens = parseInt(span.attributes?.['output_tokens']?.intValue || '0')

      totalInputTokens += inputTokens
      totalOutputTokens += outputTokens
      llmCalls.push({ inputTokens, outputTokens })
    }

    // Action spans - track tool usage
    if (spanType === 'action') {
      toolCallCount++
    }
  }

  return {
    totalTokens: totalInputTokens + totalOutputTokens,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    toolCallCount,
    llmCalls
  }
}
