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

  // One-time migration: rename expected_answer → eval_guidance
  try {
    sqlite.run('ALTER TABLE eval_cases RENAME COLUMN expected_answer TO eval_guidance')
    console.log('✓ Migrated: expected_answer → eval_guidance')
  } catch {
    // Column already renamed or doesn't exist — expected after first run
  }

  // One-time migration: add agent_schema to eval_sets
  try {
    sqlite.run('ALTER TABLE eval_sets ADD COLUMN agent_schema TEXT')
    console.log('✓ Added: eval_sets.agent_schema')
  } catch {
    // Column already exists — expected after first run
  }

  // One-time migration: add agent_trace to eval_results
  try {
    sqlite.run('ALTER TABLE eval_results ADD COLUMN agent_trace TEXT')
    console.log('✓ Added: eval_results.agent_trace')
  } catch {
    // Column already exists — expected after first run
  }

  // One-time migration: add agent_type to eval_sets
  try {
    sqlite.run('ALTER TABLE eval_sets ADD COLUMN agent_type TEXT')
    console.log('✓ Added: eval_sets.agent_type')
  } catch {
    // Column already exists — expected after first run
  }

  // One-time migration: add transcript to eval_results
  try {
    sqlite.run('ALTER TABLE eval_results ADD COLUMN transcript TEXT')
    console.log('✓ Added: eval_results.transcript')
  } catch {
    // Column already exists — expected after first run
  }

  // One-time migration: add golden answer to eval_cases
  try {
    sqlite.run('ALTER TABLE eval_cases ADD COLUMN golden_answer TEXT')
    console.log('✓ Added: eval_cases.golden_answer')
  } catch {
    // Column already exists — expected after first run
  }

  // One-time migration: add golden sources to eval_cases
  try {
    sqlite.run('ALTER TABLE eval_cases ADD COLUMN golden_sources TEXT')
    console.log('✓ Added: eval_cases.golden_sources')
  } catch {
    // Column already exists — expected after first run
  }

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
