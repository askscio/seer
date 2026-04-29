#!/usr/bin/env bun
import { readFileSync } from 'fs';
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
for (const f of process.argv.slice(2)) {
  const rows = parseCsv(readFileSync(f, 'utf8'));
  const h = rows[0];
  const ri = h.indexOf('row_number');
  const si = h.indexOf('status');
  console.log(`--- ${f} ---`);
  console.log(`  header cols=${h.length} data rows=${rows.length - 1}`);
  const seen = new Set<string>();
  for (let i = 1; i < rows.length; i++) {
    seen.add(rows[i][ri]);
    if (rows[i][si] !== 'ok') console.log(`  row ${rows[i][ri]} status=${rows[i][si]}`);
  }
  const uniq = Array.from(seen).sort((a, b) => Number(a) - Number(b));
  console.log(`  unique row_numbers=${uniq.length}: ${uniq.join(',')}`);
}
