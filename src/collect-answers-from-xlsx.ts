#!/usr/bin/env bun

/**
 * Collect agent answers from an XLSX question set without running judges.
 *
 * Reads rows from an Excel file and runs the agent for each question.
 * Outputs a CSV with the original fields plus agent response/status.
 */

import { resolve, dirname, basename, join } from 'path'
import { writeFileSync } from 'fs'
import { spawnSync } from 'child_process'
import { runAgent } from './data/glean'
import { extractAgentCitations } from './lib/judge'
import { tokenLedger } from './lib/token-ledger'

interface InputRow {
  rowNumber: number
  userEmail: string
  question: string
  goldenAnswer: string
  docLink: string
}

interface CliOptions {
  agentId: string
  xlsxPath: string
  outputCsv: string
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
    if (arg === '--out') {
      opts.outputCsv = argv[i + 1]
      i++
      continue
    }
    if (arg === '--help' || arg === '-h') {
      usage(0)
    }
  }

  if (!opts.agentId) {
    console.error('Missing --agent-id')
    usage(1)
  }

  const xlsxPath = opts.xlsxPath || 'Gloden Evaluation Set1 - niti.xlsx'
  const outputCsv = opts.outputCsv || 'answers-only-output.csv'

  return {
    agentId: opts.agentId!,
    xlsxPath,
    outputCsv,
  }
}

function usage(code: number): never {
  console.log(`
Usage:
  bun run src/collect-answers-from-xlsx.ts --agent-id <agent-id> [options]

Options:
  --xlsx <path>   Input XLSX path (default: Gloden Evaluation Set1 - niti.xlsx)
  --out <path>    Output CSV path (default: answers-only-output.csv)
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
        "docLink": str(row[doc_i]).strip() if doc_i >= 0 and doc_i < len(row) and row[doc_i] is not None else ""
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

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const xlsxPath = resolve(opts.xlsxPath)
  const outputCsv = resolve(opts.outputCsv)

  const rows = readRowsFromXlsx(xlsxPath)
  if (rows.length === 0) {
    throw new Error(`No question rows found in ${xlsxPath}`)
  }

  // Per-run token-usage ledger sits next to the answers CSV.
  const ledgerPath = join(dirname(outputCsv), `${basename(outputCsv, '.csv')}.token-usage.csv`)
  tokenLedger.configure(ledgerPath)
  tokenLedger.setContext({ runLabel: 'collect-answers', agentId: opts.agentId })
  console.log(`Collecting answers for ${rows.length} questions...`)
  console.log(`Token ledger: ${ledgerPath}`)

  const outputRows: string[] = []
  outputRows.push([
    'row_number',
    'user_email',
    'question',
    'golden_answer',
    'doc_link',
    'agent_response',
    'status',
    'error',
    'latency_ms',
    'trace_id',
    'retrieved_doc_urls',
    'cited_doc_urls',
    'tool_calls',
  ].join(','))

  for (const [index, row] of rows.entries()) {
    process.stdout.write(`[${index + 1}/${rows.length}] `)
    tokenLedger.setContext({ caseId: `q${row.rowNumber}` })
    try {
      const result = await runAgent(opts.agentId, row.question, `xlsx_row_${row.rowNumber}`)
      process.stdout.write(`ok (${result.latencyMs}ms)\n`)
      const citations = extractAgentCitations(result.reasoningChain)
      const retrievedUrls = citations.filter(c => c.kind === 'read' && c.url).map(c => c.url!).join(' | ')
      const citedUrls = citations.filter(c => c.kind === 'cited' && c.url).map(c => c.url!).join(' | ')
      const toolNames = (result.toolCalls || []).map((t: any) => t.name).filter(Boolean).join(', ')
      outputRows.push([
        csvEscape(row.rowNumber),
        csvEscape(row.userEmail),
        csvEscape(row.question),
        csvEscape(row.goldenAnswer),
        csvEscape(row.docLink),
        csvEscape(result.response),
        csvEscape('ok'),
        csvEscape(''),
        csvEscape(result.latencyMs),
        csvEscape(result.traceId || ''),
        csvEscape(retrievedUrls),
        csvEscape(citedUrls),
        csvEscape(toolNames),
      ].join(','))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      process.stdout.write(`failed (${message})\n`)
      outputRows.push([
        csvEscape(row.rowNumber),
        csvEscape(row.userEmail),
        csvEscape(row.question),
        csvEscape(row.goldenAnswer),
        csvEscape(row.docLink),
        csvEscape(''),
        csvEscape('failed'),
        csvEscape(message),
        csvEscape(''),
        csvEscape(''),
        csvEscape(''),
        csvEscape(''),
        csvEscape(''),
      ].join(','))
    }
  }

  writeFileSync(outputCsv, `${outputRows.join('\n')}\n`, 'utf-8')
  console.log(`\nSaved: ${outputCsv}`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
