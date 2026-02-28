import { NextResponse } from 'next/server'
import { db, evalSets } from '@/lib/db'
import { nanoid } from 'nanoid'

export async function GET() {
  try {
    const sets = await db.select().from(evalSets)
    return NextResponse.json(sets)
  } catch (error) {
    console.error('Error fetching eval sets:', error)
    return NextResponse.json(
      { error: 'Failed to fetch eval sets' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { name, description, agentId, agentSchema, agentType } = body

    if (!name || !description || !agentId) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Generate ID that doesn't start with dash (CLI-safe)
    let id = nanoid(12)
    while (id.startsWith('-')) {
      id = nanoid(12)
    }

    const newSet = await db.insert(evalSets).values({
      id,
      name,
      description,
      agentId,
      agentSchema: agentSchema ? JSON.stringify(agentSchema) : null,
      agentType: agentType || null,
      createdAt: new Date(),
    }).returning()

    return NextResponse.json(newSet[0], { status: 201 })
  } catch (error) {
    console.error('Error creating eval set:', error)
    return NextResponse.json(
      { error: 'Failed to create eval set' },
      { status: 500 }
    )
  }
}
