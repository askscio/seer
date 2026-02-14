'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import CaseEditor from './CaseEditor'

interface EvalCase {
  id: string
  query: string
  expectedAnswer: string | null
  context: string | null
  createdAt: Date
}

interface EditableCaseListProps {
  cases: EvalCase[]
  evalSetId: string
}

export default function EditableCaseList({ cases: initialCases, evalSetId }: EditableCaseListProps) {
  const router = useRouter()
  const [cases, setCases] = useState(initialCases)

  const handleSave = async (updatedCase: EvalCase) => {
    const response = await fetch('/api/cases', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: updatedCase.id,
        query: updatedCase.query,
        expectedAnswer: updatedCase.expectedAnswer,
        context: updatedCase.context,
      }),
    })

    if (!response.ok) {
      throw new Error('Failed to update case')
    }

    // Update local state
    setCases(cases.map(c => c.id === updatedCase.id ? updatedCase : c))
    router.refresh()
  }

  const handleDelete = async (id: string) => {
    const response = await fetch(`/api/cases?id=${id}`, {
      method: 'DELETE',
    })

    if (!response.ok) {
      throw new Error('Failed to delete case')
    }

    // Update local state
    setCases(cases.filter(c => c.id !== id))
    router.refresh()
  }

  return (
    <div className="space-y-4">
      {cases.map((testCase, index) => (
        <CaseEditor
          key={testCase.id}
          testCase={testCase}
          index={index}
          onSave={handleSave}
          onDelete={handleDelete}
        />
      ))}
    </div>
  )
}
