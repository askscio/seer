import Link from 'next/link'
import { db, evalSets, evalCases, evalRuns, evalResults } from '@/lib/db'
import { desc, eq, sql } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

interface EvalSetWithStats {
  id: string
  name: string
  description: string
  agentId: string
  agentType: string | null
  createdAt: Date
  caseCount: number
  runCount: number
  lastRunDate: Date | null
  lastScore: number | null
  avgScore: number | null
}

async function getEvalSetsWithStats(): Promise<EvalSetWithStats[]> {
  const sets = await db.select().from(evalSets).orderBy(desc(evalSets.createdAt))

  const setsWithStats = await Promise.all(
    sets.map(async (set) => {
      const caseCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(evalCases)
        .where(eq(evalCases.evalSetId, set.id))
        .then((rows) => rows[0]?.count || 0)

      const lastRun = await db
        .select()
        .from(evalRuns)
        .where(eq(evalRuns.evalSetId, set.id))
        .orderBy(desc(evalRuns.completedAt))
        .limit(1)
        .then((rows) => rows[0] || null)

      // All completed runs for this set
      const allRuns = await db
        .select()
        .from(evalRuns)
        .where(eq(evalRuns.evalSetId, set.id))

      const completedRuns = allRuns.filter(r => r.status === 'completed')

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

      // Average score across ALL completed runs
      let avgScore = null
      if (completedRuns.length > 0) {
        const allRunScores: number[] = []
        for (const run of completedRuns) {
          const results = await db
            .select()
            .from(evalResults)
            .where(eq(evalResults.runId, run.id))
          const scores = results
            .map(r => r.overallScore)
            .filter((s): s is number => s !== null && s !== undefined)
          if (scores.length > 0) {
            allRunScores.push(scores.reduce((sum, s) => sum + s, 0) / scores.length)
          }
        }
        avgScore = allRunScores.length > 0
          ? allRunScores.reduce((sum, s) => sum + s, 0) / allRunScores.length
          : null
      }

      return {
        ...set,
        caseCount,
        runCount: completedRuns.length,
        lastRunDate: lastRun?.completedAt || null,
        lastScore,
        avgScore,
      }
    })
  )

  return setsWithStats
}

export default async function Dashboard() {
  const evalSetsData = await getEvalSetsWithStats()

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-[#1A1A1A]">Evaluation Sets</h1>
          <p className="text-sm text-cement mt-1">
            Manage and run agent evaluations
          </p>
        </div>
        <Link
          href="/sets/new"
          className="px-4 py-2 bg-glean-blue text-white text-sm font-medium rounded-md hover:bg-glean-blue-hover transition-colors"
        >
          + New Eval Set
        </Link>
      </div>

      {evalSetsData.length === 0 ? (
        <div className="bg-white rounded-lg shadow-card border border-border p-12 text-center">
          <p className="text-base text-cement mb-4">No evaluation sets yet</p>
          <Link
            href="/sets/new"
            className="text-glean-blue hover:underline font-medium"
          >
            Create your first eval set →
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {evalSetsData.map((set) => (
            <Link
              key={set.id}
              href={`/sets/${set.id}`}
              className="block bg-white rounded-lg shadow-card border border-border p-5 hover:shadow-card-hover hover:border-glean-blue transition-all duration-200"
            >
              <h3 className="text-base font-semibold text-[#1A1A1A] mb-1.5">
                {set.name}
              </h3>
              <p className="text-sm text-cement mb-4 line-clamp-2">
                {set.description}
              </p>

              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-cement">Agent</span>
                  <span className="font-mono text-xs text-cement">
                    {set.agentId.slice(0, 8)}…
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-cement">Cases</span>
                  <span className="text-[#1A1A1A] font-semibold tabular-nums">
                    {set.caseCount}
                  </span>
                </div>
                {set.lastRunDate && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-cement">Last Run</span>
                      <span className="text-[#1A1A1A]">
                        {new Date(set.lastRunDate).toLocaleDateString()}
                      </span>
                    </div>
                    {set.lastScore !== null && set.lastScore !== undefined && (
                      <div className="flex justify-between">
                        <span className="text-cement">Score</span>
                        <span
                          className={`font-semibold tabular-nums ${
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
                    {set.avgScore !== null && set.runCount > 1 && (
                      <div className="flex justify-between">
                        <span className="text-cement">Avg ({set.runCount} runs)</span>
                        <span
                          className={`font-medium tabular-nums text-xs ${
                            set.avgScore >= 7
                              ? 'text-score-success'
                              : set.avgScore >= 4
                              ? 'text-score-warning'
                              : 'text-score-fail'
                          }`}
                        >
                          {set.avgScore.toFixed(1)}/10
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
