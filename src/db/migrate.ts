/**
 * Run database migrations manually
 */

import { Database } from 'bun:sqlite'
import { join } from 'path'
import { readFileSync, existsSync, mkdirSync } from 'fs'

const dataDir = join(process.cwd(), 'data')
if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true })
}

const db = new Database(join(dataDir, 'seer.db'))

// Read and execute the migration SQL
const migrationPath = join(process.cwd(), 'src/db/migrations/0000_tough_harry_osborn.sql')

if (existsSync(migrationPath)) {
  const sql = readFileSync(migrationPath, 'utf-8')

  // Execute each statement
  const statements = sql.split(';').filter(s => s.trim())
  for (const statement of statements) {
    try {
      db.run(statement)
    } catch (error) {
      // Ignore errors for already existing tables
      if (!String(error).includes('already exists')) {
        console.error('Migration error:', error)
      }
    }
  }

  console.log('✓ Database migrations applied')
} else {
  console.log('No migration file found, skipping...')
}

db.close()
