'use client'

import { useState, useRef, useEffect } from 'react'

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
 * Tooltip that auto-detects whether to show above or below based on viewport position.
 * Falls below when there isn't enough room above.
 */
function SmartTooltip({ text, wide }: { text: string; wide?: boolean }) {
  const [visible, setVisible] = useState(false)
  const [position, setPosition] = useState<'above' | 'below'>('above')
  const triggerRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (visible && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      // If there's less than 120px above the trigger, show below
      setPosition(rect.top < 120 ? 'below' : 'above')
    }
  }, [visible])

  const tooltipClasses = position === 'above'
    ? 'bottom-full left-1/2 -translate-x-1/2 mb-2'
    : 'top-full left-1/2 -translate-x-1/2 mt-2'

  const arrowClasses = position === 'above'
    ? 'absolute top-full left-1/2 -translate-x-1/2 -mt-px border-4 border-transparent border-t-[#1A1A1A]'
    : 'absolute bottom-full left-1/2 -translate-x-1/2 -mb-px border-4 border-transparent border-b-[#1A1A1A]'

  return (
    <span
      ref={triggerRef}
      className="relative inline-flex items-center ml-1 cursor-help"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
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
      {visible && (
        <span
          className={`absolute ${tooltipClasses} ${wide ? 'w-80' : 'w-64'} bg-[#1A1A1A] text-white text-xs leading-relaxed rounded-md px-3 py-2 z-50 shadow-lg`}
        >
          {text}
          <span className={arrowClasses} />
        </span>
      )}
    </span>
  )
}
