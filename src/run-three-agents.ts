#!/usr/bin/env bun
/**
 * Orchestrate the TA AI Assistant LLM Judge testing plan.
 *
 * For each agent:
 *   1. Read questions + golden answers + golden source URLs from an XLSX file.
 *   2. Run the agent against every question (capture response, latency, retrieved/cited URLs).
 *   3. Score each (response, golden) pair with the 5 dimensions defined in the testing plan:
 *      answer_accuracy, answer_completeness, hallucination_risk, citation_correctness, latency.
 *   4. Write a per-agent CSV (response + sources + per-dimension category + reasoning).
 *
 * Then write a combined comparison.csv with one row per question and one block of columns per agent.
 *
 * Halts on the first hard error (per user instruction). Pass --continue-on-error to relax.
 */

import { resolve, join } from 'path'
import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { spawnSync } from 'child_process'

import { runAgent } from './data/glean'
import { extractAgentCitations, judgeResponseBatch } from './lib/judge'
import { getCriterion, categoryToNumeric, type CriterionDefinition } from './criteria/defaults'
import { tokenLedger } from './lib/token-ledger'

interface InputRow {
  rowNumber: number
  userEmail: string
  question: string
  goldenAnswer: string
  docLink: string
}

interface CliOptions {
  agentIds: string[]
  agentLabels: string[]
  xlsxPath: string
  outDir: string
  continueOnError: boolean
  limit?: number
  start?: number
  dimensions?: string[]
}

const DEFAULT_AGENTS = [
  { id: 'ee48307cbf174c19b6946fb7c5583307', label: 'single_flow_metadata' },
  { id: '00f0c8f443c6499f934a46f10524b3e9', label: 'single_flow' },
  { id: '96c9e83e381345469b42a07fed94386d', label: 'ta_ai_assistant' },
]

// Default dimensions for the testing plan (hallucination intentionally omitted —
// see note in run output: Glean REST API doesn't expose per-statement grounding,
// and re-injecting full retrieved-doc content exceeds judge context windows).
const DIMENSIONS = [
  'answer_accuracy',
  'answer_completeness',
  'citation_correctness',
  'latency',
]

function parseArgs(argv: string[]): CliOptions {
  const opts: Partial<CliOptions> & { continueOnError?: boolean } = {}
  let agentsArg: string | undefined

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--xlsx') { opts.xlsxPath = argv[++i]; continue }
    if (a === '--out-dir') { opts.outDir = argv[++i]; continue }
    if (a === '--agents') { agentsArg = argv[++i]; continue }
    if (a === '--continue-on-error') { opts.continueOnError = true; continue }
    if (a === '--limit') { opts.limit = Number(argv[++i]); continue }
    if (a === '--start') { opts.start = Number(argv[++i]); continue }
    if (a === '--dimensions') { opts.dimensions = argv[++i].split(',').map(s => s.trim()).filter(Boolean); continue }
    if (a === '--help' || a === '-h') usage(0)
  }

  let agentIds: string[]
  let agentLabels: string[]
  if (agentsArg) {
    const parts = agentsArg.split(',').map(s => s.trim()).filter(Boolean)
    agentIds = parts.map(p => p.includes(':') ? p.split(':')[1] : p)
    agentLabels = parts.map((p, idx) => p.includes(':') ? p.split(':')[0] : `agent_${idx + 1}`)
  } else {
    agentIds = DEFAULT_AGENTS.map(a => a.id)
    agentLabels = DEFAULT_AGENTS.map(a => a.label)
  }

  return {
    agentIds,
    agentLabels,
    xlsxPath: opts.xlsxPath || 'Gloden Evaluation Set1 - niti.xlsx',
    outDir: opts.outDir || `runs/three-agents-${new Date().toISOString().replace(/[:.]/g, '-')}`,
    continueOnError: !!opts.continueOnError,
    limit: opts.limit,
    start: opts.start,
    dimensions: opts.dimensions,
  }
}

