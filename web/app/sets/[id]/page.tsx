import { db, evalSets, evalCases, evalRuns, evalResults, evalScores } from '@/lib/db'
import { eq, desc } from 'drizzle-orm'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import EvalConfigSection from '@/components/EvalConfigSection'
import ResetRunsButton from '@/components/ResetRunsButton'
import CaseTable from '@/components/CaseTable'
import { InfoIcon } from '@/components/Tooltip'

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
    .limit(10)

  const runsWithScores = await Promise.all(
    runs.map(async (run) => {
      const results = await db
        .select()
        .from(evalResults)
        .where(eq(evalResults.runId, run.id))

      const scores = results
        .map(r => r.overallScore)
        .filter(s => s !== null && s !== undefined)

      const overallScore = scores.length > 0
        ? scores.reduce((sum, score) => sum + score, 0) / scores.length
        : null

      const config = run.config ? JSON.parse(run.config) : {}

      return {
        ...run,
        overallScore,
        judgeModel: config.judgeModel || 'Opus 4.6',
        criteria: config.criteria || [],
        caseCount: results.length,
      }
    })
  )

  return {
    ...set[0],
    cases,
    runs: runsWithScores,
  }
}

export default async function EvalSetDetail({ params }: { params: { id: string } }) {
  const evalSet = await getEvalSet(params.id)
  if (!evalSet) notFound()

  const latestRun = evalSet.runs[0] || null

  return (
    <div>
      {/* Breadcrumb + Header */}
      <div className="mb-6">
        <div className="flex items-center gap-1.5 text-sm text-cement mb-3">
          <Link href="/" className="hover:text-[#1A1A1A] transition-colors">Dashboard</Link>
          <span className="text-cement-light">›</span>
          <span className="text-[#1A1A1A] font-medium">{evalSet.name}</span>
        </div>
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-semibold text-[#1A1A1A]">{evalSet.name}</h1>
            <div className="flex items-center gap-4 mt-1.5">
              <span className="text-sm text-cement">
                <span className="font-mono text-xs">{evalSet.agentId.slice(0, 12)}…</span>
              </span>
              <span className="text-sm text-cement">
                {evalSet.cases.length} test inputs
              </span>
            </div>
            {/* Agent Schema (expandable) */}
            {evalSet.agentSchema && (
              <details className="mt-3">
                <summary className="text-xs text-cement cursor-pointer hover:text-[#1A1A1A] transition-colors select-none">
                  Agent Config
                </summary>
                <pre className="mt-2 p-3 bg-surface-page rounded-lg border border-border-subtle text-xs font-mono text-cement overflow-x-auto max-h-64 overflow-y-auto leading-relaxed">
                  {JSON.stringify(JSON.parse(evalSet.agentSchema), null, 2)}
                </pre>
              </details>
            )}
          </div>
        </div>
      </div>

      {/* Latest Run Hero */}
      {latestRun && latestRun.overallScore !== null ? (
        <div className="bg-white rounded-lg shadow-card border border-border p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <span className="text-xs font-medium text-cement uppercase tracking-wide">
              Latest Run
              <InfoIcon text="Scores are categorical (full/substantial/partial/minimal/failure) converted to 0-10 for display. Categorical scales show 15% higher reliability than continuous 1-10 scales (SJT research, Cavanagh 2026)." />
            </span>
              <p className="text-sm text-cement mt-0.5">
                {latestRun.completedAt
                  ? new Date(latestRun.completedAt).toLocaleString()
                  : 'In progress…'
                }
                {' · '}{latestRun.judgeModel}
                {' · '}{latestRun.caseCount} cases
              </p>
            </div>
            <Link
              href={`/runs/${latestRun.id}`}
              className="text-sm text-glean-blue hover:text-glean-blue-hover font-medium transition-colors"
            >
              View Details →
            </Link>
          </div>

          {/* Score display */}
          <div className="flex items-center gap-6">
            <div className={`flex items-center justify-center w-20 h-20 rounded-full ${
              latestRun.overallScore >= 7
                ? 'bg-score-success-bg'
                : latestRun.overallScore >= 4
                ? 'bg-score-warning-bg'
                : 'bg-score-fail-bg'
            }`}>
              <span className={`text-3xl font-bold tabular-nums ${
                latestRun.overallScore >= 7
                  ? 'text-score-success'
                  : latestRun.overallScore >= 4
                  ? 'text-score-warning'
                  : 'text-score-fail'
              }`}>
                {latestRun.overallScore.toFixed(1)}
              </span>
            </div>
            <div className="flex-1">
              {latestRun.criteria.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {latestRun.criteria.map((c: string) => {
                    const tooltips: Record<string, string> = {
                      topical_coverage: 'Reference-based: decomposes eval guidance into themes (COVERED/TOUCHED/MISSING) and scores coverage ratio. Eval guidance describes themes to cover, not exact text to match.',
                      response_quality: 'Reference-based: evaluates structure, conciseness, and actionability independent of factual content.',
                      groundedness: 'Reference-free: checks if claims are supported by docs the agent actually retrieved. No expected answer needed — immune to data staleness.',
                      hallucination_risk: 'Reference-free: flags specific claims (names, numbers, dates) that lack source backing in the agent\'s reasoning chain.',
                      factual_accuracy: 'Search-verified: judge independently searches company data to verify claims. Most expensive but catches factual errors other calls miss (Siro et al., GER-Eval).',
                    }
                    return (
                      <span key={c} className="text-xs px-2 py-1 rounded-full bg-surface-page border border-border-subtle text-cement inline-flex items-center gap-0.5">
                        {c.replace(/_/g, ' ')}
                        {tooltips[c] && <InfoIcon text={tooltips[c]} wide />}
                      </span>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-card border border-border p-8 mb-6 text-center">
          <p className="text-cement mb-2">No evaluation runs yet</p>
          <p className="text-xs text-cement-light">Configure and run an evaluation below</p>
        </div>
      )}

      {/* Eval Config Section (replaces modal) */}
      <EvalConfigSection evalSetId={params.id} hasCases={evalSet.cases.length > 0} />

      {/* Run History */}
      {evalSet.runs.length > 0 && (
        <div className="bg-white rounded-lg shadow-card border border-border mb-6">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <span className="text-xs font-medium text-cement uppercase tracking-wide">Run History</span>
            <ResetRunsButton evalSetId={params.id} />
          </div>
          <div className="divide-y divide-border-subtle">
            {evalSet.runs.map((run) => (
              <Link
                key={run.id}
                href={`/runs/${run.id}`}
                className="flex items-center justify-between px-5 py-3 hover:bg-surface-page/50 transition-colors"
              >
                <div className="flex items-center gap-4">
                  <span className="text-sm text-[#1A1A1A]">
                    {run.completedAt
                      ? new Date(run.completedAt).toLocaleString()
                      : 'Running…'
                    }
                  </span>
                  <span className="text-xs text-cement font-mono">{run.judgeModel}</span>
                  <span className="text-xs text-cement">{run.caseCount} cases</span>
                </div>
                {run.overallScore !== null && run.overallScore !== undefined && (
                  <span className={`text-lg font-semibold tabular-nums ${
                    run.overallScore >= 7
                      ? 'text-score-success'
                      : run.overallScore >= 4
                      ? 'text-score-warning'
                      : 'text-score-fail'
                  }`}>
                    {run.overallScore.toFixed(1)}
                  </span>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Test Inputs (CaseTable with edit/delete) */}
      <div className="bg-white rounded-lg shadow-card border border-border">
        <div className="px-5 py-3 border-b border-border">
          <span className="text-xs font-medium text-cement uppercase tracking-wide">
            Test Inputs ({evalSet.cases.length})
          </span>
        </div>
        <CaseTable cases={evalSet.cases} evalSetId={params.id} />
      </div>
    </div>
  )
}
