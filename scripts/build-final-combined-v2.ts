#!/usr/bin/env bun
/**
 * Build v2 combined CSV across all 5 users.
 *
 * A1 (single_flow_metadata): previous baseline runs (unchanged)
 * A2 (single_flow):          fresh rerun-a2 results (best run per user)
 * A3 (ta_ai_assistant):      previous baseline runs (unchanged)
 *
 * Output schema matches build-final-combined.ts so downstream consumers
 * (insights scripts, etc.) can use it as a drop-in.
 *
 * Niti requires question-text matching because the baseline and rerun-a2
 * CSVs use different row_number schemes (1..22 vs 1,6,11,... 107).
 * All other users align on row_number.
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

// Per-user choices for the new A2 run (confirmed best of the rerun-a2 batch)
const A2_RERUN: Record<string, string> = {
  damien: 'runs/rerun-a2/damien-2/single_flow.csv',
  garima: 'runs/rerun-a2/garima/single_flow.csv',
  jean:   'runs/rerun-a2/jean/single_flow.csv',
  sylvia: 'runs/rerun-a2/sylvia-2/single_flow.csv',
  niti:   'runs/rerun-a2/niti-2/single_flow.csv',
};

type Row = Record<string, string>;

function loadDetailCsv(file: string): Row[] {
  const rows = parseCsv(readFileSync(file, 'utf8'));
  const h = rows[0];
  const out: Row[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r: Row = {};
    for (let j = 0; j < h.length; j++) r[h[j]] = rows[i][j] ?? '';
    out.push(r);
  }
  return out;
}

function indexByRowNumber(rows: Row[]): Map<string, Row> {
  const m = new Map<string, Row>();
  for (const r of rows) m.set(r['row_number'], r);
  return m;
}

function normQ(s: string | undefined): string {
  return (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function indexByQuestion(rows: Row[]): Map<string, Row> {
  const m = new Map<string, Row>();
  for (const r of rows) m.set(normQ(r['question']), r);
  return m;
}

function emptyAgentBlock(): string[] {
  return AGENT_FIELDS.map(() => '');
}

/**
 * For damien/garima/jean/sylvia: A1 + A3 come from <user>-full/<label>.csv
 * (all share row_number). A2 comes from the rerun-a2 CSV (also row_number aligned).
 */
function buildForUser(userSlug: string): string[][] {
  const baseDir = `runs/${userSlug}-full`;
  const a1Rows = loadDetailCsv(path.join(baseDir, 'single_flow_metadata.csv'));
  const a3Rows = loadDetailCsv(path.join(baseDir, 'ta_ai_assistant.csv'));
  const a2Rows = loadDetailCsv(A2_RERUN[userSlug]);

  const a1 = indexByRowNumber(a1Rows);
  const a2 = indexByRowNumber(a2Rows);
  const a3 = indexByRowNumber(a3Rows);

  const rowKeys = Array.from(new Set([...a1.keys(), ...a2.keys(), ...a3.keys()]))
    .sort((a, b) => Number(a) - Number(b));

  const out: string[][] = [];
  for (const k of rowKeys) {
    const primary = a1.get(k) || a2.get(k) || a3.get(k)!;
    const line = [
      userSlug,
      primary.row_number || k,
      primary.user_email || '',
      primary.question || '',
      primary.golden_answer || '',
      primary.golden_source || '',
    ];
    for (const slot of [a1, a2, a3]) {
      const r = slot.get(k);
      if (!r) { line.push(...emptyAgentBlock()); continue; }
      for (const f of AGENT_FIELDS) line.push(r[f] ?? '');
    }
    out.push(line);
  }
  return out;
}

/**
 * Niti: A1 and A3 come from niti-collated-full.csv (which already has a1_/a2_/a3_
 * blocks). A2 is replaced by rerun-a2/niti-2/single_flow.csv, matched on question text.
 */
function buildForNiti(): string[][] {
  const collatedFile = 'runs/collated-niti/niti-collated-full.csv';
  if (!existsSync(collatedFile)) { console.error(`missing ${collatedFile}`); process.exit(1); }
  if (!existsSync(A2_RERUN.niti)) { console.error(`missing ${A2_RERUN.niti}`); process.exit(1); }

  const collated = parseCsv(readFileSync(collatedFile, 'utf8'));
  const h = collated[0];
  const idx = (n: string) => h.indexOf(n);

  const a2New = loadDetailCsv(A2_RERUN.niti);
  const a2ByQ = indexByQuestion(a2New);

  const out: string[][] = [];
  let matched = 0;
  const unmatched: string[] = [];

  for (let i = 1; i < collated.length; i++) {
    const r = collated[i];
    const q = r[idx('question')] ?? '';
    const line: string[] = [
      'niti',
      r[idx('row_number')] ?? '',
      r[idx('user_email')] ?? '',
      q,
      r[idx('golden_answer')] ?? '',
      r[idx('golden_source')] ?? '',
    ];

    // A1 block from collated
    for (const f of AGENT_FIELDS) {
      const col = `a1_${f}`;
      const ci = idx(col);
      line.push(ci >= 0 ? (r[ci] ?? '') : '');
    }

    // A2 block from rerun (question-text match)
    const a2r = a2ByQ.get(normQ(q));
    if (a2r) {
      matched++;
      for (const f of AGENT_FIELDS) line.push(a2r[f] ?? '');
    } else {
      unmatched.push(q.slice(0, 60));
      line.push(...emptyAgentBlock());
    }

    // A3 block from collated
    for (const f of AGENT_FIELDS) {
      const col = `a3_${f}`;
      const ci = idx(col);
      line.push(ci >= 0 ? (r[ci] ?? '') : '');
    }

    out.push(line);
  }

  console.log(`niti: A2 matched ${matched}/${collated.length - 1} rows by question text`);
  if (unmatched.length) console.log(`niti: unmatched questions: ${JSON.stringify(unmatched)}`);
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
allRows.push(...buildForNiti());
for (const u of ['damien', 'garima', 'jean', 'sylvia']) {
  allRows.push(...buildForUser(u));
}

const lines: string[] = [];
lines.push(header.map(esc).join(','));
lines.push(headerPrefixLine.map(esc).join(','));
for (const r of allRows) lines.push(r.map(esc).join(','));

const outPath = 'runs/final-combined-v2.csv';
writeFileSync(outPath, lines.join('\n') + '\n');
console.log(`wrote ${outPath}`);
console.log(`  header columns: ${header.length}`);
console.log(`  data rows: ${allRows.length}`);
const byUser = new Map<string, number>();
for (const r of allRows) byUser.set(r[0], (byUser.get(r[0]) || 0) + 1);
console.log(`  rows per user: ${Array.from(byUser.entries()).map(([k,v])=>`${k}=${v}`).join(', ')}`);
