'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from './ToastContainer'
import { InfoIcon } from './Tooltip'
import RunProgress from './RunProgress'

interface EvalConfigSectionProps {
  evalSetId: string
  hasCases: boolean
  agentType?: string
}

type EvalMode = 'quick' | 'deep' | 'full' | 'custom'

const EVAL_MODES = {
  quick: {
    label: 'Quick',
    description: 'Coverage + Quality + Faithfulness',
    detail: 'Checks topical coverage against eval guidance, response quality (standalone), plus groundedness against pre-fetched source documents.',
    criteria: ['topical_coverage', 'response_quality', 'groundedness', 'hallucination_risk'],
    callsPerJudge: 3,
    estSeconds: 35,
  },
  deep: {
    label: 'Deep',
    description: 'Quick + Factual Verification',
    detail: 'Everything in Quick, plus an independent factuality check where the judge searches company data to verify specific claims.',
    criteria: ['topical_coverage', 'response_quality', 'groundedness', 'hallucination_risk', 'factual_accuracy'],
    callsPerJudge: 4,
    estSeconds: 50,
  },
  full: {
    label: 'Full',
    description: 'All dimensions + metrics',
    detail: 'Runs the complete evaluation suite: coverage, quality, faithfulness, factuality, plus latency and tool call metrics.',
    criteria: ['topical_coverage', 'response_quality', 'groundedness', 'hallucination_risk', 'factual_accuracy', 'latency', 'tool_call_count'],
    callsPerJudge: 4,
    estSeconds: 50,
  },
  custom: {
    label: 'Custom',
    description: 'Pick dimensions',
    detail: 'Choose exactly which dimensions to evaluate.',
    criteria: [],
    callsPerJudge: 0,
    estSeconds: 0,
  },
}

import { DIMENSIONS } from '@/lib/dimensions'

const ALL_CRITERIA = Object.entries(DIMENSIONS).map(([id, dim]) => ({
  id,
  name: dim.name,
  group: dim.group,
  description: dim.description,
  context: dim.context,
  tooltip: dim.tooltip,
}))

// Matches JUDGE_MODELS in src/lib/judge.ts (single source of truth)
const JUDGE_MODELS = [
  { id: 'OPUS_4_6_VERTEX', name: 'Claude Opus 4.6', provider: 'Anthropic' },
  { id: 'GPT_5', name: 'GPT-5', provider: 'OpenAI' },
  { id: 'ADVANCED', name: 'Gemini (Advanced)', provider: 'Google' },
]

const GROUP_LABELS: Record<string, string> = {
  coverage: 'Coverage (reference-based)',
  quality: 'Quality (standalone)',
  faithfulness: 'Faithfulness (source-grounded)',
  factuality: 'Factuality (search-verified)',
  metric: 'Direct Metrics',
}

