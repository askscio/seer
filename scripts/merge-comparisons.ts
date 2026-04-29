#!/usr/bin/env bun
/**
 * Merge per-agent comparison CSVs into a single joined comparison.csv.
 * Usage: bun run scripts/merge-comparisons.ts <run-dir> <agent-subdir>...
 *
 * Assumes every comparison.csv carries the same (row_number,user_email,question,golden_source)
 * prefix and differs only in the agent-prefixed columns that follow.
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

const args = process.argv.slice(2);
if (args.length < 3) {
  console.error('Usage: bun run scripts/merge-comparisons.ts <run-dir> <agent-subdir>...');
  process.exit(1);
}
const runDir = path.resolve(args[0]);
const subdirs = args.slice(1);

const SHARED = ['row_number', 'user_email', 'question', 'golden_source'];

let sharedRows: Map<string, string[]> | null = null;
const agentHeaders: string[][] = [];
const agentRows: Map<string, string[]>[] = [];

for (const sub of subdirs) {
  const file = path.join(runDir, sub, 'comparison.csv');
  if (!existsSync(file)) {
    console.error(`missing ${file}`);
    process.exit(1);
  }
  const rows = parseCsv(readFileSync(file, 'utf8'));
  const header = rows[0];
  const sharedIdx = SHARED.map(s => header.indexOf(s));
  if (sharedIdx.some(i => i < 0)) {
    console.error(`${file} missing shared columns`);
    process.exit(1);
  }
  const agentCols: number[] = [];
  const agentHdr: string[] = [];
  header.forEach((h, i) => {
    if (!sharedIdx.includes(i)) { agentCols.push(i); agentHdr.push(h); }
  });
  agentHeaders.push(agentHdr);

  const mapShared = new Map<string, string[]>();
  const mapAgent = new Map<string, string[]>();
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const key = row[header.indexOf('row_number')];
    mapShared.set(key, sharedIdx.map(i => row[i] ?? ''));
    mapAgent.set(key, agentCols.map(i => row[i] ?? ''));
  }
  if (!sharedRows) sharedRows = mapShared;
  agentRows.push(mapAgent);
}

const keys = Array.from(sharedRows!.keys()).sort((a, b) => Number(a) - Number(b));

const outHeader = [...SHARED, ...agentHeaders.flat()];
const outRows: string[] = [outHeader.map(esc).join(',')];
for (const k of keys) {
  const row = [...(sharedRows!.get(k) || [])];
  for (const m of agentRows) row.push(...(m.get(k) || agentHeaders[agentRows.indexOf(m)].map(() => '')));
  outRows.push(row.map(esc).join(','));
}

const outPath = path.join(runDir, 'comparison.csv');
writeFileSync(outPath, outRows.join('\n') + '\n');
console.log(`wrote ${outPath} with ${keys.length} rows × ${outHeader.length} cols`);
