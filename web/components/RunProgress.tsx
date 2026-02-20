'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'

interface RunProgressProps {
  runId: string
  onComplete?: () => void
}

interface RunStatus {
  status: 'running' | 'completed' | 'failed'
  completed: number
  total: number
}

export default function RunProgress({ runId, onComplete }: RunProgressProps) {
  const router = useRouter()
  const [status, setStatus] = useState<RunStatus | null>(null)
  const [error, setError] = useState(false)
  const [done, setDone] = useState(false)
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete

  useEffect(() => {
    if (done) return // Stop polling once done

    let cancelled = false

    const poll = async () => {
      try {
        const resp = await fetch(`/api/runs/${runId}/status`)
        if (cancelled) return
        if (!resp.ok) {
          setError(true)
          return
        }
        const data = await resp.json()
        setStatus(data)

        if (data.status === 'completed' || data.status === 'failed') {
          setDone(true)
          router.refresh()
          onCompleteRef.current?.()
        }
      } catch {
        if (!cancelled) setError(true)
      }
    }

    // Initial fetch
    poll()

    // Poll every 2 seconds
    const interval = setInterval(poll, 2000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [runId, done, router])

  if (error) {
    return (
      <div className="flex items-center gap-3 p-4">
        <span className="text-sm text-score-fail">Failed to track progress</span>
      </div>
    )
  }

  if (!status) {
    return (
      <div className="flex items-center gap-3 p-4">
        <ProgressRing completed={0} total={1} size={56} />
        <span className="text-sm text-cement">Starting...</span>
      </div>
    )
  }

  const { completed, total } = status
  const isDone = status.status === 'completed'
  const isFailed = status.status === 'failed'

  return (
    <div className="flex items-center gap-4 p-4">
      <ProgressRing
        completed={completed}
        total={total}
        size={56}
        done={isDone}
        failed={isFailed}
      />
      <div>
        <p className="text-sm font-medium text-[#1A1A1A]">
          {isDone
            ? 'Evaluation complete'
            : isFailed
            ? 'Evaluation failed'
            : `${completed}/${total} cases evaluated`}
        </p>
        <p className="text-xs text-cement mt-0.5">
          {isDone
            ? 'Refresh to see full results'
            : isFailed
            ? 'Check server logs for details'
            : completed === 0
            ? 'Running agent on first case...'
            : 'Running agent + judge pipeline...'}
        </p>
      </div>
    </div>
  )
}

// ===== SVG Progress Ring =====

interface ProgressRingProps {
  completed: number
  total: number
  size: number
  done?: boolean
  failed?: boolean
}

function ProgressRing({ completed, total, size, done, failed }: ProgressRingProps) {
  const strokeWidth = 4
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const progress = total > 0 ? completed / total : 0
  const dashOffset = circumference * (1 - progress)

  // Color based on state
  const ringColor = done
    ? 'var(--score-success, #16a34a)'
    : failed
    ? 'var(--score-fail, #dc2626)'
    : 'var(--glean-blue, #343CED)'

  const trackColor = 'var(--border-default, #E5E2D9)'

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        className="transform -rotate-90"
      >
        {/* Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={trackColor}
          strokeWidth={strokeWidth}
        />
        {/* Progress */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={ringColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          style={{ transition: 'stroke-dashoffset 0.5s ease' }}
        />
      </svg>
      {/* Center text */}
      <div className="absolute inset-0 flex items-center justify-center">
        {done ? (
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M5 10l3.5 3.5L15 7" stroke="var(--score-success, #16a34a)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : failed ? (
          <span className="text-score-fail text-xs font-bold">!</span>
        ) : (
          <span className="text-xs font-mono font-medium text-[#1A1A1A] tabular-nums">
            {completed}/{total}
          </span>
        )}
      </div>
    </div>
  )
}
