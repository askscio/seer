'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from './ToastContainer'
import { Markdown } from './Markdown'

interface EvalCase {
  id: string
  query: string
  expectedAnswer: string | null
  context: string | null
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
  const [editExpected, setEditExpected] = useState('')

  const handleEdit = (testCase: EvalCase) => {
    setEditingId(testCase.id)
    setEditQuery(testCase.query)
    setEditExpected(testCase.expectedAnswer || '')
  }

  const handleSave = async (id: string) => {
    try {
      const response = await fetch('/api/cases', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          query: editQuery,
          expectedAnswer: editExpected || null,
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
          <tr className="bg-gray-50 border-b border-gray-200">
            <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700 w-12">
              #
            </th>
            <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700 w-[40%]">
              Input
            </th>
            <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700 w-[40%]">
              Expected Output
            </th>
            <th className="text-right px-4 py-3 text-sm font-semibold text-gray-700 w-24">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {cases.map((testCase, index) => (
            <tr
              key={testCase.id}
              className="border-b border-gray-200 hover:bg-gray-50"
            >
              <td className="px-4 py-3 text-sm text-gray-500">
                {index + 1}
              </td>
              <td className="px-4 py-3">
                {editingId === testCase.id ? (
                  <textarea
                    value={editQuery}
                    onChange={(e) => setEditQuery(e.target.value)}
                    className="w-full px-2 py-1 border border-blue-500 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    rows={3}
                  />
                ) : (
                  <Markdown content={testCase.query} className="text-gray-900" />
                )}
              </td>
              <td className="px-4 py-3">
                {editingId === testCase.id ? (
                  <textarea
                    value={editExpected}
                    onChange={(e) => setEditExpected(e.target.value)}
                    className="w-full px-2 py-1 border border-blue-500 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    rows={3}
                    placeholder="Optional expected output..."
                  />
                ) : testCase.expectedAnswer ? (
                  <Markdown content={testCase.expectedAnswer} className="text-gray-700" />
                ) : (
                  <span className="text-sm text-gray-400 italic">Not specified</span>
                )}
              </td>
              <td className="px-4 py-3 text-right">
                {editingId === testCase.id ? (
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={() => handleSave(testCase.id)}
                      className="text-sm text-green-600 hover:text-green-700 font-medium"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="text-sm text-gray-600 hover:text-gray-700"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={() => handleEdit(testCase)}
                      className="text-sm text-blue-600 hover:text-blue-700"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(testCase.id)}
                      className="text-sm text-red-600 hover:text-red-700"
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
