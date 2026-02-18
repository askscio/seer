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
        className="px-4 py-2 text-sm font-medium bg-glean-blue text-white rounded-md hover:bg-glean-blue-hover disabled:bg-border disabled:text-cement-light disabled:cursor-not-allowed transition-colors"
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
