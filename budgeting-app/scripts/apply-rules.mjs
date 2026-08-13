#!/usr/bin/env node
/**
 * Seed rules from hand-labelled payee names, then run the rule stage over
 * everything still needing review.
 *
 * The Expense Manager payees are labels the owner wrote themselves, which makes
 * them a better signal than anything a model would infer from a bank descriptor.
 *
 * Usage: node scripts/apply-rules.mjs [--dry-run]
 */
import Database from 'better-sqlite3';
import path from 'node:path';

const DRY = process.argv.includes('--dry-run');
const d = new Database(path.join(process.env.DATA_DIR ?? 'data', 'budget.db'));

// match text -> category name. Order matters: first match wins.
const RULES = [
  // transfers between own accounts, never spending
  ['Chase 0091', 'Transfer - Internal'],
  ['Chase 1755', 'Transfer - Internal'],
  ['Chase 8126', 'Transfer - Internal'],
  ['Chase 5819', 'Transfer - Internal'],
  ['Chase 7529', 'Transfer - Internal'],
  ['Chase 2493', 'Transfer - Internal'],
  ['Chase ink', 'Transfer - Internal'],
  ['Amex 5-', 'Transfer - Internal'],
  ['U.S. Bank 4309', 'Transfer - Internal'],
  ['us bank', 'Transfer - Internal'],
  ['Apple card', 'Transfer - Internal'],
  ['ally ', 'Transfer - Internal'],
  // property
  ['Closing', 'Property Purchase / Refinance'],
  ['Santander', 'Mortgage'],
  ['Mortgage FL', 'Rental Expenses'],
  ['Lakeview', 'Rental Expenses'],
  ['Rushmore', 'Rental Expenses'],
  ['PennyMac', 'Rental Expenses'],
  ['Shellpoin', 'Rental Expenses'],
  ['Newrez', 'Rental Expenses'],
  // household and family
  ['Cleaning help', 'Housekeeping Help'],
  ['Baby nurse', 'High Baby Expenses'],
  ['Baby sitter', 'Baby Sitting'],
  ['Morah', 'Day Care'],
  // recurring bills
  ['AmeriHealth', 'Health Insurance'],
  ['Life insurance', 'Life Insurance'],
  ['JCP&L', 'Utilities - Electric'],
  ['NJ National Gas', 'Utilities - Gas / Oil'],
  ['NJ Natural Gas', 'Utilities - Gas / Oil'],
  ['T-Mobile', 'Utilities - Phone - Mobile'],
  ['Tmobile', 'Utilities - Phone - Mobile'],
  // giving
  ['מעשר', 'Charity / Maaser'],
  ['Maaser', 'Charity / Maaser'],
];

const catId = (n) => (d.prepare('SELECT id FROM categories WHERE name=?').get(n) ?? {}).id ?? null;

let added = 0;
const insRule = d.prepare(
  `INSERT INTO rules(priority,match_text,category_id,set_transfer)
   SELECT 60,?,?,?
   WHERE NOT EXISTS (SELECT 1 FROM rules WHERE match_text=? AND category_id=?)`
);
for (const [match, cat] of RULES) {
  const id = catId(cat);
  if (!id) { console.warn(`  ! no such category: ${cat}`); continue; }
  const isTransfer =
    (d.prepare('SELECT kind FROM categories WHERE id=?').get(id) ?? {}).kind === 'transfer' ? 1 : 0;
  const r = DRY ? { changes: 0 } : insRule.run(match, id, isTransfer, match, id);
  added += r.changes;
}
console.log(`rules added: ${added} (of ${RULES.length} defined)`);

// apply the rule stage to everything still needing review
const pending = d
  .prepare('SELECT id, raw_description, amount FROM transactions WHERE needs_review=1')
  .all();
const rules = d
  .prepare(
    `SELECT r.match_text, r.category_id, r.set_transfer, c.kind
       FROM rules r JOIN categories c ON c.id=r.category_id
      WHERE r.is_active=1 ORDER BY r.priority, r.id`
  )
  .all();

const upd = d.prepare(
  `UPDATE transactions SET category_id=?, is_transfer=?, is_one_time=?, needs_review=0,
          source='rule', confidence=0.95 WHERE id=?`
);

const hits = new Map();
const todo = [];
for (const t of pending) {
  const hay = (t.raw_description || '').toLowerCase();
  for (const r of rules) {
    if (!hay.includes(r.match_text.toLowerCase())) continue;
    todo.push([r.category_id, r.set_transfer, r.kind === 'one_time' ? 1 : 0, t.id]);
    hits.set(r.match_text, (hits.get(r.match_text) ?? 0) + 1);
    break;
  }
}
if (!DRY) {
  const run = d.transaction(() => { for (const a of todo) upd.run(...a); });
  run();
}

console.log(`${DRY ? 'would categorise' : 'categorised'}: ${todo.length} of ${pending.length} pending`);
for (const [k, n] of [...hits].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
  console.log(`   ${k.padEnd(24)} ${n}`);
}
console.log(`still needing review: ${pending.length - todo.length}`);
