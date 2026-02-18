import { db, evalSets, evalCases, evalRuns, evalResults } from '@/lib/db'
import { eq, desc } from 'drizzle-orm'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import CaseTable from '@/components/CaseTable'
import RunEvalButton from '@/components/RunEvalButton'

export const dynamic = 'force-dynamic'

async function getEvalSet(id: string) {
  const set = await db.select().from(evalSets).where(eq(evalSets.id, id)).limit(1)
  if (!set[0]) return null

  const cases = await db.select().from(evalCases).where(eq(evalCases.evalSetId, id))

  const runs = await db
    .select()
    .from(evalRuns)
    .where(eq(evalRuns.evalSetId, id))
    .orderBy(desc(evalRuns.completedAt))
    .limit(5)

  // Calculate overall score for each run
  const runsWithScores = await Promise.all(
    runs.map(async (run) => {
      // Get results for this run
      const results = await db
        .select()
        .from(evalResults)
        .where(eq(evalResults.runId, run.id))

      // Calculate overall score
      const scores = results
        .map(r => r.overallScore)
        .filter(s => s !== null && s !== undefined)

      const overallScore = scores.length > 0
        ? scores.reduce((sum, score) => sum + score, 0) / scores.length
        : null

      // Parse config to get judge model
      const config = run.config ? JSON.parse(run.config) : {}
      const judgeModel = config.judgeModel || 'N/A'

      return {
        ...run,
        overallScore,
        judgeModel,
      }
    })
  )

  return {
    ...set[0],
    cases,
    recentRuns: runsWithScores,
  }
}

export default async function EvalSetDetail({ params }: { params: { id: string } }) {
  const evalSet = await getEvalSet(params.id)

  if (!evalSet) {
    notFound()
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 text-sm text-cement mb-2">
          <Link href="/" className="hover:text-gray-700">
            Dashboard
          </Link>
          <span>/</span>
          <span className="text-[#1A1A1A]">{evalSet.name}</span>
        </div>
        <h1 className="text-2xl font-semibold text-[#1A1A1A]">{evalSet.name}</h1>
        <p className="text-cement mt-1">{evalSet.description}</p>
      </div>

      {/* Metadata */}
      <div className="bg-white rounded-lg border border-border p-6 mb-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <span className="text-sm text-cement">Agent ID</span>
            <p className="text-[#1A1A1A] font-mono text-sm mt-1">{evalSet.agentId}</p>
          </div>
          <div>
            <span className="text-sm text-cement">Test Cases</span>
            <p className="text-[#1A1A1A] font-semibold text-2xl mt-1">
              {evalSet.cases.length}
            </p>
          </div>
          <div>
            <span className="text-sm text-cement">Created</span>
            <p className="text-[#1A1A1A] mt-1">
              {new Date(evalSet.createdAt).toLocaleDateString()}
            </p>
          </div>
        </div>
      </div>

      {/* Test Cases */}
      <div className="bg-white rounded-lg border border-border mb-8">
        <div className="flex justify-between items-center px-6 py-4 border-b border-border">
          <h2 className="text-xl font-semibold text-[#1A1A1A]">Test Cases</h2>
          <button className="px-4 py-2 text-sm bg-glean-blue text-white rounded-md hover:bg-glean-blue-hover transition-colors">
            + Add Case
          </button>
        </div>

        <CaseTable cases={evalSet.cases} evalSetId={params.id} />
      </div>

      {/* Recent Runs */}
      <div className="bg-white rounded-lg border border-border p-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-semibold text-[#1A1A1A]">Recent Runs</h2>
          <RunEvalButton evalSetId={params.id} hasCases={evalSet.cases.length > 0} />
        </div>

        {evalSet.recentRuns.length === 0 ? (
          <div className="text-center py-8 text-cement">
            No evaluation runs yet. Click "Run Evaluation" to start.
          </div>
        ) : (
          <div className="space-y-3">
            {evalSet.recentRuns.map((run) => (
              <Link
                key={run.id}
                href={`/runs/${run.id}`}
                className="block p-4 border border-border rounded-lg hover:border-glean-blue hover:shadow-card-hover transition-all"
              >
                <div className="flex justify-between items-center">
                  <div>
                    <p className="text-sm text-cement">
                      {run.completedAt
                        ? new Date(run.completedAt).toLocaleString()
                        : 'In progress...'}
                    </p>
                    <p className="text-xs text-cement-light mt-1">
                      Judge: {run.judgeModel || 'N/A'}
                    </p>
                  </div>
                  {run.overallScore !== null && run.overallScore !== undefined && (
                    <div
                      className={`text-2xl font-bold ${
                        run.overallScore >= 7
                          ? 'text-score-success'
                          : run.overallScore >= 4
                          ? 'text-score-warning'
                          : 'text-score-fail'
                      }`}
                    >
                      {run.overallScore.toFixed(1)}
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
