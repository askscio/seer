'use client'

export function Tooltip({ text, children, wide }: { text: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1">
      {children}
      <span className="group relative">
        <span className="text-[10px] text-cement-light cursor-help select-none">ⓘ</span>
        <span className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-2 ${wide ? 'w-80' : 'w-64'} bg-[#1A1A1A] text-white text-xs leading-relaxed rounded-md px-3 py-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 shadow-lg`}>
          {text}
          <span className="absolute top-full left-1/2 -translate-x-1/2 -mt-px border-4 border-transparent border-t-[#1A1A1A]" />
        </span>
      </span>
    </span>
  )
}

export function InfoIcon({ text, wide }: { text: string; wide?: boolean }) {
  return (
    <span className="group relative inline-block ml-1">
      <span className="text-[10px] text-cement-light cursor-help select-none">ⓘ</span>
      <span className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-2 ${wide ? 'w-80' : 'w-64'} bg-[#1A1A1A] text-white text-xs leading-relaxed rounded-md px-3 py-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 shadow-lg`}>
        {text}
        <span className="absolute top-full left-1/2 -translate-x-1/2 -mt-px border-4 border-transparent border-t-[#1A1A1A]" />
      </span>
    </span>
  )
}
