#!/usr/bin/env bun
/**
 * Retry only the failed rows in a <run-dir>, in-place.
 *
 * For each per-agent CSV in the run directory:
 *   1. Find rows with status=failed.
 *   2. If agent_response is empty → re-run the agent, then re-judge.
 *   3. If agent_response is present → skip the agent call, synthesise an
 *      AgentResult (reasoning chain from stored cited/retrieved URLs) and
 *      re-judge only.
 *   4. Replace the failed row in the CSV with the repaired row (writing
 *      the whole CSV back on each repair to remain crash-safe).
 *
 * Halts only if the run-dir is malformed; individual repair failures are
 * logged and left as status=failed so the next retry picks them up.
 *
 * Usage:
 *   bun run src/retry-failed-rows.ts \
 *     --run-dir runs/garima-full \
 *     --xlsx "Gloden Evaluation Set1 - garima.xlsx"
 *
 * Options:
 *   --dimensions <list>   Comma-separated criterion IDs
 *                         (defaults to answer_accuracy,answer_completeness,citation_correctness,latency)
 *   --agents <list>       Comma-separated 'label:agent_id' pairs
 *                         (defaults to the 3 plan agents).
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, resolve } from 'path'
import { spawnSync } from 'child_process'

import { runAgent } from './data/glean'
import { extractAgentCitations, judgeResponseBatch } from './lib/judge'
import { getCriterion, categoryToNumeric, type CriterionDefinition } from './criteria/defaults'
import { tokenLedger } from './lib/token-ledger'
import type { AgentResult } from './types'

interface CliOptions {
  runDir: string
  xlsxPath: string
  dimensions: string[]
  agents: { label: string; id: string }[]
}

const DEFAULT_AGENTS = [
  { label: 'single_flow_metadata', id: 'ee48307cbf174c19b6946fb7c5583307' },
  { label: 'single_flow', id: '00f0c8f443c6499f934a46f10524b3e9' },
  { label: 'ta_ai_assistant', id: '96c9e83e381345469b42a07fed94386d' },
]

const DEFAULT_DIMS = [
  'answer_accuracy',
  'answer_completeness',
  'citation_correctness',
  'latency',
]

function parseArgs(argv: string[]): CliOptions {
  let runDir: string | undefined
  let xlsxPath: string | undefined
  let dimensions: string[] | undefined
  let agents: { label: string; id: string }[] | undefined

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--run-dir') { runDir = argv[++i]; continue }
    if (a === '--xlsx') { xlsxPath = argv[++i]; continue }
    if (a === '--dimensions') {
      dimensions = argv[++i].split(',').map(s => s.trim()).filter(Boolean)
      continue
    }
    if (a === '--agents') {
      const raw = argv[++i]
      agents = raw.split(',').map(s => s.trim()).filter(Boolean).map(pair => {
        const [label, id] = pair.split(':')
        if (!label || !id) throw new Error(`Bad --agents entry: ${pair}`)
        return { label, id }
      })
      continue
    }
    if (a === '--help' || a === '-h') {
      console.log('Usage: bun run src/retry-failed-rows.ts --run-dir <dir> --xlsx <path>')
      process.exit(0)
    }
  }

  if (!runDir) throw new Error('--run-dir is required')
  if (!xlsxPath) throw new Error('--xlsx is required')

  return {
    runDir: resolve(runDir),
    xlsxPath: resolve(xlsxPath),
    dimensions: dimensions ?? DEFAULT_DIMS,
    agents: agents ?? DEFAULT_AGENTS,
  }
}

interface XlsxRow {
  rowNumber: number
  userEmail: string
  question: string
  goldenAnswer: string
  docLink: string
}

function readXlsx(xlsxPath: string): Map<number, XlsxRow> {
  const pythonCode = `
import json, sys
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
email_i = idx(["user email id", "email"])
q_i = idx(["question"])
a_i = idx(["good quality answer", "golden answer", "answer"])
d_i = idx(["doc link", "source", "sources"])

out = []
for r in rows[1:]:
    if not r: continue
    rn = r[row_i] if row_i >= 0 else None
    try: rn = int(rn) if rn is not None else None
    except: rn = None
    out.append({
        "rowNumber": rn,
        "userEmail": str(r[email_i]).strip() if email_i >= 0 and r[email_i] is not None else "",
        "question": str(r[q_i]).strip() if q_i >= 0 and r[q_i] is not None else "",
        "goldenAnswer": str(r[a_i]).strip() if a_i >= 0 and r[a_i] is not None else "",
        "docLink": str(r[d_i]).strip() if d_i >= 0 and r[d_i] is not None else "",
    })
print(json.dumps(out))
`.trim()
  const out = spawnSync('python3', ['-c', pythonCode, xlsxPath], { encoding: 'utf-8' })
  if (out.status !== 0) {
    throw new Error(`xlsx read failed: ${out.stderr}`)
  }
  const arr = JSON.parse(out.stdout) as XlsxRow[]
  const map = new Map<number, XlsxRow>()
  for (const r of arr) if (r.rowNumber != null) map.set(r.rowNumber, r)
  return map
}

interface CsvRow {
  [key: string]: string
}

function parseCsv(text: string): { header: string[]; rows: CsvRow[] } {
  // RFC-4180-ish parser that tolerates embedded newlines inside quoted fields.
  const out: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue }
        inQuotes = false; i++; continue
      }
      field += ch; i++; continue
    }
    if (ch === '"') { inQuotes = true; i++; continue }
    if (ch === ',') { row.push(field); field = ''; i++; continue }
    if (ch === '\n') { row.push(field); out.push(row); row = []; field = ''; i++; continue }
    if (ch === '\r') { i++; continue }
    field += ch; i++
  }
  if (field.length > 0 || row.length > 0) { row.push(field); out.push(row) }
  // Drop trailing empty row produced by final newline
  while (out.length && out[out.length - 1].length === 1 && out[out.length - 1][0] === '') out.pop()

  const header = out.shift() || []
  const rows = out.map(cells => {
    const obj: CsvRow = {}
    header.forEach((h, idx) => { obj[h] = cells[idx] ?? '' })
    return obj
  })
  return { header, rows }
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return ''
  const s = String(value)
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function writeCsv(path: string, header: string[], rows: CsvRow[]) {
  const lines = [header.map(csvEscape).join(',')]
  for (const r of rows) {
    lines.push(header.map(h => csvEscape(r[h] ?? '')).join(','))
  }
  writeFileSync(path, `${lines.join('\n')}\n`, 'utf-8')
}

function urlsFromField(field: string): string[] {
  if (!field) return []
  return field.split(' | ').map(s => s.trim()).filter(Boolean)
}

function buildSyntheticResult(r: CsvRow, question: string): AgentResult {
  const citedUrls = urlsFromField(r.cited_doc_urls || '')
  const retrievedUrls = urlsFromField(r.retrieved_doc_urls || '')
  // Minimal reasoningChain that extractAgentCitations() can parse.
  const reasoningChain = [
    {
      citations: citedUrls.map(url => ({ url })),
      documentsRead: retrievedUrls.map(url => ({ url })),
    },
  ]
  const latency = Number(r.latency_ms) || 0
  return {
    caseId: `q${r.row_number}`,
    query: question,
    response: r.agent_response || '',
    latencyMs: latency,
    toolCalls: (r.tool_calls || '').split(',').map(s => s.trim()).filter(Boolean).map(name => ({ name })),
    traceId: r.trace_id || undefined,
    reasoningChain,
    timestamp: new Date(),
  }
}

async function repairRow(
  r: CsvRow,
  xlsx: XlsxRow,
  agentId: string,
  criteria: CriterionDefinition[],
): Promise<CsvRow> {
  const caseId = `q${r.row_number}`
  tokenLedger.setContext({ caseId })

  const hasAgent = !!(r.agent_response && r.agent_response.trim())
  let result: AgentResult
  if (!hasAgent) {
    console.log(`    q#${r.row_number}: re-running agent + judges...`)
    const ran = await runAgent(agentId, xlsx.question, caseId)
    result = ran
    const citations = extractAgentCitations(ran.reasoningChain)
    r.agent_response = ran.response
    r.latency_ms = String(ran.latencyMs)
    r.trace_id = ran.traceId || ''
    r.retrieved_doc_urls = citations.filter(c => c.kind === 'read' && c.url).map(c => c.url!).join(' | ')
    r.cited_doc_urls = citations.filter(c => c.kind === 'cited' && c.url).map(c => c.url!).join(' | ')
    r.tool_calls = (ran.toolCalls || []).map((t: any) => t.name).filter(Boolean).join(', ')
  } else {
    console.log(`    q#${r.row_number}: re-judging (agent response present)...`)
    result = buildSyntheticResult(r, xlsx.question)
  }

  const goldenSources = xlsx.docLink ? [xlsx.docLink] : []
  const scores = await judgeResponseBatch(
    criteria,
    xlsx.question,
    result.response,
    result,
    { goldenAnswer: xlsx.goldenAnswer || undefined, goldenSources },
  )

  for (const c of criteria) {
    const score = scores.find(s => s.criterionId === c.id)
    if (!score) {
      r[`${c.id}_category`] = 'missing'
      r[`${c.id}_score`] = ''
      r[`${c.id}_reasoning`] = 'No score returned'
      continue
    }
    if (c.scoreType === 'metric') {
      r[`${c.id}_category`] = ''
      r[`${c.id}_score`] = typeof score.scoreValue === 'number' ? String(score.scoreValue) : ''
      r[`${c.id}_reasoning`] = score.reasoning || ''
    } else {
      const cat = score.scoreCategory || 'unknown'
      r[`${c.id}_category`] = cat
      r[`${c.id}_score`] = cat === 'skipped' ? '' : String(categoryToNumeric(c, cat))
      r[`${c.id}_reasoning`] = score.reasoning || ''
    }
  }

  r.status = 'ok'
  r.error = ''
  return r
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (!existsSync(opts.runDir)) throw new Error(`No such run dir: ${opts.runDir}`)
  if (!existsSync(opts.xlsxPath)) throw new Error(`No such xlsx: ${opts.xlsxPath}`)

  const criteria = opts.dimensions.map(id => {
    const c = getCriterion(id)
    if (!c) throw new Error(`Unknown criterion: ${id}`)
    return c
  })

  const xlsx = readXlsx(opts.xlsxPath)
  console.log(`Loaded ${xlsx.size} rows from ${opts.xlsxPath}`)

  const ledgerPath = join(opts.runDir, 'retry-token-usage.csv')
  tokenLedger.configure(ledgerPath)
  console.log(`Retry token ledger: ${ledgerPath}`)

  for (const agent of opts.agents) {
    const csvPath = join(opts.runDir, `${agent.label}.csv`)
    if (!existsSync(csvPath)) {
      console.log(`\n[${agent.label}] no CSV at ${csvPath}, skipping`)
      continue
    }

    tokenLedger.setContext({ runLabel: agent.label, agentId: agent.id })
    const raw = readFileSync(csvPath, 'utf-8')
    const { header, rows } = parseCsv(raw)
    const failed = rows.filter(r => r.status === 'failed')
    console.log(`\n[${agent.label}] ${rows.length} rows, ${failed.length} failed`)
    if (failed.length === 0) continue

    for (const r of failed) {
      const rn = Number(r.row_number)
      const xRow = xlsx.get(rn)
      if (!xRow) {
        console.log(`    q#${r.row_number}: no xlsx row, skipping`)
        continue
      }
      try {
        await repairRow(r, xRow, agent.id, criteria)
        writeCsv(csvPath, header, rows)
        console.log(`    q#${r.row_number}: repaired and flushed`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        r.error = msg
        writeCsv(csvPath, header, rows)
        console.log(`    q#${r.row_number}: STILL FAILED: ${msg}`)
      }
    }

    console.log(`[${agent.label}] done`)
  }

  console.log('\nAll agents processed.')
}

main().catch(err => {
  console.error('FATAL:', err)
  process.exit(1)
})
