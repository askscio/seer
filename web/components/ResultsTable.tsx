'use client'

import { useState } from 'react'
import { Markdown } from './Markdown'
import { InfoIcon } from './Tooltip'

interface Score {
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
  agentTrace: string | null
  latencyMs: number
  totalTokens: number | null
  toolCalls: string | null
  scores: Score[]
}

interface ResultsTableProps {
  results: ResultRow[]
}

import { DIMENSIONS } from '@/lib/dimensions'

export default function ResultsTable({ results }: ResultsTableProps) {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [expandedTraces, setExpandedTraces] = useState<Set<string>>(new Set())

  if (results.length === 0) {
    return (
      <div className="text-center py-12 text-cement">
        No results available yet.
      </div>
    )
  }

  // Get unique criteria from first result (all results should have same criteria)
  const criteria = results[0]?.scores.map((s) => s.criterion) || []

  const toggleRow = (rowId: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev)
      if (next.has(rowId)) {
        next.delete(rowId)
      } else {
        next.add(rowId)
      }
      return next
    })
  }

  const toggleTrace = (rowId: string) => {
    setExpandedTraces((prev) => {
      const next = new Set(prev)
      if (next.has(rowId)) {
        next.delete(rowId)
      } else {
        next.add(rowId)
      }
      return next
    })
  }

  const getScoreDisplay = (score: Score) => {
    const { scoreValue, scoreCategory, criterion } = score

    // Metric type - show raw value
    if (criterion.scoreType === 'metric') {
      return <span className="text-cement font-mono text-sm">{scoreValue}</span>
    }

    // Categorical - show category name
    if (criterion.scoreType === 'categorical') {
      const categoryColors: Record<string, string> = {
        full: 'bg-score-success-bg text-score-success',
        substantial: 'bg-score-success-bg text-score-success',
        partial: 'bg-score-warning-bg text-score-warning',
        minimal: 'bg-score-fail-bg text-score-fail',
        failure: 'bg-score-fail-bg text-score-fail',
        low: 'bg-score-success-bg text-score-success',
        medium: 'bg-score-warning-bg text-score-warning',
        high: 'bg-score-fail-bg text-score-fail',
      }
      const colorClass = categoryColors[scoreCategory?.toLowerCase() || ''] || 'bg-surface-page text-cement'
      return (
        <span className={`px-2 py-1 text-xs font-semibold rounded ${colorClass}`}>
          {scoreCategory}
        </span>
      )
    }

    // Binary - show Yes/No
    if (criterion.scoreType === 'binary') {
      const isYes = scoreValue === 1
      return (
        <span
          className={`px-2 py-1 text-xs font-semibold rounded ${
            isYes ? 'bg-score-success-bg text-score-success' : 'bg-score-fail-bg text-score-fail'
          }`}
        >
          {isYes ? 'Yes' : 'No'}
        </span>
      )
    }

    // Continuous (0-10) - show score with color coding
    if (scoreValue !== null) {
      const colorClass =
        scoreValue >= 7
          ? 'text-score-success'
          : scoreValue >= 4
          ? 'text-score-warning'
          : 'text-score-fail'
      return <span className={`font-bold ${colorClass}`}>{scoreValue.toFixed(1)}</span>
    }

    return <span className="text-cement-light">-</span>
  }

  const getScoreForCriterion = (result: ResultRow, criterionId: string): Score | undefined => {
    return result.scores.find((s) => s.criterion.id === criterionId)
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-surface-page border-b border-border">
            <th className="text-left px-4 py-3 text-xs font-medium text-cement uppercase tracking-wide w-12">
              #
            </th>
            <th className="text-left px-4 py-3 text-xs font-medium text-cement uppercase tracking-wide w-[25%]">
              Input
            </th>
            <th className="text-left px-4 py-3 text-xs font-medium text-cement uppercase tracking-wide w-[25%]">
              Output
            </th>
            {criteria.map((criterion) => {
              const dim = DIMENSIONS[criterion.id]
              return (
                <th
                  key={criterion.id}
                  className="text-center px-4 py-3 text-xs font-medium text-cement uppercase tracking-wide"
                >
                  <span className="inline-flex items-center gap-0.5">
                    {criterion.name}
                    {dim && <InfoIcon text={dim.tooltip} wide />}
                  </span>
                </th>
              )
            })}
            <th className="text-center px-4 py-3 text-xs font-medium text-cement uppercase tracking-wide w-16">
              Details
            </th>
          </tr>
        </thead>
        <tbody>
          {results.map((result, index) => {
            const isExpanded = expandedRows.has(result.id)
            const toolCallCount = result.toolCalls ? JSON.parse(result.toolCalls).length : 0

            return (
              <>
                {/* Main row */}
                <tr
                  key={result.id}
                  className="border-b border-border-subtle hover:bg-surface-page/50 cursor-pointer"
                  onClick={() => toggleRow(result.id)}
                >
                  <td className="px-4 py-3 text-sm text-cement">{index + 1}</td>
                  <td className="px-4 py-3">
                    <div className="text-sm text-[#1A1A1A] line-clamp-3">
                      {result.case?.query}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-sm text-cement line-clamp-3">
                      {result.agentResponse}
                    </div>
                  </td>
                  {criteria.map((criterion) => {
                    const score = getScoreForCriterion(result, criterion.id)
                    return (
                      <td key={criterion.id} className="px-4 py-3 text-center">
                        {score ? getScoreDisplay(score) : <span className="text-cement-light">-</span>}
                      </td>
                    )
                  })}
                  <td className="px-4 py-3 text-center">
                    <button
                      className="text-cement hover:text-[#1A1A1A] text-sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleRow(result.id)
                      }}
                    >
                      {isExpanded ? '▲' : '▼'}
                    </button>
                  </td>
                </tr>

                {/* Expanded details row */}
                {isExpanded && (
                  <tr className="bg-surface-page">
                    <td colSpan={criteria.length + 4} className="px-4 py-4">
                      <div className="space-y-4">
                        {/* Full query and response */}
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="text-xs font-semibold text-cement uppercase tracking-wide block mb-2">
                              Full Query
                            </label>
                            <Markdown content={result.case?.query || ''} className="text-[#1A1A1A]" />
                          </div>
                          <div>
                            <label className="text-xs font-semibold text-cement uppercase tracking-wide block mb-2">
                              Agent Response
                            </label>
                            <Markdown content={result.agentResponse} className="text-[#1A1A1A]" />
                          </div>
                        </div>

                        {/* Metrics */}
                        <div className="flex gap-6 text-sm">
                          <span className="text-[#1A1A1A]">
                            <strong>Latency:</strong> {result.latencyMs}ms
                          </span>
                          {result.totalTokens !== null && result.totalTokens !== undefined ? (
                            <span className="text-[#1A1A1A]">
                              <strong>Tokens:</strong> {result.totalTokens.toLocaleString()}
                            </span>
                          ) : (
                            <span className="text-cement-light" title="Trace not available for this run">
                              <strong>Tokens:</strong> N/A
                            </span>
                          )}
                          {toolCallCount > 0 ? (
                            <span className="text-[#1A1A1A]">
                              <strong>Tool Calls:</strong> {toolCallCount}
                            </span>
                          ) : (
                            <span className="text-cement-light" title="No tools used or trace not available">
                              <strong>Tool Calls:</strong> 0
                            </span>
                          )}
                        </div>

                        {/* Tool calls detail */}
                        {result.toolCalls && JSON.parse(result.toolCalls).length > 0 && (
                          <div>
                            <label className="text-xs font-semibold text-cement uppercase tracking-wide block mb-3">
                              Tool Calls ({JSON.parse(result.toolCalls).length})
                            </label>
                            <div className="space-y-2">
                              {JSON.parse(result.toolCalls).map((tool: any, idx: number) => (
                                <div
                                  key={idx}
                                  className="p-3 bg-white rounded border border-border text-sm"
                                >
                                  <div className="flex justify-between items-start mb-1">
                                    <span className="font-medium text-[#1A1A1A]">
                                      {tool.name || 'Tool Call'}
                                    </span>
                                    {tool.durationMs && (
                                      <span className="text-xs text-cement">
                                        {tool.durationMs}ms
                                      </span>
                                    )}
                                  </div>
                                  {tool.input && (
                                    <div className="text-xs text-cement mt-1">
                                      <strong>Input:</strong> {JSON.stringify(tool.input, null, 2)}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Score reasoning */}
                        <div>
                          <label className="text-xs font-semibold text-cement uppercase tracking-wide block mb-3">
                            Judge Reasoning
                            <InfoIcon text="Chain-of-thought reasoning produced BEFORE the score. Research shows CoT-then-score improves correlation with human judgment by 10-20% vs score-first approaches (G-Eval, Liu et al. 2023)." wide />
                          </label>
                          <div className="space-y-3">
                            {result.scores.map((score) => (
                              <div
                                key={score.id}
                                className="p-3 bg-white rounded border border-border"
                              >
                                <div className="flex justify-between items-start mb-2">
                                  <span className="text-sm font-medium text-[#1A1A1A]">
                                    {score.criterion.name}
                                  </span>
                                  {getScoreDisplay(score)}
                                </div>
                                {score.reasoning && (
                                  <Markdown content={score.reasoning} className="text-cement" />
                                )}
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Agent Traces (collapsed by default) */}
                        <div className="border border-border rounded-md overflow-hidden">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              toggleTrace(result.id)
                            }}
                            className="w-full px-4 py-2.5 flex items-center justify-between bg-surface-page hover:bg-glean-oatmeal-dark transition-colors"
                          >
                            <span className="text-xs font-semibold text-cement uppercase tracking-wide">
                              Agent Traces
                            </span>
                            <span className="text-cement text-xs">
                              {expandedTraces.has(result.id) ? '▲ Hide' : '▼ Show'}
                            </span>
                          </button>

                          {expandedTraces.has(result.id) && (
                            <div className="px-4 py-4 bg-white border-t border-border">
                              {result.agentTrace ? (
                                <AgentTraceView trace={result.agentTrace} />
                              ) : (
                                <p className="text-xs text-cement-light italic">
                                  No trace data available for this run. Traces are captured for new evals going forward.
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ===== Agent Trace Viewer =====

interface TraceStep {
  stepId?: string
  type: 'search' | 'read' | 'action' | 'thinking'
  queries?: string[]
  documentsRead?: { title?: string; url?: string }[]
  citations?: { title?: string; url?: string }[]
  action?: string
  text?: string
}

function AgentTraceView({ trace }: { trace: string }) {
  const [showRaw, setShowRaw] = useState(false)
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set())

  let steps: TraceStep[]
  try {
    steps = JSON.parse(trace)
  } catch {
    return <pre className="text-xs font-mono text-cement whitespace-pre-wrap">{trace}</pre>
  }

  if (!Array.isArray(steps) || steps.length === 0) {
    return <p className="text-xs text-cement-light italic">Empty trace — agent may have responded without tool use.</p>
  }

  const toggleStepExpand = (i: number) => {
    setExpandedSteps(prev => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  const STEP_ICONS: Record<string, string> = {
    search: '🔍',
    read: '📄',
    action: '⚡',
    thinking: '💭',
  }

  const DOC_PREVIEW_LIMIT = 8

  return (
    <div>
      {/* Mode toggle */}
      <div className="flex justify-end mb-2">
        <button
          onClick={(e) => { e.stopPropagation(); setShowRaw(!showRaw) }}
          className="text-[10px] px-2 py-0.5 rounded border border-border-subtle text-cement hover:text-[#1A1A1A] hover:bg-surface-page transition-colors"
        >
          {showRaw ? '← Formatted' : 'Raw JSON'}
        </button>
      </div>

      {showRaw ? (
        <pre className="bg-[#1A1A1A] text-green-400 rounded-lg p-4 text-xs font-mono whitespace-pre-wrap overflow-x-auto max-h-96 overflow-y-auto leading-relaxed">
          {JSON.stringify(steps, null, 2)}
        </pre>
      ) : (
        <div className="space-y-2">
          {steps.map((step, i) => {
            const isExpanded = expandedSteps.has(i)
            const docCount = step.documentsRead?.length || 0
            const hasOverflow = docCount > DOC_PREVIEW_LIMIT

            return (
              <div key={step.stepId || i} className="flex gap-3">
                {/* Step number */}
                <div className="flex flex-col items-center shrink-0">
                  <span className="text-xs w-5 h-5 rounded-full bg-surface-page border border-border-subtle flex items-center justify-center font-mono text-cement">
                    {i + 1}
                  </span>
                  {i < steps.length - 1 && (
                    <div className="w-px flex-1 bg-border-subtle mt-1" />
                  )}
                </div>

                {/* Step content */}
                <div className="flex-1 pb-3 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs">{STEP_ICONS[step.type] || '•'}</span>
                    <span className="text-xs font-semibold text-[#1A1A1A] uppercase tracking-wide">
                      {step.type === 'search' ? 'Search'
                        : step.type === 'read' ? 'Documents Read'
                        : step.type === 'thinking' ? 'Thinking'
                        : step.action || 'Action'}
                    </span>
                  </div>

                  {/* Search queries */}
                  {step.queries && step.queries.length > 0 && (
                    <div className="space-y-1">
                      {step.queries.map((q, qi) => (
                        <code key={qi} className="block text-xs font-mono text-cement bg-surface-page rounded px-2 py-1 border border-border-subtle">
                          &quot;{q}&quot;
                        </code>
                      ))}
                    </div>
                  )}

                  {/* Documents read */}
                  {step.documentsRead && docCount > 0 && (
                    <div className="space-y-0.5 mt-1">
                      {step.documentsRead.slice(0, isExpanded ? undefined : DOC_PREVIEW_LIMIT).map((doc, di) => (
                        <div key={di} className="text-xs text-cement truncate">
                          {doc.url ? (
                            <a href={doc.url} target="_blank" rel="noopener" className="text-glean-blue hover:underline">
                              {doc.title || doc.url}
                            </a>
                          ) : (
                            <span>{doc.title || 'Untitled document'}</span>
                          )}
                        </div>
                      ))}
                      {hasOverflow && (
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleStepExpand(i) }}
                          className="text-[10px] text-glean-blue hover:text-glean-blue-hover hover:underline transition-colors cursor-pointer"
                        >
                          {isExpanded
                            ? '← Show less'
                            : `+${docCount - DOC_PREVIEW_LIMIT} more →`
                          }
                        </button>
                      )}
                    </div>
                  )}

                  {/* Text content (thinking, intermediate output) */}
                  {step.text && (
                    <div className="mt-1 text-xs text-cement bg-surface-page rounded px-3 py-2 border border-border-subtle whitespace-pre-wrap leading-relaxed max-h-40 overflow-y-auto">
                      {step.text}
                    </div>
                  )}

                  {/* Citations */}
                  {step.citations && step.citations.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {step.citations.map((cite, ci) => (
                        <span key={ci} className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-200">
                          {cite.url ? (
                            <a href={cite.url} target="_blank" rel="noopener" className="hover:underline">{cite.title || 'Source'}</a>
                          ) : (
                            cite.title || 'Source'
                          )}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
