import { NextResponse } from 'next/server'
import { generateEvalSet } from '../../../../src/lib/generate'
import { fetchAgentInfo } from '../../../../src/lib/fetch-agent'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { agentId, count = 5 } = body

    if (!agentId) {
      return NextResponse.json(
        { error: 'Missing agent ID' },
        { status: 400 }
      )
    }

    // Fetch agent schema from Glean API
    const gleanBackend = process.env.GLEAN_BACKEND
    const apiKey = process.env.GLEAN_AGENT_API_KEY

    if (!gleanBackend || !apiKey) {
      return NextResponse.json(
        { error: 'Glean configuration missing' },
        { status: 500 }
      )
    }

    // Fetch agent info (name + description)
    const agentInfo = await fetchAgentInfo(agentId)

    // Fetch agent schema
    const schemaResp = await fetch(
      `${gleanBackend}/rest/api/v1/agents/${agentId}/schemas`,
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`
        }
      }
    )

    if (!schemaResp.ok) {
      return NextResponse.json(
        { error: `Failed to fetch agent schema: ${schemaResp.statusText}` },
        { status: schemaResp.status }
      )
    }

    const schema = await schemaResp.json()

    // Generate eval set using AI
    const generated = await generateEvalSet({
      agentId,
      count,
      schema,
      agentName: agentInfo?.name
    })

    return NextResponse.json(generated)
  } catch (error) {
    console.error('Error generating eval set:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate eval set' },
      { status: 500 }
    )
  }
}
