import { NextResponse } from 'next/server'
import { fetchAgentInfo } from '../../../../../src/lib/fetch-agent'
import { config } from '../../../../../src/lib/config'

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const agentInfo = await fetchAgentInfo(params.id)

    if (!agentInfo) {
      return NextResponse.json(
        { error: 'Agent not found' },
        { status: 404 }
      )
    }

    // Also fetch the schema for snapshot storage
    let schema = null
    try {
      const schemaResp = await fetch(
        `${config.gleanBackend}/rest/api/v1/agents/${params.id}/schemas`,
        { headers: { 'Authorization': `Bearer ${config.gleanApiKey}` } }
      )
      if (schemaResp.ok) {
        schema = await schemaResp.json()
      }
    } catch {
      // Schema fetch is best-effort — agent may not have a schema
    }

    return NextResponse.json({
      name: agentInfo.name,
      description: agentInfo.description,
      schema,
    })
  } catch (error) {
    console.error('Error fetching agent info:', error)
    return NextResponse.json(
      { error: 'Failed to fetch agent info' },
      { status: 500 }
    )
  }
}
