#!/usr/bin/env bun

/**
 * One-shot importer for golden benchmark XLSX files.
 *
 * Reads rows from an Excel file with headers like:
 * - Question
 * - Good Quality Answer
 * - Doc Link
 *
 * Then creates an eval set and inserts cases with:
 * - query
 * - goldenAnswer
 * - goldenSources (JSON array)
 *
 * Uses existing Seer config loading, so keys in data/settings.json are honored.
 */

import { basename, resolve } from 'path'
import { spawnSync } from 'child_process'
import { db, initializeDB, closeDB } from './db/index'
import { evalSets, evalCases } from './db/schema'
import { generateId } from './lib/id'
import { getAgentType } from './data/glean'

interface ImportRow {
  question: string
  goldenAnswer?: string
  docLink?: string
  userEmail?: string
  rowNumber: number
}

interface CliOptions {
  agentId: string
  xlsxPath: string
  setName?: string
  description?: string
}

function parseArgs(argv: string[]): CliOptions {
  const opts: Partial<CliOptions> = {}

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]

    if (arg === '--agent-id') {
      opts.agentId = argv[i + 1]
      i++
      continue
    }
    if (arg === '--xlsx') {
      opts.xlsxPath = argv[i + 1]
      i++
      continue
    }
    if (arg === '--set-name') {
      opts.setName = argv[i + 1]
      i++
      continue
    }
    if (arg === '--description') {
      opts.description = argv[i + 1]
      i++
      continue
    }
    if (arg === '--help' || arg === '-h') {
      printUsageAndExit(0)
    }
  }

  if (!opts.agentId) {
    console.error('Missing required --agent-id')
    printUsageAndExit(1)
  }

  return {
    agentId: opts.agentId!,
    xlsxPath: opts.xlsxPath || 'Gloden Evaluation Set.xlsx',
    setName: opts.setName,
    description: opts.description,
  }
}

function printUsageAndExit(code: number): never {
  console.log(`
Usage:
  bun run src/import-golden-xlsx.ts --agent-id <agent-id> [options]

Options:
  --xlsx <path>         Path to XLSX file (default: Gloden Evaluation Set.xlsx)
  --set-name <name>     Eval set name (optional)
  --description <text>  Eval set description (optional)
  --help, -h            Show this help
`)
  process.exit(code)
}

function readRowsFromXlsx(xlsxPath: string): ImportRow[] {
  const pythonCode = `
import json
import sys
from openpyxl import load_workbook

path = sys.argv[1]
wb = load_workbook(path, read_only=True, data_only=True)
ws = wb.active

rows = list(ws.iter_rows(values_only=True))
if not rows:
    print("[]")
    sys.exit(0)

def norm(v):
    if v is None:
        return ""
    return str(v).strip().lower()

headers = [norm(h) for h in rows[0]]

def idx(names):
    for n in names:
        if n in headers:
            return headers.index(n)
    return -1

question_i = idx(["question"])
answer_i = idx(["good quality answer", "golden answer", "expected answer"])
doc_i = idx(["doc link", "golden sources", "source", "source link"])
email_i = idx(["user email id", "user email", "email"])

out = []
for i, row in enumerate(rows[1:], start=2):
    question = row[question_i] if question_i >= 0 and question_i < len(row) else None
    if question is None or str(question).strip() == "":
        continue

    answer = row[answer_i] if answer_i >= 0 and answer_i < len(row) else None
    doc = row[doc_i] if doc_i >= 0 and doc_i < len(row) else None
    email = row[email_i] if email_i >= 0 and email_i < len(row) else None

    out.append({
        "rowNumber": i,
        "question": str(question).strip(),
        "goldenAnswer": str(answer).strip() if answer is not None and str(answer).strip() else None,
        "docLink": str(doc).strip() if doc is not None and str(doc).strip() else None,
        "userEmail": str(email).strip() if email is not None and str(email).strip() else None
    })

print(json.dumps(out))
`

  const result = spawnSync('python3', ['-c', pythonCode, xlsxPath], {
    encoding: 'utf-8',
  })

  if (result.status !== 0) {
    throw new Error(`Failed to parse XLSX via python3/openpyxl: ${result.stderr || result.stdout}`)
  }

  try {
    const parsed = JSON.parse(result.stdout || '[]')
    if (!Array.isArray(parsed)) return []
    return parsed as ImportRow[]
  } catch (err) {
    throw new Error(`Failed to parse XLSX JSON output: ${String(err)}`)
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const xlsxPath = resolve(opts.xlsxPath)

  await initializeDB()

  const rows = readRowsFromXlsx(xlsxPath)
  if (rows.length === 0) {
    throw new Error(`No valid question rows found in: ${xlsxPath}`)
  }

  const setId = generateId()
  const agentType = await getAgentType(opts.agentId)
  const setName = opts.setName || `Golden Benchmark - ${basename(xlsxPath)}`
  const description = opts.description || `Imported from ${basename(xlsxPath)}`

  await db.insert(evalSets).values({
    id: setId,
    name: setName,
    description,
    agentId: opts.agentId,
    agentType,
    createdAt: new Date(),
  })

  let inserted = 0
  for (const row of rows) {
    await db.insert(evalCases).values({
      id: generateId(),
      evalSetId: setId,
      query: row.question,
      evalGuidance: null,
      goldenAnswer: row.goldenAnswer || null,
      goldenSources: row.docLink ? JSON.stringify([row.docLink]) : null,
      metadata: row.userEmail
        ? JSON.stringify({
            source: 'golden_xlsx_import',
            userEmail: row.userEmail,
            rowNumber: row.rowNumber,
          })
        : JSON.stringify({
            source: 'golden_xlsx_import',
            rowNumber: row.rowNumber,
          }),
      createdAt: new Date(),
    })
    inserted++
  }

  console.log(`✓ Created eval set: ${setName}`)
  console.log(`  Set ID: ${setId}`)
  console.log(`  Agent ID: ${opts.agentId}`)
  console.log(`  Cases imported: ${inserted}`)
  console.log(``)
  console.log(`Run benchmark eval:`)
  console.log(`  bun run src/cli.ts run ${setId}`)
}

main()
  .catch((err) => {
    console.error(`Import failed: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  })
  .finally(() => {
    closeDB()
  })
