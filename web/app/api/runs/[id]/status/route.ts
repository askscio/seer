import { NextResponse } from 'next/server'
import { db, evalRuns, evalResults, evalCases, evalSets } from '@/lib/db'
import { eq } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const run = await db.select().from(evalRuns).where(eq(evalRuns.id, params.id)).limit(1)
    if (!run[0]) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 })
    }

    // Count completed results for this run
    const results = await db
      .select({ id: evalResults.id })
      .from(evalResults)
      .where(eq(evalResults.runId, params.id))
    const completed = results.length

    // Get total cases in the eval set
    const cases = await db
      .select({ id: evalCases.id })
      .from(evalCases)
      .where(eq(evalCases.evalSetId, run[0].evalSetId))
    const total = cases.length

    return NextResponse.json({
      runId: params.id,
      status: run[0].status,
      completed,
      total,
    })
  } catch (error) {
    console.error('Error fetching run status:', error)
    return NextResponse.json(
      { error: 'Failed to fetch run status' },
      { status: 500 }
    )
  }
}
