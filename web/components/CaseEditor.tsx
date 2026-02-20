'use client'

import { useState } from 'react'

interface EvalCase {
  id: string
  query: string
  evalGuidance: string | null
  context: string | null
}

interface CaseEditorProps {
  testCase: EvalCase
  index: number
  onSave: (updatedCase: EvalCase) => Promise<void>
  onDelete: (id: string) => Promise<void>
}

export default function CaseEditor({ testCase, index, onSave, onDelete }: CaseEditorProps) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [query, setQuery] = useState(testCase.query)
  const [evalGuidance, setEvalGuidance] = useState(testCase.evalGuidance || '')
  const [context, setContext] = useState(testCase.context || '')

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave({
        ...testCase,
        query,
        evalGuidance: evalGuidance || null,
        context: context || null,
      })
      setEditing(false)
    } catch (error) {
      console.error('Error saving case:', error)
      alert('Failed to save changes')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm('Delete this test case?')) return

    setDeleting(true)
    try {
      await onDelete(testCase.id)
    } catch (error) {
      console.error('Error deleting case:', error)
      alert('Failed to delete case')
    } finally {
      setDeleting(false)
    }
  }

  const handleCancel = () => {
    setQuery(testCase.query)
    setEvalGuidance(testCase.evalGuidance || '')
    setContext(testCase.context || '')
    setEditing(false)
  }

  if (!editing) {
    return (
      <div className="border border-gray-200 rounded-lg p-4 hover:border-gray-300 transition-colors">
        <div className="flex justify-between items-start mb-3">
          <span className="text-sm font-semibold text-gray-500">
            Case {index + 1}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setEditing(true)}
              className="text-sm text-blue-600 hover:text-blue-700"
            >
              Edit
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="text-sm text-red-600 hover:text-red-700 disabled:text-gray-400"
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Query
            </label>
            <p className="text-gray-900 mt-1">{testCase.query}</p>
          </div>

          {testCase.evalGuidance && (
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Eval Guidance
              </label>
              <p className="text-gray-700 text-sm mt-1">
                {testCase.evalGuidance}
              </p>
            </div>
          )}

          {testCase.context && (
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Context
              </label>
              <p className="text-gray-700 text-sm mt-1">{testCase.context}</p>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="border border-blue-500 rounded-lg p-4 bg-blue-50">
      <div className="flex justify-between items-start mb-3">
        <span className="text-sm font-semibold text-blue-700">
          Editing Case {index + 1}
        </span>
      </div>

      <div className="space-y-4">
        <div>
          <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide block mb-1">
            Query *
          </label>
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            rows={3}
            required
          />
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide block mb-1">
            Eval Guidance (Optional)
          </label>
          <textarea
            value={evalGuidance}
            onChange={(e) => setEvalGuidance(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            rows={2}
            placeholder="What themes should the response cover?"
          />
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide block mb-1">
            Context (Optional)
          </label>
          <textarea
            value={context}
            onChange={(e) => setContext(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            rows={2}
            placeholder="Additional context for the judge"
          />
        </div>

        <div className="flex gap-2 pt-2">
          <button
            onClick={handleSave}
            disabled={saving || !query.trim()}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
          <button
            onClick={handleCancel}
            disabled={saving}
            className="px-4 py-2 border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
