import { config } from './config'

export interface AgentInfo {
  agent_id: string
  name: string
  description: string
}

/**
 * Fetch agent details from Glean API
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

    const agent = await response.json() as AgentInfo
    return agent
  } catch (error) {
    console.error('Error fetching agent info:', error)
    return null
  }
}
