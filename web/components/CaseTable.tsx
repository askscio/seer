'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from './ToastContainer'
import { Markdown } from './Markdown'

interface EvalCase {
  id: string
  query: string
  evalGuidance: string | null
  context: string | null
  metadata: string | null
}

interface CaseTableProps {
  cases: EvalCase[]
  evalSetId: string
}

export default function CaseTable({ cases, evalSetId }: CaseTableProps) {
  const router = useRouter()
  const { showToast } = useToast()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editQuery, setEditQuery] = useState('')
  const [editGuidance, setEditGuidance] = useState('')
  const [editSimContext, setEditSimContext] = useState('')
  const [editSimStrategy, setEditSimStrategy] = useState('')

  const handleEdit = (testCase: EvalCase) => {
    setEditingId(testCase.id)
    setEditQuery(testCase.query)
    setEditGuidance(testCase.evalGuidance || '')
    const meta = testCase.metadata ? JSON.parse(testCase.metadata) : null
    setEditSimContext(meta?.simulatorContext || '')
    setEditSimStrategy(meta?.simulatorStrategy || '')
  }

  const handleSave = async (id: string, currentMetadata: string | null) => {
    // Merge simulator fields into existing metadata
    const existingMeta = currentMetadata ? JSON.parse(currentMetadata) : {}
    const updatedMeta = {
      ...existingMeta,
      simulatorContext: editSimContext || undefined,
      simulatorStrategy: editSimStrategy || undefined,
    }
    const hasMetadata = Object.values(updatedMeta).some(v => v !== undefined)

    try {
      const response = await fetch('/api/cases', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          query: editQuery,
          evalGuidance: editGuidance || null,
          metadata: hasMetadata ? JSON.stringify(updatedMeta) : null,
        }),
      })

      if (!response.ok) throw new Error('Failed to update')

      showToast('Test case updated', 'success')
      setEditingId(null)
      router.refresh()
    } catch (error) {
      showToast('Failed to save changes', 'error')
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this test case?')) return

    try {
      const response = await fetch(`/api/cases?id=${id}`, {
        method: 'DELETE',
      })

      if (!response.ok) throw new Error('Failed to delete')

      showToast('Test case deleted', 'success')
      router.refresh()
    } catch (error) {
      showToast('Failed to delete case', 'error')
    }
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-surface-page border-b border-border">
            <th className="text-left px-4 py-3 text-xs font-medium text-cement uppercase tracking-wide w-12">
              #
            </th>
            <th className="text-left px-4 py-3 text-xs font-medium text-cement uppercase tracking-wide w-[40%]">
              Input
            </th>
            <th className="text-left px-4 py-3 text-xs font-medium text-cement uppercase tracking-wide w-[40%]">
              Eval Guidance
            </th>
            <th className="text-right px-4 py-3 text-xs font-medium text-cement uppercase tracking-wide w-24">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {cases.map((testCase, index) => (
            <tr
              key={testCase.id}
              className="border-b border-border-subtle hover:bg-surface-page/50"
            >
              <td className="px-4 py-3 text-sm text-gray-500">
                {index + 1}
              </td>
              <td className="px-4 py-3">
                {editingId === testCase.id ? (
                  <textarea
                    value={editQuery}
                    onChange={(e) => setEditQuery(e.target.value)}
                    className="w-full px-2 py-1 border border-glean-blue rounded text-sm focus:outline-none focus:ring-2 focus:ring-glean-blue/30"
                    rows={3}
                  />
                ) : (
                  <Markdown content={testCase.query} className="text-gray-900" />
                )}
              </td>
              <td className="px-4 py-3">
                {editingId === testCase.id ? (
                  <textarea
                    value={editGuidance}
                    onChange={(e) => setEditGuidance(e.target.value)}
                    className="w-full px-2 py-1 border border-glean-blue rounded text-sm focus:outline-none focus:ring-2 focus:ring-glean-blue/30"
                    rows={3}
                    placeholder="What themes should the response cover?"
                  />
                ) : testCase.evalGuidance ? (
                  <Markdown content={testCase.evalGuidance} className="text-gray-700" />
                ) : (
                  <span className="text-sm text-gray-400 italic">Not specified</span>
                )}
                {editingId === testCase.id ? (
                  /* Edit mode: show editable simulator fields */
                  (editSimContext || editSimStrategy) ? (
                    <div className="mt-2 pt-2 border-t border-border-subtle space-y-2">
                      <div>
                        <span className="text-[10px] font-medium text-cement uppercase tracking-wide">Simulator Persona</span>
                        <textarea
                          value={editSimContext}
                          onChange={(e) => setEditSimContext(e.target.value)}
                          className="w-full mt-1 px-2 py-1 border border-glean-blue rounded text-xs focus:outline-none focus:ring-2 focus:ring-glean-blue/30"
                          rows={2}
                          placeholder="Who is the simulated user?"
                        />
                      </div>
                      <div>
                        <span className="text-[10px] font-medium text-[#343CED]/70 uppercase tracking-wide">Simulator Strategy</span>
                        <textarea
                          value={editSimStrategy}
                          onChange={(e) => setEditSimStrategy(e.target.value)}
                          className="w-full mt-1 px-2 py-1 border border-glean-blue rounded text-xs focus:outline-none focus:ring-2 focus:ring-glean-blue/30"
                          rows={3}
                          placeholder="How should the simulated user interact with this agent?"
                        />
                      </div>
                    </div>
                  ) : null
                ) : (
                  /* View mode: display simulator fields */
                  (() => {
                    const meta = testCase.metadata ? JSON.parse(testCase.metadata) : null
                    if (!meta?.simulatorContext && !meta?.simulatorStrategy) return null
                    return (
                      <div className="mt-2 pt-2 border-t border-border-subtle space-y-2">
                        {meta.simulatorContext && (
                          <div>
                            <span className="text-[10px] font-medium text-cement uppercase tracking-wide">Simulator Persona</span>
                            <p className="text-xs text-cement mt-0.5 leading-relaxed">{meta.simulatorContext}</p>
                          </div>
                        )}
                        {meta.simulatorStrategy && (
                          <div>
                            <span className="text-[10px] font-medium text-[#343CED]/70 uppercase tracking-wide">Simulator Strategy</span>
                            <p className="text-xs text-cement mt-0.5 leading-relaxed whitespace-pre-line">{meta.simulatorStrategy}</p>
                          </div>
                        )}
                      </div>
                    )
                  })()
                )}
              </td>
              <td className="px-4 py-3 text-right">
                {editingId === testCase.id ? (
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={() => handleSave(testCase.id, testCase.metadata)}
                      className="text-sm text-score-success hover:text-green-700 font-medium"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="text-sm text-cement hover:text-[#1A1A1A]"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={() => handleEdit(testCase)}
                      className="text-sm text-glean-blue hover:text-glean-blue-hover"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(testCase.id)}
                      className="text-sm text-score-fail hover:text-red-700"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {cases.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          No test cases yet. Add your first case to get started.
        </div>
      )}
    </div>
  )
}
