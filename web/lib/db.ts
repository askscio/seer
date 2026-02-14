import { drizzle } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'
import { join } from 'path'
import * as schema from '../../src/db/schema'

// Point to same database as CLI
// In Next.js, process.cwd() is the web/ directory
const dbPath = join(process.cwd(), '..', 'data', 'seer.db')
const sqlite = new Database(dbPath)

export const db = drizzle(sqlite, { schema })

// Re-export schema for convenience
export * from '../../src/db/schema'
