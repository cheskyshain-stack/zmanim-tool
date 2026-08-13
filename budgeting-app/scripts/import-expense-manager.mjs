#!/usr/bin/env node
/**
 * Ingestion adapter: Expense Manager CSV -> database.
 *
 * A sibling of the spreadsheet adapter, and the point of the interface: a second
 * source lands in the same tables without touching the app.
 *
 * Two rules keep it honest:
 *  - Only rows BEFORE the bank feed starts are imported, so the overlap is not
 *    counted twice. The bank feed wins where both cover a date.
 *  - Rows dated in the future are planned, not actual, and are skipped.
 *
 * Its value is history: the bank feed starts 2025-05, this goes back to 2022,
 * which is what seasonal figures need.
 *
 * Usage: node scripts/import-expense-manager.mjs <file.csv> [--dry-run]
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const SRC = process.argv[2];
const DRY = process.argv.includes('--dry-run');
if (!SRC) {
  console.error('usage: node scripts/import-expense-manager.mjs <file.csv> [--dry-run]');
  process.exit(1);
}

const d = new Database(path.join(process.env.DATA_DIR ?? 'data', 'budget.db'));

/** Minimal CSV parser: handles quoted fields and embedded commas. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

const raw = fs.readFileSync(SRC, 'utf8').replace(/^﻿/, '');
const table = parseCsv(raw);
const head = table[0].map((h) => h.trim());
const col = Object.fromEntries(head.map((h, i) => [h, i]));
const need = ['Date', 'Amount', 'Payee/Payer', 'Description', 'Category'];
for (const n of need) if (!(n in col)) throw new Error(`missing column: ${n}`);

const feedStart = (
  d.prepare("SELECT MIN(posted_date) v FROM transactions WHERE external_id NOT LIKE 'em-%'").get()
)?.v ?? '9999-12-31';
const today = new Date().toISOString().slice(0, 10);
console.log(`bank feed starts ${feedStart}; importing rows before that, skipping future rows`);

const acct = d.prepare(
  `INSERT INTO accounts(entity_id,name,mask,institution)
   VALUES((SELECT id FROM entities WHERE name='Personal'),'Expense Manager (history)','','manual')
   ON CONFLICT(name,mask) DO NOTHING`
);
acct.run();
const acctId = d.prepare("SELECT id FROM accounts WHERE name='Expense Manager (history)'").get().id;
const personal = d.prepare("SELECT id FROM entities WHERE name='Personal'").get().id;

const ins = d.prepare(
  `INSERT INTO transactions
     (external_id,account_id,entity_id,posted_date,amount,raw_description,needs_review,source)
   VALUES (?,?,?,?,?,?,1,'import')
   ON CONFLICT(external_id) DO UPDATE SET amount=excluded.amount,
     raw_description=excluded.raw_description`
);

let imported = 0, skippedOverlap = 0, skippedFuture = 0, skippedBad = 0;
const rowsToRun = [];
for (let i = 1; i < table.length; i++) {
  const r = table[i];
  const date = (r[col['Date']] ?? '').trim();
  const amount = Number((r[col['Amount']] ?? '').trim());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(amount)) { skippedBad++; continue; }
  if (date > today) { skippedFuture++; continue; }
  if (date >= feedStart) { skippedOverlap++; continue; }

  const payee = (r[col['Payee/Payer']] ?? '').trim();
  const desc = (r[col['Description']] ?? '').trim();
  // Payee is the hand-labelled part and the most useful signal; keep both.
  const text = [payee, desc].filter(Boolean).join(' - ') || 'unlabelled';
  const rowId = (r[col['Row Id']] ?? String(i)).trim();
  rowsToRun.push([`em-${rowId}`, acctId, personal, date, amount, text]);
  imported++;
}

if (!DRY) {
  const run = d.transaction(() => { for (const a of rowsToRun) ins.run(...a); });
  run();
}

console.log(`${DRY ? 'would import' : 'imported'} : ${imported}`);
console.log(`  skipped, overlaps the bank feed : ${skippedOverlap}`);
console.log(`  skipped, dated in the future    : ${skippedFuture}`);
console.log(`  skipped, unparseable            : ${skippedBad}`);
if (rowsToRun.length) {
  const dates = rowsToRun.map((x) => x[3]).sort();
  console.log(`  history added: ${dates[0]} .. ${dates[dates.length - 1]}`);
}