function usage(code: number): never {
  console.log(`
Usage:
  bun run src/run-three-agents.ts [options]

Options:
  --xlsx <path>           Input XLSX (default: Gloden Evaluation Set1 - niti.xlsx)
  --out-dir <path>        Output directory (default: runs/three-agents-<timestamp>)
  --agents <list>         Comma-separated 'label:agent_id' pairs. Defaults to the 3 plan agents.
  --continue-on-error     Don't halt the whole run when one row errors.
  --limit <n>             Process only the first <n> question rows (after --start).
  --start <n>             Skip the first <n> question rows.
  --dimensions <list>     Comma-separated criterion IDs (overrides default 4-dim set).
  --help, -h              Show this help
`)
  process.exit(code)
}

function readRowsFromXlsx(xlsxPath: string): InputRow[] {
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

headers = [str(h).strip().lower() if h is not None else "" for h in rows[0]]

def idx(names):
    for n in names:
        if n in headers:
            return headers.index(n)
    return -1

row_i = idx(["#", "number"])
email_i = idx(["user email id", "user email", "email"])
question_i = idx(["question"])
answer_i = idx(["good quality answer", "golden answer", "expected answer"])
doc_i = idx(["doc link", "doc url", "source", "source link"])

out = []
for i, row in enumerate(rows[1:], start=2):
    question = row[question_i] if question_i >= 0 and question_i < len(row) else None
    if question is None or str(question).strip() == "":
        continue
    row_num_val = row[row_i] if row_i >= 0 and row_i < len(row) else None
    try:
        row_num = int(row_num_val) if row_num_val is not None else (i - 1)
    except:
        row_num = i - 1
    out.append({
        "rowNumber": row_num,
        "userEmail": str(row[email_i]).strip() if email_i >= 0 and email_i < len(row) and row[email_i] is not None else "",
        "question": str(question).strip(),
        "goldenAnswer": str(row[answer_i]).strip() if answer_i >= 0 and answer_i < len(row) and row[answer_i] is not None else "",
        "docLink": str(row[doc_i]).strip() if doc_i >= 0 and doc_i < len(row) and row[doc_i] is not None else "",
    })
print(json.dumps(out))
`
  const result = spawnSync('python3', ['-c', pythonCode, xlsxPath], { encoding: 'utf-8' })
  if (result.status !== 0) {
    throw new Error(`Failed to parse XLSX: ${result.stderr || result.stdout}`)
  }
  const parsed = JSON.parse(result.stdout || '[]')
  return Array.isArray(parsed) ? parsed as InputRow[] : []
}

function csvEscape(value: unknown): string {
  const s = value == null ? '' : String(value)
  return `"${s.replace(/"/g, '""')}"`
}

function ensureDir(p: string) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true })
}

interface AgentRunRecord {
  rowNumber: number
  userEmail: string
  question: string
  goldenAnswer: string
  goldenSource: string
  status: 'ok' | 'failed'
  error: string
  agentResponse: string
  latencyMs: number | ''
  traceId: string
  retrievedUrls: string
  citedUrls: string
  toolCalls: string
  scores: Record<string, { category: string; numeric: number | ''; reasoning: string }>
}

