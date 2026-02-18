'use client'

import ReactMarkdown from 'react-markdown'

export function Markdown({ content, className }: { content: string; className?: string }) {
  if (!content) return null

  return (
    <div className={`prose-seer ${className || ''}`}>
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  )
}
