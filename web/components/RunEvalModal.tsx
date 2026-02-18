'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from './ToastContainer'

interface RunEvalModalProps {
  evalSetId: string
  onClose: () => void
}

type EvalMode = 'quick' | 'deep' | 'custom'

const EVAL_MODES = {
  quick: {
    label: 'Quick',
    description: 'Coverage + Faithfulness',
    detail: 'Checks topical coverage against eval guidance, plus groundedness against what the agent actually retrieved. No company search needed.',
    criteria: ['topical_coverage', 'response_quality', 'groundedness', 'hallucination_risk'],
    calls: 2,
  },
  deep: {
    label: 'Deep',
    description: 'Quick + Factual Verification',
    detail: 'Everything in Quick, plus an independent factuality check where the judge searches company data to verify specific claims. Slower but catches factual errors.',
    criteria: ['topical_coverage', 'response_quality', 'groundedness', 'hallucination_risk', 'factual_accuracy'],
    calls: 3,
  },
  custom: {
    label: 'Custom',
    description: 'Pick dimensions',
    detail: 'Choose exactly which dimensions to evaluate.',
    criteria: [],
    calls: 0,
  },
}

const ALL_CRITERIA = [
  { id: 'topical_coverage', name: 'Topical Coverage', group: 'coverage', description: 'Does the response hit the expected themes?' },
  { id: 'response_quality', name: 'Response Quality', group: 'coverage', description: 'Is it well-structured, concise, and actionable?' },
  { id: 'groundedness', name: 'Groundedness', group: 'faithfulness', description: 'Are claims supported by the docs the agent retrieved?' },
  { id: 'hallucination_risk', name: 'Hallucination Risk', group: 'faithfulness', description: 'Does it assert specifics without source backing?' },
  { id: 'factual_accuracy', name: 'Factual Accuracy', group: 'factuality', description: 'Are claims actually true? (Judge searches company data)' },
  { id: 'latency', name: 'Latency', group: 'metric', description: 'End-to-end response time' },
  { id: 'tool_call_count', name: 'Tool Calls', group: 'metric', description: 'Number of tools invoked' },
]

const JUDGE_MODELS = [
  { id: 'OPUS_4_6_VERTEX', name: 'Claude Opus 4.6', provider: 'Anthropic' },
  { id: 'GPT_5', name: 'GPT-5', provider: 'OpenAI' },
  { id: 'ADVANCED', name: 'Gemini (Advanced)', provider: 'Google' },
]

const GROUP_LABELS: Record<string, string> = {
  coverage: 'Coverage (reference-based)',
  faithfulness: 'Faithfulness (reference-free)',
  factuality: 'Factuality (search-verified)',
  metric: 'Direct Metrics',
}

export default function RunEvalModal({ evalSetId, onClose }: RunEvalModalProps) {
  const router = useRouter()
  const { showToast } = useToast()
  const [mode, setMode] = useState<EvalMode>('quick')
  const [customCriteria, setCustomCriteria] = useState<string[]>([
    'topical_coverage', 'groundedness',
  ])
  const [selectedJudges, setSelectedJudges] = useState<string[]>(['OPUS_4_6_VERTEX'])
  const [running, setRunning] = useState(false)

  const activeCriteria = mode === 'custom'
    ? customCriteria
    : EVAL_MODES[mode].criteria

  const toggleCriterion = (id: string) => {
    setCustomCriteria(prev =>
      prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]
    )
  }

  const toggleJudge = (id: string) => {
    setSelectedJudges(prev => {
      if (prev.includes(id)) {
        if (prev.length === 1) return prev // Keep at least one
        return prev.filter(j => j !== id)
      }
      return [...prev, id]
    })
  }

  const handleRun = async () => {
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
        }),
      })

      if (!response.ok) throw new Error('Failed to start evaluation')

      const judgeNames = selectedJudges.map(id => JUDGE_MODELS.find(m => m.id === id)?.name).join(', ')
      showToast(`Eval started · ${judgeNames} · ${activeCriteria.length} dimensions`, 'loading', 0)
      onClose()
      router.refresh()

      setTimeout(() => router.refresh(), 10000)
      setTimeout(() => {
        router.refresh()
        showToast('Check results below', 'success')
      }, 30000)
    } catch (error) {
      showToast('Failed to start evaluation', 'error')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-modal max-w-2xl w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold text-[#1A1A1A]">Run Evaluation</h2>
        </div>

        <div className="px-6 py-5 overflow-y-auto flex-1 space-y-6">
          {/* Eval Mode */}
          <div>
            <label className="text-xs font-medium text-cement uppercase tracking-wide block mb-3">
              Evaluation Mode
            </label>
            <div className="grid grid-cols-3 gap-3">
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
                    <div className="text-xs text-cement-light mt-1">{m.calls} judge calls/case</div>
                  )}
                </button>
              ))}
            </div>
            {/* Mode description */}
            <p className="text-xs text-cement mt-2 leading-relaxed">
              {EVAL_MODES[mode].detail}
            </p>
          </div>

          {/* Custom criteria picker (only in custom mode) */}
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
                              <span className="text-sm text-[#1A1A1A]">{c.name}</span>
                              <span className="text-xs text-cement ml-2">{c.description}</span>
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

          {/* Summary */}
          <div className="bg-glean-blue-light border border-glean-blue/20 rounded-md p-3">
            <p className="text-sm text-[#1A1A1A]">
              <span className="font-medium">{activeCriteria.length}</span> dimensions ·{' '}
              <span className="font-medium">{selectedJudges.length}</span> judge{selectedJudges.length > 1 ? 's' : ''} ·{' '}
              <span className="font-medium">{EVAL_MODES[mode].label}</span> mode
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex gap-3">
          <button
            onClick={handleRun}
            disabled={running || activeCriteria.length === 0}
            className="flex-1 px-4 py-2 bg-glean-blue text-white rounded-md hover:bg-glean-blue-hover disabled:bg-border disabled:text-cement-light disabled:cursor-not-allowed transition-colors text-sm font-medium"
          >
            {running ? 'Starting…' : `Run Evaluation`}
          </button>
          <button
            onClick={onClose}
            disabled={running}
            className="px-4 py-2 border border-border text-cement rounded-md hover:bg-surface-page transition-colors text-sm"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
