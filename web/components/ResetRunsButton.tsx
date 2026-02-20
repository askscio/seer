'use client'

import { useRouter } from 'next/navigation'
import { useToast } from './ToastContainer'

interface ResetRunsButtonProps {
  evalSetId: string
}

export default function ResetRunsButton({ evalSetId }: ResetRunsButtonProps) {
  const router = useRouter()
  const { showToast } = useToast()

  const handleReset = async () => {
    if (!confirm('Clear all run history for this eval set?')) return

    try {
      const response = await fetch('/api/runs', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ evalSetId }),
      })

      if (!response.ok) throw new Error('Failed to clear runs')

      showToast('Run history cleared', 'success')
      router.refresh()
    } catch (error) {
      showToast('Failed to clear run history', 'error')
    }
  }

  return (
    <button
      onClick={handleReset}
      className="text-xs text-cement hover:text-score-fail transition-colors"
    >
      Clear History
    </button>
  )
}
