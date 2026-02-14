'use client'

import ReactMarkdown from 'react-markdown'

export function Markdown({ content, className }: { content: string; className?: string }) {
  if (!content) return null

  return (
    <div className={`prose prose-sm max-w-none prose-headings:text-gray-200 prose-p:text-gray-300 prose-li:text-gray-300 prose-strong:text-white prose-a:text-blue-400 ${className || ''}`}>
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  )
}
