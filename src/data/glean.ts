/**
 * Glean Agent API client for running agents and collecting responses
 */

import { config } from '../lib/config'
import type { AgentResult } from '../types'

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
    // First, fetch the agent's schema to determine input type
    const schemaResp = await fetch(
      `${config.gleanBackend}/rest/api/v1/agents/${agentId}/schemas`,
      {
        headers: {
          'Authorization': `Bearer ${config.gleanAgentApiKey}`
        }
      }
    )

    const schema = await schemaResp.json() as any
    const inputSchema = schema.input_schema || {}
    const hasFormInputs = Object.keys(inputSchema).length > 0

    // Build request body based on agent type
    let requestBody: any = { agent_id: agentId }

    if (hasFormInputs) {
      // Form-based agent: map query to first input field
      const firstFieldName = Object.keys(inputSchema)[0]
      requestBody.input = {
        [firstFieldName]: query
      }
    } else {
      // Chat-style agent: use messages array
      requestBody.messages = [
        {
          role: 'USER',
          content: [
            {
              text: query,
              type: 'text'
            }
          ]
        }
      ]
    }

    // Call Glean Agent API - runs/wait endpoint (blocking)
    const response = await fetch(
      `${config.gleanBackend}/rest/api/v1/agents/runs/wait`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.gleanAgentApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Glean API error response:', errorText)
      throw new Error(`Glean API error: ${response.status} ${response.statusText} - ${errorText}`)
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
  // Messages array contains the agent's responses
  // Look for GLEAN_AI role messages
  const aiMessages = data.messages?.filter(m => m.role === 'GLEAN_AI' || m.role === 'assistant')

  if (!aiMessages || aiMessages.length === 0) {
    // Fallback: try any message
    const anyMessage = data.messages?.[0]
    if (anyMessage?.content?.[0]?.text) {
      return anyMessage.content[0].text
    }
    throw new Error('No response text found in agent output')
  }

  // Concatenate all text content from AI messages
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

/**
 * Extract tool calls from Glean API response
 */
function extractToolCalls(data: GleanAgentResponse): any[] {
  return data.tool_calls || []
}
