import { NextResponse } from 'next/server'
import { smartGenerate } from '../../../../src/lib/generate-agent'
import { fetchAgentInfo } from '../../../../src/lib/fetch-agent'
import { config } from '../../../../src/lib/config'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { agentId, count = 5, stream = false } = body

    if (!agentId) {
      return NextResponse.json(
        { error: 'Missing agent ID' },
        { status: 400 }
      )
    }

    // Fetch agent info (name + description)
    const agentInfo = await fetchAgentInfo(agentId)

    // Fetch agent schema
    const schemaResp = await fetch(
      `${config.gleanBackend}/rest/api/v1/agents/${agentId}/schemas`,
      {
        headers: {
          'Authorization': `Bearer ${config.gleanApiKey}`
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

    // SSE streaming mode
    if (stream) {
      const encoder = new TextEncoder()
      const readable = new ReadableStream({
        async start(controller) {
          const send = (data: any) => {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
          }

          try {
            const generated = await smartGenerate({
              agentId,
              agentName: agentInfo?.name || `Agent ${agentId.slice(0, 8)}`,
              agentDescription: agentInfo?.description || '',
              schema,
              count,
              onProgress: (event) => send(event),
            })

            // Send final result with metadata
            send({ phase: 'complete', name: generated.name, description: generated.description })
            controller.close()
          } catch (error) {
            send({ phase: 'error', message: error instanceof Error ? error.message : 'Generation failed' })
            controller.close()
          }
        },
      })

      return new Response(readable, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      })
    }

    // Non-streaming mode (CLI / legacy)
    const generated = await smartGenerate({
      agentId,
      agentName: agentInfo?.name || `Agent ${agentId.slice(0, 8)}`,
      agentDescription: agentInfo?.description || '',
      schema,
      count,
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
