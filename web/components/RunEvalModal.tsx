'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from './ToastContainer'

interface RunEvalModalProps {
  evalSetId: string
  onClose: () => void
}

const AVAILABLE_CRITERIA = [
  { id: 'task_success', name: 'Task Success', type: 'continuous', description: 'Did the agent successfully complete the task?' },
  { id: 'factuality', name: 'Factuality', type: 'continuous', description: 'Is the response grounded in facts?' },
  { id: 'relevance', name: 'Relevance', type: 'continuous', description: 'How relevant is the response?' },
  { id: 'prompt_adherence', name: 'Instruction Following', type: 'continuous', description: 'Did the agent follow instructions?' },
  { id: 'completeness', name: 'Completeness', type: 'categorical', description: 'Did the response cover all aspects?' },
  { id: 'uses_correct_tools', name: 'Tool Usage', type: 'binary', description: 'Did the agent use appropriate tools?' },
  { id: 'safe_output', name: 'Safety', type: 'binary', description: 'Is the output safe and appropriate?' },
  { id: 'latency', name: 'Latency', type: 'metric', description: 'Response time in milliseconds' },
  { id: 'token_efficiency', name: 'Token Efficiency', type: 'metric', description: 'Total tokens used' },
  { id: 'tool_call_count', name: 'Tool Call Count', type: 'metric', description: 'Number of tool invocations' },
]

export default function RunEvalModal({ evalSetId, onClose }: RunEvalModalProps) {
  const router = useRouter()
  const { showToast } = useToast()
  const [selectedCriteria, setSelectedCriteria] = useState<string[]>([
    'task_success',
    'factuality',
    'relevance',
  ])
  const [running, setRunning] = useState(false)

  const toggleCriterion = (id: string) => {
    setSelectedCriteria((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    )
  }

  const handleRun = async () => {
    if (selectedCriteria.length === 0) {
      showToast('Select at least one dimension to evaluate', 'error')
      return
    }

    setRunning(true)

    try {
      const response = await fetch('/api/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          evalSetId,
          criteria: selectedCriteria,
          judgeModel: 'glean-chat',
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to start evaluation')
      }

      const data = await response.json()

      showToast(`Evaluation started! Processing ${selectedCriteria.length} dimensions...`, 'loading', 0)
      onClose()

      // Refresh to show new run
      router.refresh()

      // Poll for completion
      setTimeout(() => {
        router.refresh()
        showToast('Evaluation in progress...', 'info', 3000)
      }, 5000)

      setTimeout(() => {
        router.refresh()
        showToast('Check results below', 'success')
      }, 30000)
    } catch (error) {
      console.error('Error running evaluation:', error)
      showToast('Failed to start evaluation', 'error')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">Run Evaluation</h2>
          <p className="text-sm text-gray-600 mt-1">
            Select dimensions to evaluate
          </p>
        </div>

        {/* Content */}
        <div className="px-6 py-4 overflow-y-auto flex-1">
          <div className="space-y-3">
            {AVAILABLE_CRITERIA.map((criterion) => (
              <label
                key={criterion.id}
                className="flex items-start gap-3 p-3 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selectedCriteria.includes(criterion.id)}
                  onChange={() => toggleCriterion(criterion.id)}
                  className="mt-1 h-4 w-4 text-blue-600 rounded focus:ring-blue-500"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900">
                      {criterion.name}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600">
                      {criterion.type}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 mt-0.5">
                    {criterion.description}
                  </p>
                </div>
              </label>
            ))}
          </div>

          <div className="mt-4 p-3 bg-blue-50 rounded-lg">
            <p className="text-sm text-blue-800">
              <strong>Selected:</strong> {selectedCriteria.length} dimension
              {selectedCriteria.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex gap-3">
          <button
            onClick={handleRun}
            disabled={running || selectedCriteria.length === 0}
            className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors font-medium"
          >
            {running ? '⏳ Starting...' : `▶ Run Evaluation (${selectedCriteria.length})`}
          </button>
          <button
            onClick={onClose}
            disabled={running}
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
