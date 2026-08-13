#!/usr/bin/env node
/**
 * Match the two halves of a money movement between accounts you own.
 *
 * Text matching is not enough. The paying side often names the recipient
 * ("Real Time Payment to Yechezkel Shain") while the receiving side is generic
 * ("Real Time Payment Credit Recd From Aba/contr Bnk"). Nothing in the receiving
 * description says where it came from, so the only reliable signal is the pair:
 * equal and opposite amounts, in two different accounts, a few days apart.
 *
 * Pairs that cross entities are treated as an owner draw rather than a plain
 * transfer: the business side is internal, and the personal side is income.
 * That distinction is the one the spreadsheet could not make.
 */
import Database from 'better-sqlite3';
import path from 'node:path';

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), 'data');
const WINDOW_DAYS = Number(process.env.PAIR_WINDOW_DAYS ?? 5);
const APPLY = !process.argv.includes('--dry-run');

const d = new Database(path.join(DATA_DIR, 'budget.db'));

const catId = (name) =>
  (d.prepare('SELECT id FROM categories WHERE name=?').get(name) ?? {}).id ?? null;

// Ensure the two categories we need exist.
for (const [name, kind] of [
  ['Transfer - Internal', 'transfer'],
  ['1. Draw from Business', 'income'],
]) {
  d.prepare(
    `INSERT INTO categories(name,kind,parent) VALUES(?,?,?)
     ON CONFLICT(name) DO UPDATE SET kind=excluded.kind`
  ).run(name, kind, kind === 'transfer' ? 'Transfers' : 'Person 1');
}
const TRANSFER = catId('Transfer - Internal');
const DRAW = catId('1. Draw from Business');

const rows = d
  .prepare(
    `SELECT t.id, t.posted_date, t.amount, t.account_id, t.entity_id,
            t.is_transfer, t.category_id, t.raw_description,
            e.kind AS entity_kind
       FROM transactions t
       LEFT JOIN entities e ON e.id = t.entity_id
      ORDER BY t.posted_date`
  )
  .all();

const days = (a, b) =>
  Math.abs((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000);

// Index candidate inflows by rounded absolute amount for a cheap lookup.
const byAmount = new Map();
for (const r of rows) {
  if (r.amount <= 0) continue;
  const k = Math.round(r.amount * 100);
  if (!byAmount.has(k)) byAmount.set(k, []);
  byAmount.get(k).push(r);
}

const used = new Set();
const pairs = [];

for (const out of rows) {
  if (out.amount >= 0) continue;
  if (used.has(out.id)) continue;
  const k = Math.round(-out.amount * 100);
  const candidates = (byAmount.get(k) ?? [])
    .filter(
      (c) =>
        !used.has(c.id) &&
        c.id !== out.id &&
        c.account_id !== out.account_id &&
        days(c.posted_date, out.posted_date) <= WINDOW_DAYS
    )
    .sort((a, b) => days(a.posted_date, out.posted_date) - days(b.posted_date, out.posted_date));

  const inn = candidates[0];
  if (!inn) continue;
  used.add(out.id);
  used.add(inn.id);
  pairs.push({ out, inn, crossEntity: out.entity_id !== inn.entity_id });
}

const upd = d.prepare(
  `UPDATE transactions
      SET category_id=?, is_transfer=?, transfer_pair=?, needs_review=0,
          source='rule', confidence=0.95
    WHERE id=?`
);

// Classify first so a dry run reports the same numbers an apply would.
for (const p of pairs) {
  p.isDraw = p.crossEntity && p.out.entity_kind === 'business';
}
const draws = pairs.filter((p) => p.isDraw).length;
const internal = pairs.length - draws;

if (APPLY) {
  const run = d.transaction(() => {
    for (const p of pairs) {
      if (p.isDraw) {
        // business pays out (internal), personal receives (income)
        upd.run(TRANSFER, 1, p.inn.id, p.out.id);
        upd.run(DRAW, 0, p.out.id, p.inn.id);
      } else {
        upd.run(TRANSFER, 1, p.inn.id, p.out.id);
        upd.run(TRANSFER, 1, p.out.id, p.inn.id);
      }
    }
  });
  run();
}

const sum = pairs.reduce((a, p) => a + Math.abs(p.out.amount), 0);
console.log(`${APPLY ? 'paired' : 'would pair'}: ${pairs.length} movements, $${sum.toLocaleString('en-US', { maximumFractionDigits: 0 })}`);
console.log(`  internal transfers : ${internal}`);
console.log(`  owner draws        : ${draws}`);
console.log('\nlargest:');
for (const p of pairs.sort((a, b) => Math.abs(b.out.amount) - Math.abs(a.out.amount)).slice(0, 8)) {
  console.log(
    `  $${Math.abs(p.out.amount).toFixed(2).padStart(10)}  ${p.out.posted_date}  ` +
      `${p.crossEntity ? 'DRAW    ' : 'internal'}  ${p.out.raw_description.slice(0, 40)}`
  );
}
