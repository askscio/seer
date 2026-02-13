/**
 * Glean Agent API client for running agents and collecting responses
 */

import { config } from '../lib/config'
import type { AgentResult } from '../types'

interface GleanAgentResponse {
  messages?: Array<{
    fragments?: Array<{
      text?: string
    }>
  }>
  usage?: {
    total_tokens?: number
  }
  tool_calls?: any[]
}

/**
 * Run a Glean agent with a query and collect the response
 */
export async function runAgent(
  agentId: string,
  query: string,
  caseId: string
): Promise<AgentResult> {
  const startTime = Date.now()

  try {
    // Call Glean Agent API (REST API endpoint)
    const response = await fetch(
      `${config.gleanBackend}/rest/api/v1/agents/${agentId}/run`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.gleanApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messages: [{ fragments: [{ text: query }] }]
        })
      }
    )

    if (!response.ok) {
      throw new Error(`Glean API error: ${response.status} ${response.statusText}`)
    }

    const data = await response.json() as GleanAgentResponse
    const latencyMs = Date.now() - startTime

    return {
      caseId,
      query,
      response: extractResponse(data),
      latencyMs,
      totalTokens: data.usage?.total_tokens,
      toolCalls: extractToolCalls(data),
      timestamp: new Date()
    }
  } catch (error) {
    const latencyMs = Date.now() - startTime
    throw new Error(`Failed to run agent: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Extract text response from Glean API response
 */
function extractResponse(data: GleanAgentResponse): string {
  const text = data.messages?.[0]?.fragments?.[0]?.text
  if (!text) {
    throw new Error('No response text found in agent output')
  }
  return text
}

/**
 * Extract tool calls from Glean API response
 */
function extractToolCalls(data: GleanAgentResponse): any[] {
  return data.tool_calls || []
}
