import { db, evalRuns, evalResults, evalScores, evalCases, evalCriteria, evalSets } from '@/lib/db'
import { eq } from 'drizzle-orm'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import ResultsTable from '@/components/ResultsTable'
import JudgeMethodology from '@/components/JudgeMethodology'

export const dynamic = 'force-dynamic'

async function getRunResults(runId: string) {
  const run = await db.select().from(evalRuns).where(eq(evalRuns.id, runId)).limit(1)
  if (!run[0]) return null

  // Fetch parent eval set name for breadcrumb navigation
  const evalSet = await db.select({ id: evalSets.id, name: evalSets.name })
    .from(evalSets)
    .where(eq(evalSets.id, run[0].evalSetId))
    .limit(1)
    .then(rows => rows[0])

  const results = await db.select().from(evalResults).where(eq(evalResults.runId, runId))

  const resultsWithDetails = await Promise.all(
    results.map(async (result) => {
      const testCase = await db
        .select()
        .from(evalCases)
        .where(eq(evalCases.id, result.caseId))
        .limit(1)
        .then((rows) => rows[0])

      const scores = await db
        .select()
        .from(evalScores)
        .where(eq(evalScores.resultId, result.id))

      const scoresWithCriteria = await Promise.all(
        scores.map(async (score) => {
          const criterion = await db
            .select()
            .from(evalCriteria)
            .where(eq(evalCriteria.id, score.criterionId))
            .limit(1)
            .then((rows) => rows[0])
          return {
            id: score.id,
            scoreValue: score.scoreValue,
            scoreCategory: score.scoreCategory,
            reasoning: score.reasoning,
            criterion: {
              id: criterion.id,
              name: criterion.name,
              scoreType: criterion.scoreType,
            }
          }
        })
      )

      return {
        id: result.id,
        case: {
          query: testCase?.query || '',
          evalGuidance: testCase?.evalGuidance || null,
        },
        agentResponse: result.agentResponse,
        agentTrace: result.agentTrace,
        latencyMs: result.latencyMs,
        totalTokens: result.totalTokens,
        toolCalls: result.toolCalls,
        scores: scoresWithCriteria,
      }
    })
  )

  // Calculate overall score from individual result scores
  const overallScores = results
    .map(r => r.overallScore)
    .filter(s => s !== null && s !== undefined)

  const overallScore = overallScores.length > 0
    ? overallScores.reduce((sum, score) => sum + score, 0) / overallScores.length
    : null

  // Parse config to get judge model and criteria
  const runConfig = run[0].config ? JSON.parse(run[0].config) : {}
  const judgeModel = runConfig.judgeModel || 'N/A'

  return {
    ...run[0],
    overallScore,
    judgeModel,
    criteria: runConfig.criteria || [],
    evalSetName: evalSet?.name || 'Eval Set',
    results: resultsWithDetails,
  }
}

export default async function RunResults({ params }: { params: { id: string } }) {
  const runData = await getRunResults(params.id)

  if (!runData) {
    notFound()
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-1.5 text-sm text-cement mb-3">
          <Link href="/" className="hover:text-[#1A1A1A] transition-colors">Dashboard</Link>
          <span className="text-cement-light">›</span>
          <Link href={`/sets/${runData.evalSetId}`} className="hover:text-[#1A1A1A] transition-colors">{runData.evalSetName}</Link>
          <span className="text-cement-light">›</span>
          <span className="text-[#1A1A1A] font-medium">Run Results</span>
        </div>
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Evaluation Results</h1>
            <p className="text-gray-600 mt-1">
              {runData.completedAt
                ? new Date(runData.completedAt).toLocaleString()
                : 'In progress...'}
            </p>
          </div>
          {runData.overallScore !== null && runData.overallScore !== undefined && (
            <div className="text-right">
              <div className="text-sm text-gray-500 mb-1">Overall Score</div>
              <div
                className={`text-5xl font-bold ${
                  runData.overallScore >= 7
                    ? 'text-score-success'
                    : runData.overallScore >= 4
                    ? 'text-score-warning'
                    : 'text-score-fail'
                }`}
              >
                {runData.overallScore.toFixed(1)}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Run Metadata */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <span className="text-sm text-gray-500">Judge Model</span>
            <p className="text-gray-900 font-mono text-sm mt-1">{runData.judgeModel}</p>
          </div>
          <div>
            <span className="text-sm text-gray-500">Total Cases</span>
            <p className="text-gray-900 font-semibold text-2xl mt-1">
              {runData.results.length}
            </p>
          </div>
          <div>
            <span className="text-sm text-gray-500">Status</span>
            <p className="text-gray-900 mt-1">
              {runData.completedAt ? 'Completed' : 'In Progress'}
            </p>
          </div>
        </div>
      </div>

      {/* Results Table */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-6">Test Case Results</h2>
        <ResultsTable results={runData.results} />
      </div>

      {/* Judge Methodology (read-only prompt inspection) */}
      <JudgeMethodology criteria={runData.criteria} />
    </div>
  )
}
