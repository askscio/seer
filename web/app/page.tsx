import Link from 'next/link'
import { db, evalSets, evalCases, evalRuns, evalResults } from '@/lib/db'
import { desc, eq, sql } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

interface EvalSetWithStats {
  id: string
  name: string
  description: string
  agentId: string
  createdAt: Date
  caseCount: number
  lastRunDate: Date | null
  lastScore: number | null
}

async function getEvalSetsWithStats(): Promise<EvalSetWithStats[]> {
  // Get all eval sets
  const sets = await db.select().from(evalSets).orderBy(desc(evalSets.createdAt))

  // Get stats for each set
  const setsWithStats = await Promise.all(
    sets.map(async (set) => {
      // Count cases
      const caseCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(evalCases)
        .where(eq(evalCases.evalSetId, set.id))
        .then((rows) => rows[0]?.count || 0)

      // Get last run
      const lastRun = await db
        .select()
        .from(evalRuns)
        .where(eq(evalRuns.evalSetId, set.id))
        .orderBy(desc(evalRuns.completedAt))
        .limit(1)
        .then((rows) => rows[0] || null)

      // Calculate overall score from results if run exists
      let lastScore = null
      if (lastRun) {
        const results = await db
          .select()
          .from(evalResults)
          .where(eq(evalResults.runId, lastRun.id))

        const scores = results
          .map(r => r.overallScore)
          .filter(s => s !== null && s !== undefined)

        lastScore = scores.length > 0
          ? scores.reduce((sum, score) => sum + score, 0) / scores.length
          : null
      }

      return {
        ...set,
        caseCount,
        lastRunDate: lastRun?.completedAt || null,
        lastScore,
      }
    })
  )

  return setsWithStats
}

export default async function Dashboard() {
  const evalSetsData = await getEvalSetsWithStats()

  return (
    <div>
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Evaluation Sets</h1>
          <p className="text-gray-600 mt-1">
            Manage and run agent evaluations
          </p>
        </div>
        <Link
          href="/sets/new"
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          + New Eval Set
        </Link>
      </div>

      {/* Eval Sets Grid */}
      {evalSetsData.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
          <p className="text-gray-500 text-lg mb-4">No evaluation sets yet</p>
          <Link
            href="/sets/new"
            className="text-blue-600 hover:text-blue-700 font-medium"
          >
            Create your first eval set →
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {evalSetsData.map((set) => (
            <Link
              key={set.id}
              href={`/sets/${set.id}`}
              className="block bg-white rounded-lg border border-gray-200 p-6 hover:border-blue-500 hover:shadow-md transition-all"
            >
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                {set.name}
              </h3>
              <p className="text-sm text-gray-600 mb-4 line-clamp-2">
                {set.description}
              </p>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Agent ID:</span>
                  <span className="text-gray-900 font-mono text-xs">
                    {set.agentId.slice(0, 8)}...
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Test Cases:</span>
                  <span className="text-gray-900 font-semibold">
                    {set.caseCount}
                  </span>
                </div>
                {set.lastRunDate && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Last Run:</span>
                      <span className="text-gray-900">
                        {new Date(set.lastRunDate).toLocaleDateString()}
                      </span>
                    </div>
                    {set.lastScore !== null && set.lastScore !== undefined && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">Last Score:</span>
                        <span
                          className={`font-semibold ${
                            set.lastScore >= 7
                              ? 'text-score-success'
                              : set.lastScore >= 4
                              ? 'text-score-warning'
                              : 'text-score-fail'
                          }`}
                        >
                          {set.lastScore.toFixed(1)}/10
                        </span>
                      </div>
                    )}
                  </>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
