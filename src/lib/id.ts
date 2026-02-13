/**
 * ID generation utilities
 * Ensures IDs never start with dashes (which confuse CLI parsers)
 */

import { nanoid } from 'nanoid'

/**
 * Generate a CLI-safe ID that never starts with a dash
 */
export function generateId(prefix?: string): string {
  const id = nanoid()
  const safeId = id.startsWith('-') ? id.slice(1) : id

  return prefix ? `${prefix}_${safeId}` : safeId
}
