import { config } from './config'
import type { AgentType, AgentCapabilities } from '../types'

export interface AgentInfo {
  agent_id: string
  name: string
  description: string
  capabilities?: AgentCapabilities
  agentType: AgentType
}

/**
 * Fetch agent details from Glean API and classify agent type.
 *
 * Agent type is determined by capabilities:
 * - ap.io.messages = true → autonomous (Chat API, supports multi-turn)
 * - ap.io.messages absent → workflow (runworkflow API, single-turn)
 */
export async function fetchAgentInfo(agentId: string): Promise<AgentInfo | null> {
  try {
    const response = await fetch(
      `${config.gleanBackend}/rest/api/v1/agents/${agentId}`,
      {
        headers: {
          'Authorization': `Bearer ${config.gleanApiKey}`
        }
      }
    )

    if (!response.ok) {
      console.error(`Failed to fetch agent info: ${response.status}`)
      return null
    }

    const agent = await response.json() as {
      agent_id: string
      name: string
      description: string
      capabilities?: AgentCapabilities
    }

    const agentType = classifyAgentType(agent.capabilities)

    return {
      ...agent,
      agentType,
    }
  } catch (error) {
    console.error('Error fetching agent info:', error)
    return null
  }
}

/**
 * Classify agent type from capabilities.
 * Autonomous agents have ap.io.messages and work via /chat with agentId.
 * Workflow agents only have ap.io.streaming and work via /runworkflow.
 */
function classifyAgentType(capabilities?: AgentCapabilities): AgentType {
  if (!capabilities) return 'unknown'
  if (capabilities['ap.io.messages']) return 'autonomous'
  return 'workflow'
}
