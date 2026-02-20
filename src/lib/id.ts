/**
 * ID generation utilities
 * Ensures IDs never start with dashes (which confuse CLI parsers)
 */

import { nanoid } from 'nanoid'

/**
 * Generate a CLI-safe ID that never starts with a dash.
 * Uses retry loop to maintain consistent length (21 chars).
 */
export function generateId(prefix?: string): string {
  let id = nanoid()
  while (id.startsWith('-')) id = nanoid()
  return prefix ? `${prefix}_${id}` : id
}
