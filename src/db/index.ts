/**
 * Database connection and initialization using Bun SQLite
 */

import { drizzle } from 'drizzle-orm/bun-sqlite'
import { Database } from 'bun:sqlite'
import { join } from 'path'
import { mkdirSync, existsSync } from 'fs'
import * as schema from './schema'

// Ensure data directory exists
const dataDir = join(process.cwd(), 'data')
if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true })
}

// Initialize SQLite connection
const sqlite = new Database(join(dataDir, 'seer.db'))
export const db = drizzle(sqlite, { schema })

/**
 * Initialize database with schema and seed default criteria
 */
export async function initializeDB() {
  console.log('Initializing database...')

  // Import seed function
  const { seedDefaultCriteria } = await import('./seed')

  // Check if default criteria already exist
  const existing = await db.select().from(schema.evalCriteria)

  if (existing.length === 0) {
    console.log('Seeding default criteria...')
    await seedDefaultCriteria()
    console.log('✓ Default criteria seeded')
  } else {
    console.log('✓ Database already initialized')
  }
}

/**
 * Close database connection
 */
export function closeDB() {
  sqlite.close()
}
