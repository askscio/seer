'use client'

import { useState } from 'react'
import RunEvalModal from './RunEvalModal'
import { useToast } from './ToastContainer'

interface RunEvalButtonProps {
  evalSetId: string
  hasCases: boolean
}

export default function RunEvalButton({ evalSetId, hasCases }: RunEvalButtonProps) {
  const [showModal, setShowModal] = useState(false)
  const { showToast } = useToast()

  const handleClick = () => {
    if (!hasCases) {
      showToast('Add test cases before running evaluation', 'error')
      return
    }
    setShowModal(true)
  }

  return (
    <>
      <button
        onClick={handleClick}
        disabled={!hasCases}
        className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
      >
        ▶ Run Evaluation
      </button>

      {showModal && (
        <RunEvalModal
          evalSetId={evalSetId}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  )
}
