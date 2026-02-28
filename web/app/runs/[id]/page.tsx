import { db, evalRuns, evalResults, evalScores, evalCases, evalSets } from '@/lib/db'
import { getCriterion } from '../../../../src/criteria/defaults'
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

      const scoresWithCriteria = scores.map((score) => {
        const criterion = getCriterion(score.criterionId)
        return {
          id: score.id,
          scoreValue: score.scoreValue,
          scoreCategory: score.scoreCategory,
          reasoning: score.reasoning,
          criterion: {
            id: score.criterionId,
            name: criterion?.name || score.criterionId.replace(/_/g, ' '),
            scoreType: criterion?.scoreType || 'categorical',
          }
        }
      })

      return {
        id: result.id,
        case: {
          query: testCase?.query || '',
          evalGuidance: testCase?.evalGuidance || null,
        },
        agentResponse: result.agentResponse,
        agentTrace: result.agentTrace,
        transcript: result.transcript,
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
      <div className="mb-6">
        <div className="flex items-center gap-1.5 text-sm text-cement mb-3">
          <Link href="/" className="hover:text-[#1A1A1A] transition-colors">Dashboard</Link>
          <span className="text-cement-light">›</span>
          <Link href={`/sets/${runData.evalSetId}`} className="hover:text-[#1A1A1A] transition-colors">{runData.evalSetName}</Link>
          <span className="text-cement-light">›</span>
          <span className="text-[#1A1A1A] font-medium">Run Results</span>
        </div>
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-semibold text-[#1A1A1A]">Evaluation Results</h1>
            <p className="text-cement mt-1">
              {runData.completedAt
                ? new Date(runData.completedAt).toLocaleString()
                : 'In progress…'}
            </p>
          </div>
          {runData.overallScore !== null && runData.overallScore !== undefined && (
            <div className={`flex items-center justify-center w-20 h-20 rounded-full ${
              runData.overallScore >= 7
                ? 'bg-score-success-bg'
                : runData.overallScore >= 4
                ? 'bg-score-warning-bg'
                : 'bg-score-fail-bg'
            }`}>
              <span className={`text-3xl font-bold tabular-nums ${
                runData.overallScore >= 7
                  ? 'text-score-success'
                  : runData.overallScore >= 4
                  ? 'text-score-warning'
                  : 'text-score-fail'
              }`}>
                {runData.overallScore.toFixed(1)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Run Metadata */}
      <div className="bg-white rounded-lg shadow-card border border-border p-5 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <span className="text-xs font-medium text-cement uppercase tracking-wide">Judge Model</span>
            <p className="text-[#1A1A1A] font-mono text-sm mt-1">{runData.judgeModel}</p>
          </div>
          <div>
            <span className="text-xs font-medium text-cement uppercase tracking-wide">Total Cases</span>
            <p className="text-[#1A1A1A] font-semibold text-2xl mt-1">
              {runData.results.length}
            </p>
          </div>
          <div>
            <span className="text-xs font-medium text-cement uppercase tracking-wide">Status</span>
            <p className="text-[#1A1A1A] mt-1">
              {runData.completedAt ? 'Completed' : 'In Progress'}
            </p>
          </div>
        </div>
      </div>

      {/* Results Table */}
      <div className="bg-white rounded-lg shadow-card border border-border p-5">
        <h2 className="text-sm font-medium text-cement uppercase tracking-wide mb-4">Test Case Results</h2>
        <ResultsTable results={runData.results} />
      </div>

      {/* Judge Methodology (read-only prompt inspection) */}
      <JudgeMethodology criteria={runData.criteria} />
    </div>
  )
}
