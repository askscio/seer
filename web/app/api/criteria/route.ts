import { NextResponse } from 'next/server'
import { db, evalCriteria } from '@/lib/db'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'

// GET: list all custom (non-default) criteria
export async function GET() {
  try {
    const criteria = await db.select().from(evalCriteria).where(eq(evalCriteria.isDefault, false))
    return NextResponse.json(criteria)
  } catch (error) {
    console.error('Error fetching custom criteria:', error)
    return NextResponse.json({ error: 'Failed to fetch criteria' }, { status: 500 })
  }
}

// POST: create a new custom criterion
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { name, description, rubric, scaleType } = body

    if (!name || !rubric) {
      return NextResponse.json({ error: 'Name and rubric are required' }, { status: 400 })
    }

    // Generate a slug-style ID from the name
    const id = `custom_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_+$/, '')}`

    // Scale configs
    const SCALES: Record<string, any> = {
      '5-level': {
        categories: ['full', 'substantial', 'partial', 'minimal', 'failure'],
        categoryValues: { full: 10, substantial: 7.5, partial: 5, minimal: 2.5, failure: 0 },
      },
      '3-level': {
        categories: ['low', 'medium', 'high'],
        categoryValues: { low: 10, medium: 5, high: 0 },
      },
      binary: {
        categories: ['yes', 'no'],
        categoryValues: { yes: 10, no: 0 },
      },
    }

    const scale = SCALES[scaleType] || SCALES['5-level']

    await db.insert(evalCriteria).values({
      id,
      name,
      description: description || null,
      rubric,
      scoreType: scaleType === 'binary' ? 'binary' : 'categorical',
      scaleConfig: JSON.stringify(scale),
      weight: 1.0,
      isDefault: false,
    })

    return NextResponse.json({ id, name }, { status: 201 })
  } catch (error) {
    console.error('Error creating criterion:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create criterion' },
      { status: 500 }
    )
  }
}

// DELETE: remove a custom criterion
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Missing criterion ID' }, { status: 400 })
    }

    // Don't allow deleting defaults
    const criterion = await db.select().from(evalCriteria).where(eq(evalCriteria.id, id)).limit(1)
    if (criterion[0]?.isDefault) {
      return NextResponse.json({ error: 'Cannot delete default criteria' }, { status: 400 })
    }

    await db.delete(evalCriteria).where(eq(evalCriteria.id, id))
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting criterion:', error)
    return NextResponse.json({ error: 'Failed to delete criterion' }, { status: 500 })
  }
}
