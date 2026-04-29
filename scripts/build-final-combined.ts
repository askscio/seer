#!/usr/bin/env bun
/**
 * Build the final combined CSV across all 5 users.
 *
 * Output schema (per question × user):
 *   user, row_number, user_email, question, golden_answer, golden_source,
 *   a1_* (single_flow_metadata) block, a2_* (single_flow), a3_* (ta_ai_assistant)
 *
 * Each a<N>_* block:
 *   status, error, agent_response, latency_ms, trace_id, retrieved_doc_urls,
 *   cited_doc_urls, tool_calls,
 *   answer_accuracy_{category,score,reasoning},
 *   answer_completeness_{category,score,reasoning},
 *   citation_correctness_{category,score,reasoning},
 *   latency_{category,score,reasoning}
 *
 * Sources:
 *   - niti  -> runs/collated-niti/niti-collated-full.csv (already in this shape, a1/a2/a3)
 *   - damien/garima/jean/sylvia -> runs/<user>-full/{single_flow_metadata,single_flow,ta_ai_assistant}.csv
 *     (same per-agent detail schema in each; joined on row_number)
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import path from 'path';

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c !== '\r') field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.length && !(r.length === 1 && r[0] === ''));
}

function esc(v: string | undefined): string {
  if (v == null) return '';
  if (/[",\n\r]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
  return v;
}

const AGENT_FIELDS = [
  'status', 'error', 'agent_response', 'latency_ms', 'trace_id',
  'retrieved_doc_urls', 'cited_doc_urls', 'tool_calls',
  'answer_accuracy_category', 'answer_accuracy_score', 'answer_accuracy_reasoning',
  'answer_completeness_category', 'answer_completeness_score', 'answer_completeness_reasoning',
  'citation_correctness_category', 'citation_correctness_score', 'citation_correctness_reasoning',
  'latency_category', 'latency_score', 'latency_reasoning',
];

const SHARED_FIELDS = ['row_number', 'user_email', 'question', 'golden_answer', 'golden_source'];

const AGENT_PREFIX_MAP: Record<string, string> = {
  a1: 'single_flow_metadata',
  a2: 'single_flow',
  a3: 'ta_ai_assistant',
};

type Row = Record<string, string>;

function loadDetailCsv(file: string): Map<string, Row> {
  const rows = parseCsv(readFileSync(file, 'utf8'));
  const h = rows[0];
  const out = new Map<string, Row>();
  for (let i = 1; i < rows.length; i++) {
    const r: Row = {};
    for (let j = 0; j < h.length; j++) r[h[j]] = rows[i][j] ?? '';
    out.set(r['row_number'], r);
  }
  return out;
}

function emptyAgentBlock(): string[] {
  return AGENT_FIELDS.map(() => '');
}

function buildFromPerAgent(userSlug: string, runDir: string): string[][] {
  const files = {
    a1: path.join(runDir, 'single_flow_metadata.csv'),
    a2: path.join(runDir, 'single_flow.csv'),
    a3: path.join(runDir, 'ta_ai_assistant.csv'),
  };
  const data: Record<string, Map<string, Row>> = {};
  for (const [k, f] of Object.entries(files)) {
    if (!existsSync(f)) { console.error(`missing ${f}`); process.exit(1); }
    data[k] = loadDetailCsv(f);
  }
  const rowKeys = Array.from(new Set([
    ...data.a1.keys(), ...data.a2.keys(), ...data.a3.keys(),
  ])).sort((a, b) => Number(a) - Number(b));

  const out: string[][] = [];
  for (const k of rowKeys) {
    const primary = data.a1.get(k) || data.a2.get(k) || data.a3.get(k)!;
    const line = [
      userSlug,
      primary.row_number || k,
      primary.user_email || '',
      primary.question || '',
      primary.golden_answer || '',
      primary.golden_source || '',
    ];
    for (const slot of ['a1', 'a2', 'a3']) {
      const r = data[slot].get(k);
      if (!r) { line.push(...emptyAgentBlock()); continue; }
      for (const f of AGENT_FIELDS) line.push(r[f] ?? '');
    }
    out.push(line);
  }
  return out;
}

function buildFromNitiCollated(userSlug: string, file: string): string[][] {
  const rows = parseCsv(readFileSync(file, 'utf8'));
  const h = rows[0];
  const idx = (n: string) => h.indexOf(n);
  const out: string[][] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const line: string[] = [
      userSlug,
      r[idx('row_number')] ?? '',
      r[idx('user_email')] ?? '',
      r[idx('question')] ?? '',
      r[idx('golden_answer')] ?? '',
      r[idx('golden_source')] ?? '',
    ];
    for (const slot of ['a1', 'a2', 'a3']) {
      for (const f of AGENT_FIELDS) {
        const col = `${slot}_${f}`;
        const ci = idx(col);
        line.push(ci >= 0 ? (r[ci] ?? '') : '');
      }
    }
    out.push(line);
  }
  return out;
}

const header = [
  'user',
  ...SHARED_FIELDS,
  ...['a1', 'a2', 'a3'].flatMap(slot => AGENT_FIELDS.map(f => `${slot}_${f}`)),
];
const headerPrefixLine = [
  'user',
  ...SHARED_FIELDS,
  ...['a1', 'a2', 'a3'].flatMap(slot => AGENT_FIELDS.map(_ => AGENT_PREFIX_MAP[slot])),
];

const allRows: string[][] = [];

// Niti — from collated file
const nitiFile = 'runs/collated-niti/niti-collated-full.csv';
if (existsSync(nitiFile)) {
  allRows.push(...buildFromNitiCollated('niti', nitiFile));
} else {
  console.error(`missing ${nitiFile}`);
  process.exit(1);
}

for (const u of ['damien', 'garima', 'jean', 'sylvia']) {
  allRows.push(...buildFromPerAgent(u, `runs/${u}-full`));
}

const lines: string[] = [];
lines.push(header.map(esc).join(','));
lines.push(headerPrefixLine.map(esc).join(','));
for (const r of allRows) lines.push(r.map(esc).join(','));

const outPath = 'runs/final-combined.csv';
writeFileSync(outPath, lines.join('\n') + '\n');
console.log(`wrote ${outPath}`);
console.log(`  header columns: ${header.length}`);
console.log(`  data rows: ${allRows.length}`);
const byUser = new Map<string, number>();
for (const r of allRows) byUser.set(r[0], (byUser.get(r[0]) || 0) + 1);
console.log(`  rows per user: ${Array.from(byUser.entries()).map(([k,v])=>`${k}=${v}`).join(', ')}`);
