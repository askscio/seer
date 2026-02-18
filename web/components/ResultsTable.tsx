'use client'

import { useState } from 'react'
import { Markdown } from './Markdown'

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
    expectedAnswer: string | null
  }
  agentResponse: string
  latencyMs: number
  totalTokens: number | null
  toolCalls: string | null
  scores: Score[]
}

interface ResultsTableProps {
  results: ResultRow[]
}

export default function ResultsTable({ results }: ResultsTableProps) {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())

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

  const getScoreDisplay = (score: Score) => {
    const { scoreValue, scoreCategory, criterion } = score

    // Metric type - show raw value
    if (criterion.scoreType === 'metric') {
      return <span className="text-cement font-mono text-sm">{scoreValue}</span>
    }

    // Categorical - show category name
    if (criterion.scoreType === 'categorical') {
      const categoryColors: Record<string, string> = {
        complete: 'bg-score-success-bg text-score-success',
        partial: 'bg-score-warning-bg text-score-warning',
        incomplete: 'bg-score-fail-bg text-score-fail',
        none: 'bg-surface-page text-cement',
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
            {criteria.map((criterion) => (
              <th
                key={criterion.id}
                className="text-center px-4 py-3 text-xs font-medium text-cement uppercase tracking-wide"
              >
                <div className="flex flex-col items-center">
                  <span>{criterion.name}</span>
                  <span className="text-xs font-normal text-cement mt-1">
                    {criterion.scoreType}
                  </span>
                </div>
              </th>
            ))}
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