export default function EvalConfigSection({ evalSetId, hasCases, agentType }: EvalConfigSectionProps) {
  const router = useRouter()
  const { showToast } = useToast()
  const [mode, setMode] = useState<EvalMode>('quick')
  const [customCriteria, setCustomCriteria] = useState<string[]>([
    'topical_coverage', 'groundedness',
  ])
  const [selectedJudges, setSelectedJudges] = useState<string[]>(['OPUS_4_6_VERTEX'])
  const [multiTurnEnabled, setMultiTurnEnabled] = useState(false)
  const [maxTurns, setMaxTurns] = useState(5)
  const [running, setRunning] = useState(false)
  const [activeRunId, setActiveRunId] = useState<string | null>(null)

  const activeCriteria = mode === 'custom'
    ? customCriteria
    : EVAL_MODES[mode].criteria

  // Compute actual judge calls per case (by call type, not by dimension)
  const computeCallsPerJudge = (criteria: string[]) => {
    let calls = 0
    const hasCoverage = criteria.some(c => ['topical_coverage'].includes(c))
    const hasQuality = criteria.some(c => ['response_quality'].includes(c))
    const hasFaithfulness = criteria.some(c => ['groundedness', 'hallucination_risk'].includes(c))
    const hasFactuality = criteria.includes('factual_accuracy')
    if (hasCoverage) calls++
    if (hasQuality) calls++
    if (hasFaithfulness) calls++
    if (hasFactuality) calls++
    return calls
  }

  const callsPerJudge = mode === 'custom'
    ? computeCallsPerJudge(customCriteria)
    : EVAL_MODES[mode].callsPerJudge

  const totalCallsPerCase = callsPerJudge * selectedJudges.length

  const toggleCriterion = (id: string) => {
    setCustomCriteria(prev =>
      prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]
    )
  }

  const toggleJudge = (id: string) => {
    setSelectedJudges(prev => {
      if (prev.includes(id)) {
        if (prev.length === 1) return prev
        return prev.filter(j => j !== id)
      }
      return [...prev, id]
    })
  }

  const handleRun = async () => {
    if (!hasCases) {
      showToast('Add test cases before running evaluation', 'error')
      return
    }
    if (activeCriteria.length === 0) {
      showToast('Select at least one dimension', 'error')
      return
    }

    setRunning(true)

    try {
      const response = await fetch('/api/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          evalSetId,
          criteria: activeCriteria,
          judges: selectedJudges,
          mode,
          multiTurn: multiTurnEnabled,
          maxTurns,
        }),
      })

      if (!response.ok) throw new Error('Failed to start evaluation')

      const data = await response.json()
      setActiveRunId(data.runId)
      setRunning(false)
    } catch (error) {
      showToast('Failed to start evaluation', 'error')
      setRunning(false)
    }
  }

  return (
    <div className="bg-white rounded-lg shadow-card border border-border mb-6">
      <div className="px-5 py-3 border-b border-border">
        <span className="text-xs font-medium text-cement uppercase tracking-wide">Eval Config</span>
      </div>

      <div className="px-5 py-5 space-y-5">
        {/* Eval Mode */}
        <div>
          <label className="text-xs font-medium text-cement uppercase tracking-wide block mb-3">
            Evaluation Mode
            <InfoIcon text="Each mode groups criteria into independent judge calls by type. Coverage call sees query + eval guidance. Quality call sees query + response only (isolated from eval guidance). Faithfulness call sees query + agent trace + pre-fetched document content. Factuality call sees query + response and independently searches all company data. Calls run in sequence per case, but each call is independent — they don't share context or influence each other's scores." wide />
          </label>
          <div className="grid grid-cols-2 gap-3">
            {(Object.entries(EVAL_MODES) as [EvalMode, typeof EVAL_MODES.quick][]).map(([key, m]) => (
              <button
                key={key}
                onClick={() => setMode(key)}
                className={`p-3 rounded-md border text-left transition-all ${
                  mode === key
                    ? 'border-glean-blue bg-glean-blue-light'
                    : 'border-border hover:border-glean-blue/40 hover:bg-surface-page'
                }`}
              >
                <div className="text-sm font-medium text-[#1A1A1A]">{m.label}</div>
                <div className="text-xs text-cement mt-0.5">{m.description}</div>
                {key !== 'custom' && (
                  <div className="text-xs text-cement-light mt-1">
                    {m.callsPerJudge} calls/judge/case · ~{m.estSeconds}s est.
                  </div>
                )}
              </button>
            ))}
          </div>
          <p className="text-xs text-cement mt-2 leading-relaxed">
            {EVAL_MODES[mode].detail}
          </p>
        </div>

        {/* Custom criteria picker */}
        {mode === 'custom' && (
          <div>
            <label className="text-xs font-medium text-cement uppercase tracking-wide block mb-3">
              Dimensions
            </label>
            <div className="space-y-4">
              {Object.entries(GROUP_LABELS).map(([group, label]) => {
                const groupCriteria = ALL_CRITERIA.filter(c => c.group === group)
                return (
                  <div key={group}>
                    <div className="text-xs font-medium text-cement mb-1.5">{label}</div>
                    <div className="space-y-1.5">
                      {groupCriteria.map(c => (
                        <label
                          key={c.id}
                          className={`flex items-center gap-3 p-2.5 rounded-md border cursor-pointer transition-colors ${
                            customCriteria.includes(c.id)
                              ? 'border-glean-blue bg-glean-blue-light'
                              : 'border-border-subtle hover:bg-surface-page'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={customCriteria.includes(c.id)}
                            onChange={() => toggleCriterion(c.id)}
                            className="h-3.5 w-3.5 rounded accent-[#343CED]"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1">
                              <span className="text-sm text-[#1A1A1A]">{c.name}</span>
                              <InfoIcon text={c.tooltip} wide />
                            </div>
                            <div className="text-xs text-cement mt-0.5">{c.context}</div>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Judge Selection */}
        <div>
          <label className="text-xs font-medium text-cement uppercase tracking-wide block mb-3">
            Judge Models
            <span className="ml-2 font-normal normal-case tracking-normal text-cement-light">
              — select one or more
            </span>
            <InfoIcon text="Cross-family panels (e.g. Anthropic + OpenAI + Google) have complementary error profiles — single judges show 3.4x over-flagging or miss 50% of issues. Multi-judge aggregates via majority vote (Verga et al., 2024; Cavanagh, 2026)." wide />
          </label>
          <div className="space-y-1.5">
            {JUDGE_MODELS.map(model => (
              <label
                key={model.id}
                className={`flex items-center gap-3 p-2.5 rounded-md border cursor-pointer transition-colors ${
                  selectedJudges.includes(model.id)
                    ? 'border-glean-blue bg-glean-blue-light'
                    : 'border-border-subtle hover:bg-surface-page'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedJudges.includes(model.id)}
                  onChange={() => toggleJudge(model.id)}
                  className="h-3.5 w-3.5 rounded accent-[#343CED]"
                />
                <div className="flex-1">
                  <span className="text-sm text-[#1A1A1A]">{model.name}</span>
                  <span className="text-xs text-cement ml-2">{model.provider}</span>
                </div>
              </label>
            ))}
          </div>
          {selectedJudges.length > 1 && (
            <p className="text-xs text-cement mt-2">
              Multi-judge: each dimension scored by {selectedJudges.length} models, aggregated via majority vote.
            </p>
          )}
        </div>

        {/* Multi-Turn Conversation (autonomous agents only) */}
        {agentType === 'autonomous' && (
          <div>
            <label className="text-xs font-medium text-cement uppercase tracking-wide block mb-3">
              Multi-Turn Conversation
              <InfoIcon text="Enable simulated conversation where the agent can ask follow-up questions. A simulated user responds based on the case's simulator context, crafting realistic replies grounded in company data. Conversations continue until the agent provides a final answer or reaches max turns." wide />
            </label>
            <div className="space-y-3">
              <label className="flex items-center gap-3 p-2.5 rounded-md border border-border-subtle hover:bg-surface-page cursor-pointer transition-colors">
                <input
                  type="checkbox"
                  checked={multiTurnEnabled}
                  onChange={(e) => setMultiTurnEnabled(e.target.checked)}
                  className="h-3.5 w-3.5 rounded accent-[#343CED]"
                />
                <div className="flex-1">
                  <span className="text-sm text-[#1A1A1A]">Enable multi-turn evaluation</span>
                  <span className="text-xs text-cement ml-2">Simulated user responds to follow-up questions</span>
                </div>
              </label>
              {multiTurnEnabled && (
                <div className="ml-7 flex items-center gap-3">
                  <label className="text-sm text-cement">Max turns:</label>
                  <select
                    value={maxTurns}
                    onChange={(e) => setMaxTurns(Number(e.target.value))}
                    className="px-3 py-1.5 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-glean-blue/30 focus:border-glean-blue"
                  >
                    <option value={2}>2</option>
                    <option value={3}>3</option>
                    <option value={5}>5 (recommended)</option>
                    <option value={7}>7</option>
                    <option value={10}>10</option>
                  </select>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Summary + Run Button / Progress */}
        {activeRunId ? (
          <div className="border border-glean-blue/20 rounded-md bg-glean-blue-light">
            <RunProgress
              runId={activeRunId}
              onComplete={() => {
                setActiveRunId(null)
                showToast('Evaluation complete', 'success')
                router.refresh()
              }}
            />
          </div>
        ) : (
          <div className="bg-glean-blue-light border border-glean-blue/20 rounded-md p-3 flex items-center justify-between">
            <p className="text-sm text-[#1A1A1A]">
              <span className="font-medium">{activeCriteria.length}</span> dimensions ·{' '}
              <span className="font-medium">{selectedJudges.length}</span> judge{selectedJudges.length > 1 ? 's' : ''} ·{' '}
              <span className="font-medium">{totalCallsPerCase}</span> judge calls/case
              {multiTurnEnabled && (
                <span className="text-cement"> · multi-turn (max {maxTurns})</span>
              )}
            </p>
            <button
              onClick={handleRun}
              disabled={running || activeCriteria.length === 0 || !hasCases}
              className="px-4 py-2 bg-glean-blue text-white rounded-md hover:bg-glean-blue-hover disabled:bg-border disabled:text-cement-light disabled:cursor-not-allowed transition-colors text-sm font-medium"
            >
              {running ? 'Starting…' : '▶ Run Evaluation'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
