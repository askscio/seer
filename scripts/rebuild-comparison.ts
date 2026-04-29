#!/usr/bin/env bun
/**
 * Rebuild a per-agent comparison.csv from its detail CSV.
 * Usage: bun run scripts/rebuild-comparison.ts <run-dir> <agent-label> <detail-csv-filename>
 */

import { readFileSync, writeFileSync } from 'fs';
import path from 'path';

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { inQ = false; }
      } else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') { /* skip */ }
      else field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter(r => r.length && !(r.length === 1 && r[0] === ''));
}

function esc(v: string): string {
  if (v == null) return '';
  if (/[",\n\r]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
  return v;
}

const [runDir, agentLabel, detailFile] = process.argv.slice(2);
if (!runDir || !agentLabel || !detailFile) {
  console.error('Usage: bun run scripts/rebuild-comparison.ts <run-dir> <agent-label> <detail-csv>');
  process.exit(1);
}

const detailPath = path.join(runDir, detailFile);
const rows = parseCsv(readFileSync(detailPath, 'utf8'));
const h = rows[0];
const idx = (n: string) => h.indexOf(n);

const outHeader = [
  'row_number', 'user_email', 'question', 'golden_source',
  `${agentLabel}__status`,
  `${agentLabel}__latency_ms`,
  `${agentLabel}__trace_id`,
  `${agentLabel}__cited_doc_urls`,
  `${agentLabel}__answer_accuracy_category`,
  `${agentLabel}__answer_accuracy_score`,
  `${agentLabel}__answer_completeness_category`,
  `${agentLabel}__answer_completeness_score`,
  `${agentLabel}__citation_correctness_category`,
  `${agentLabel}__citation_correctness_score`,
  `${agentLabel}__latency_category`,
  `${agentLabel}__latency_score`,
];

const out: string[] = [outHeader.map(esc).join(',')];
for (let i = 1; i < rows.length; i++) {
  const r = rows[i];
  out.push([
    r[idx('row_number')],
    r[idx('user_email')],
    r[idx('question')],
    r[idx('golden_source')],
    r[idx('status')],
    r[idx('latency_ms')],
    r[idx('trace_id')],
    r[idx('cited_doc_urls')],
    r[idx('answer_accuracy_category')],
    r[idx('answer_accuracy_score')],
    r[idx('answer_completeness_category')],
    r[idx('answer_completeness_score')],
    r[idx('citation_correctness_category')],
    r[idx('citation_correctness_score')],
    r[idx('latency_category')],
    r[idx('latency_score')],
  ].map(esc).join(','));
}

const outPath = path.join(runDir, 'comparison.csv');
writeFileSync(outPath, out.join('\n') + '\n');
console.log(`wrote ${outPath} with ${rows.length - 1} rows`);
