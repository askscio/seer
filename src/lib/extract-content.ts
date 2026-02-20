/**
 * Shared CONTENT-message extraction from Glean chat/workflow responses
 *
 * Glean responses contain messages with messageType: 'CONTENT' (final output)
 * and 'UPDATE' (intermediate steps like search queries). This utility extracts
 * only the final content text, which is what we need for judging, generating,
 * and displaying agent responses.
 */

interface GleanFragment {
  text?: string
  [key: string]: any
}

interface GleanMessage {
  author?: string
  messageType?: string
  fragments?: GleanFragment[]
  [key: string]: any
}

export interface GleanResponse {
  messages?: GleanMessage[]
  [key: string]: any
}

/**
 * Extract CONTENT text from a Glean chat/workflow response.
 * Filters for author=GLEAN_AI + messageType=CONTENT, joins text fragments.
 *
 * Returns empty string if no CONTENT messages found (caller decides fallback).
 */
export function extractContentText(data: GleanResponse): string {
  let text = ''
  for (const msg of data.messages ?? []) {
    if (msg.author === 'GLEAN_AI' && msg.messageType === 'CONTENT') {
      for (const f of msg.fragments ?? []) {
        if (f.text) text += f.text
      }
    }
  }
  return text
}

/**
 * Extract CONTENT text, throwing if nothing found.
 * Use this for judge calls where an empty response is an error.
 */
export function extractContentTextOrThrow(data: GleanResponse): string {
  const text = extractContentText(data)
  if (!text) throw new Error('No content in response')
  return text
}

/**
 * Extract CONTENT text with GLEAN_AI fallback.
 * First tries CONTENT messages, then falls back to all GLEAN_AI messages.
 * Use this for agent responses where CONTENT type might not be set.
 */
export function extractContentWithFallback(data: GleanResponse): string {
  const content = extractContentText(data)
  if (content) return content

  // Fallback: try all GLEAN_AI messages regardless of messageType
  let text = ''
  for (const msg of data.messages ?? []) {
    if (msg.author === 'GLEAN_AI') {
      for (const f of msg.fragments ?? []) {
        if (f.text) text += f.text
      }
    }
  }
  return text
}