async function processOneAgent(
  agentLabel: string,
  agentId: string,
  rows: InputRow[],
  criteria: CriterionDefinition[],
  outDir: string,
  haltOnError: boolean,
): Promise<AgentRunRecord[]> {
  console.log(`\n=== Agent: ${agentLabel} (${agentId}) ===`)
  tokenLedger.setContext({ runLabel: agentLabel, agentId })
  const records: AgentRunRecord[] = []

  for (const [index, row] of rows.entries()) {
    const tag = `[${agentLabel} ${index + 1}/${rows.length} q#${row.rowNumber}]`
    process.stdout.write(`${tag} running... `)
    tokenLedger.setContext({ caseId: `q${row.rowNumber}` })

    const record: AgentRunRecord = {
      rowNumber: row.rowNumber,
      userEmail: row.userEmail,
      question: row.question,
      goldenAnswer: row.goldenAnswer,
      goldenSource: row.docLink,
      status: 'ok',
      error: '',
      agentResponse: '',
      latencyMs: '',
      traceId: '',
      retrievedUrls: '',
      citedUrls: '',
      toolCalls: '',
      scores: {},
    }

    try {
      const result = await runAgent(agentId, row.question, `q${row.rowNumber}`)
      const citations = extractAgentCitations(result.reasoningChain)
      record.agentResponse = result.response
      record.latencyMs = result.latencyMs
      record.traceId = result.traceId || ''
      record.retrievedUrls = citations.filter(c => c.kind === 'read' && c.url).map(c => c.url!).join(' | ')
      record.citedUrls = citations.filter(c => c.kind === 'cited' && c.url).map(c => c.url!).join(' | ')
      record.toolCalls = (result.toolCalls || []).map((t: any) => t.name).filter(Boolean).join(', ')

      process.stdout.write(`agent ok (${result.latencyMs}ms), judging... `)

      const goldenSources = row.docLink ? [row.docLink] : []
      const scores = await judgeResponseBatch(
        criteria,
        row.question,
        result.response,
        result,
        {
          goldenAnswer: row.goldenAnswer || undefined,
          goldenSources,
        },
      )

      for (const c of criteria) {
        const score = scores.find(s => s.criterionId === c.id)
        if (!score) {
          record.scores[c.id] = { category: 'missing', numeric: '', reasoning: 'No score returned' }
          continue
        }
        if (c.scoreType === 'metric') {
          record.scores[c.id] = {
            category: '',
            numeric: typeof score.scoreValue === 'number' ? score.scoreValue : '',
            reasoning: score.reasoning || '',
          }
        } else {
          const cat = score.scoreCategory || 'unknown'
          record.scores[c.id] = {
            category: cat,
            numeric: cat === 'skipped' ? '' : categoryToNumeric(c, cat),
            reasoning: score.reasoning || '',
          }
        }
      }

      process.stdout.write(`done\n`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      record.status = 'failed'
      record.error = message
      process.stdout.write(`FAILED: ${message}\n`)
      records.push(record)

      // Incremental flush so progress is never lost on crash/hang.
      await flushAgentCsv(agentLabel, criteria, records, outDir, /*quiet=*/ true)

      if (haltOnError) {
        throw new Error(`Halting: agent ${agentLabel} failed on row ${row.rowNumber}: ${message}`)
      }
      continue
    }

    records.push(record)
    // Incremental flush on success too.
    await flushAgentCsv(agentLabel, criteria, records, outDir, /*quiet=*/ true)
  }

  await flushAgentCsv(agentLabel, criteria, records, outDir)
  return records
}

async function flushAgentCsv(
  agentLabel: string,
  criteria: CriterionDefinition[],
  records: AgentRunRecord[],
  outDir: string,
  quiet = false,
) {
  ensureDir(outDir)
  const header = [
    'row_number',
    'user_email',
    'question',
    'golden_answer',
    'golden_source',
    'status',
    'error',
    'agent_response',
    'latency_ms',
    'trace_id',
    'retrieved_doc_urls',
    'cited_doc_urls',
    'tool_calls',
  ]
  for (const c of criteria) {
    header.push(`${c.id}_category`, `${c.id}_score`, `${c.id}_reasoning`)
  }

  const lines = [header.join(',')]
  for (const r of records) {
    const row: string[] = [
      csvEscape(r.rowNumber),
      csvEscape(r.userEmail),
      csvEscape(r.question),
      csvEscape(r.goldenAnswer),
      csvEscape(r.goldenSource),
      csvEscape(r.status),
      csvEscape(r.error),
      csvEscape(r.agentResponse),
      csvEscape(r.latencyMs),
      csvEscape(r.traceId),
      csvEscape(r.retrievedUrls),
      csvEscape(r.citedUrls),
      csvEscape(r.toolCalls),
    ]
    for (const c of criteria) {
      const s = r.scores[c.id]
      row.push(csvEscape(s?.category ?? ''), csvEscape(s?.numeric ?? ''), csvEscape(s?.reasoning ?? ''))
    }
    lines.push(row.join(','))
  }

  const path = join(outDir, `${agentLabel}.csv`)
  writeFileSync(path, `${lines.join('\n')}\n`, 'utf-8')
  if (!quiet) console.log(`  → wrote ${path}`)
}

function writeComparisonCsv(
  agentLabels: string[],
  perAgent: Record<string, AgentRunRecord[]>,
  criteria: CriterionDefinition[],
  outDir: string,
) {
  // Use the first agent's row order as the canonical sequence.
  const reference = perAgent[agentLabels[0]] || []
  const header: string[] = ['row_number', 'user_email', 'question', 'golden_source']

  for (const label of agentLabels) {
    header.push(`${label}__status`, `${label}__latency_ms`, `${label}__trace_id`, `${label}__cited_doc_urls`)
    for (const c of criteria) {
      header.push(`${label}__${c.id}_category`, `${label}__${c.id}_score`)
    }
  }

  const lines = [header.join(',')]

  for (const ref of reference) {
    const row: string[] = [
      csvEscape(ref.rowNumber),
      csvEscape(ref.userEmail),
      csvEscape(ref.question),
      csvEscape(ref.goldenSource),
    ]
    for (const label of agentLabels) {
      const rec = (perAgent[label] || []).find(x => x.rowNumber === ref.rowNumber)
      row.push(
        csvEscape(rec?.status ?? ''),
        csvEscape(rec?.latencyMs ?? ''),
        csvEscape(rec?.traceId ?? ''),
        csvEscape(rec?.citedUrls ?? ''),
      )
      for (const c of criteria) {
        const s = rec?.scores[c.id]
        row.push(csvEscape(s?.category ?? ''), csvEscape(s?.numeric ?? ''))
      }
    }
    lines.push(row.join(','))
  }

  const path = join(outDir, 'comparison.csv')
  writeFileSync(path, `${lines.join('\n')}\n`, 'utf-8')
  console.log(`\n→ wrote ${path}`)
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const xlsxPath = resolve(opts.xlsxPath)
  const outDir = resolve(opts.outDir)
  ensureDir(outDir)

  let rows = readRowsFromXlsx(xlsxPath)
  if (rows.length === 0) throw new Error(`No question rows found in ${xlsxPath}`)
  if (opts.start && opts.start > 0) rows = rows.slice(opts.start)
  if (opts.limit && opts.limit > 0) rows = rows.slice(0, opts.limit)
  if (rows.length === 0) throw new Error('No rows left after applying --start/--limit')

  const dimensionIds = opts.dimensions && opts.dimensions.length > 0 ? opts.dimensions : DIMENSIONS
  const criteria = dimensionIds.map(id => {
    const c = getCriterion(id)
    if (!c) throw new Error(`Unknown criterion: ${id}`)
    return c
  })

  console.log(`Plan: ${rows.length} questions × ${opts.agentIds.length} agents × ${criteria.length} dimensions`)
  console.log(`Input: ${xlsxPath}`)
  console.log(`Output dir: ${outDir}`)
  console.log(`Halt on error: ${!opts.continueOnError}`)

  const ledgerPath = join(outDir, 'token-usage.csv')
  tokenLedger.configure(ledgerPath)
  console.log(`Token ledger: ${ledgerPath}`)

  const perAgent: Record<string, AgentRunRecord[]> = {}
  for (let i = 0; i < opts.agentIds.length; i++) {
    const label = opts.agentLabels[i]
    const id = opts.agentIds[i]
    const records = await processOneAgent(label, id, rows, criteria, outDir, !opts.continueOnError)
    perAgent[label] = records
  }

  writeComparisonCsv(opts.agentLabels, perAgent, criteria, outDir)
  console.log(`\nDone. Artifacts in: ${outDir}`)
}

main().catch(err => {
  console.error(`\nRun aborted: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
