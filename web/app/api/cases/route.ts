import { NextResponse } from 'next/server'
import { db, evalCases } from '@/lib/db'
import { nanoid } from 'nanoid'
import { eq } from 'drizzle-orm'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { evalSetId, query, evalGuidance, context, fields, simulatorContext, simulatorStrategy } = body

    if (!evalSetId || !query) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Generate CLI-safe ID
    let id = nanoid(12)
    while (id.startsWith('-')) {
      id = nanoid(12)
    }

    const newCase = await db.insert(evalCases).values({
      id,
      evalSetId,
      query,
      evalGuidance: evalGuidance || null,
      context: context || null,
      metadata: (fields || simulatorContext || simulatorStrategy) ? JSON.stringify({ fields: fields || undefined, simulatorContext: simulatorContext || undefined, simulatorStrategy: simulatorStrategy || undefined }) : null,
      createdAt: new Date(),
    }).returning()

    return NextResponse.json(newCase[0], { status: 201 })
  } catch (error) {
    console.error('Error creating eval case:', error)
    return NextResponse.json(
      { error: 'Failed to create eval case' },
      { status: 500 }
    )
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json()
    const { id, query, evalGuidance, context, metadata } = body

    if (!id) {
      return NextResponse.json({ error: 'Missing case ID' }, { status: 400 })
    }

    const updates: any = {}
    if (query !== undefined) updates.query = query
    if (evalGuidance !== undefined) updates.evalGuidance = evalGuidance
    if (context !== undefined) updates.context = context
    if (metadata !== undefined) updates.metadata = metadata

    const updated = await db
      .update(evalCases)
      .set(updates)
      .where(eq(evalCases.id, id))
      .returning()

    return NextResponse.json(updated[0])
  } catch (error) {
    console.error('Error updating eval case:', error)
    return NextResponse.json(
      { error: 'Failed to update eval case' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Missing case ID' }, { status: 400 })
    }

    await db.delete(evalCases).where(eq(evalCases.id, id))

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting eval case:', error)
    return NextResponse.json(
      { error: 'Failed to delete eval case' },
      { status: 500 }
    )
  }
}
