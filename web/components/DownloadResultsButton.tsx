'use client'

interface ScoreRow {
  id: string
  scoreValue: number | null
  scoreCategory: string | null
  reasoning: string
  criterion: {
    id: string
    name: string
    scoreType: string
  }
}

interface ResultRow {
  id: string
  case: {
    query: string
    evalGuidance: string | null
  }
  agentResponse: string
  latencyMs: number
  totalTokens: number | null
  scores: ScoreRow[]
}

interface DownloadResultsButtonProps {
  runId: string
  evalSetId: string
  evalSetName: string
  completedAt?: string | number | Date | null
  results: ResultRow[]
}

const HEADERS = [
  'run_id',
  'eval_set_id',
  'eval_set_name',
  'completed_at',
  'result_id',
  'case_query',
  'eval_guidance',
  'agent_response',
  'latency_ms',
  'total_tokens',
  'criterion_id',
  'criterion_name',
  'score_type',
  'score_value',
  'score_category',
  'judge_reasoning',
] as const

function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '""'
  }

  const str = String(value)
  const escaped = str.replace(/"/g, '""')
  return `"${escaped}"`
}

function rowsToCsv(headers: string[], rows: Array<Record<string, unknown>>): string {
  const headerLine = headers.join(',')
  const dataLines = rows.map((row) => headers.map((header) => escapeCsvValue(row[header])).join(','))
  return [headerLine, ...dataLines].join('\n')
}

function normalizeCompletedAt(value?: string | number | Date | null): string {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString()
}

function sanitizeFilePart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export default function DownloadResultsButton({
  runId,
  evalSetId,
  evalSetName,
  completedAt,
  results,
}: DownloadResultsButtonProps) {
  const handleDownload = () => {
    const completedAtIso = normalizeCompletedAt(completedAt)
    const rows: Array<Record<string, unknown>> = []

    for (const result of results) {
      for (const score of result.scores) {
        rows.push({
          run_id: runId,
          eval_set_id: evalSetId,
          eval_set_name: evalSetName,
          completed_at: completedAtIso,
          result_id: result.id,
          case_query: result.case.query,
          eval_guidance: result.case.evalGuidance ?? '',
          agent_response: result.agentResponse,
          latency_ms: result.latencyMs,
          total_tokens: result.totalTokens ?? '',
          criterion_id: score.criterion.id,
          criterion_name: score.criterion.name,
          score_type: score.criterion.scoreType,
          score_value: score.scoreValue ?? '',
          score_category: score.scoreCategory ?? '',
          judge_reasoning: score.reasoning ?? '',
        })
      }
    }

    const csv = rowsToCsv([...HEADERS], rows)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')

    const safeSetName = sanitizeFilePart(evalSetName) || 'eval-set'
    anchor.href = url
    anchor.download = `${safeSetName}-${runId}-results-long.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <button
      onClick={handleDownload}
      disabled={results.length === 0}
      className="text-xs text-glean-blue hover:text-glean-blue-hover font-medium transition-colors whitespace-nowrap disabled:text-cement-light disabled:cursor-not-allowed"
    >
      ↓ Download CSV
    </button>
  )
}
