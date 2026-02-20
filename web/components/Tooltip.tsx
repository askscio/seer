'use client'

import { useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'

export function Tooltip({ text, children, wide }: { text: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1">
      {children}
      <SmartTooltip text={text} wide={wide} />
    </span>
  )
}

export function InfoIcon({ text, wide }: { text: string; wide?: boolean }) {
  return <SmartTooltip text={text} wide={wide} />
}

/**
 * Tooltip that renders via portal to escape overflow containers.
 * Uses position: fixed so it's never clipped by parent overflow.
 */
function SmartTooltip({ text, wide }: { text: string; wide?: boolean }) {
  const [visible, setVisible] = useState(false)
  const [coords, setCoords] = useState({ top: 0, left: 0, position: 'above' as 'above' | 'below' })
  const triggerRef = useRef<HTMLSpanElement>(null)

  const show = useCallback(() => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const tooltipWidth = wide ? 320 : 256
    const showBelow = rect.top < 120

    // Center tooltip horizontally on trigger, clamp to viewport
    let left = rect.left + rect.width / 2 - tooltipWidth / 2
    left = Math.max(8, Math.min(left, window.innerWidth - tooltipWidth - 8))

    setCoords({
      top: showBelow ? rect.bottom + 8 : rect.top - 8,
      left,
      position: showBelow ? 'below' : 'above',
    })
    setVisible(true)
  }, [wide])

  const hide = useCallback(() => setVisible(false), [])

  return (
    <span
      ref={triggerRef}
      className="relative inline-flex items-center ml-1 cursor-help"
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        className="text-cement-light hover:text-cement transition-colors"
      >
        <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 7v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="8" cy="5" r="0.75" fill="currentColor" />
      </svg>
      {visible && typeof document !== 'undefined' && createPortal(
        <div
          className={`fixed ${wide ? 'w-80' : 'w-64'} bg-[#1A1A1A] text-white text-xs leading-relaxed rounded-md px-3 py-2 z-[9999] shadow-lg pointer-events-none`}
          style={{
            top: coords.position === 'above' ? undefined : coords.top,
            bottom: coords.position === 'above' ? `${window.innerHeight - coords.top}px` : undefined,
            left: coords.left,
          }}
        >
          {text}
        </div>,
        document.body,
      )}
    </span>
  )
}
