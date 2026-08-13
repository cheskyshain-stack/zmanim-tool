#!/usr/bin/env node
/**
 * Load the normalised JSON from an ingestion adapter into the database.
 *
 * Safe to re-run: transactions upsert on externalId, so a re-import updates
 * rather than duplicating.
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), 'data');
const SRC = process.argv[2] ?? path.join(DATA_DIR, 'transactions.json');

const d = new Database(path.join(DATA_DIR, 'budget.db'));
d.pragma('journal_mode = WAL');
d.exec(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));

const payload = JSON.parse(fs.readFileSync(SRC, 'utf8'));

/* ------------------------------------------------------------------ entities */
const ENTITIES = [
  ['Personal', 'personal'],
  ['Business', 'business'],
  ['Rental', 'rental'],
];
const insEntity = d.prepare(
  'INSERT INTO entities(name,kind) VALUES(?,?) ON CONFLICT(name) DO NOTHING'
);
for (const [n, k] of ENTITIES) insEntity.run(n, k);
const entityId = Object.fromEntries(
  d.prepare('SELECT id,name FROM entities').all().map((r) => [r.name, r.id])
);

/* ---------------------------------------------------------------- categories */
// Groups whose spending is contractual and hard to change quickly.
const FIXED_GROUPS = new Set([
  'Shelter', 'Education', 'Debt Repayment', 'Transportation',
]);
// Individual categories that sit in a variable group but behave as fixed.
const FIXED_NAMES = new Set([
  'Housekeeping Help', 'Charity / Maaser', 'Life Insurance', 'Health Insurance',
  'Auto Insurance', 'Car Payment 1', 'Car Payment 2', 'Accountant',
  'Credit Card Fees & Interest', 'Hoa', 'Computer Apps',
]);
const ONE_TIME_GROUPS = new Set(['Capital Expenses']);
const YOM_TOV = new Set([
  'Rosh Hashana/Yom Kippur', 'Succos', 'Chanukah', 'Purim', 'Pesach',
  'Shavuos', 'Thanksgiving',
]);

// The workbook files these under income groups because of how the template was
// laid out, but the money flows outward. Left as-is they show up as "Income"
// worth tens of thousands of dollars of spending, which reads as nonsense.
const FORCE_EXPENSE = new Map([
  ['Rental Expenses', 'fixed'],
  ['1. Business Expenses', 'fixed'],
  ['2. Business Expenses', 'fixed'],
]);

function kindFor(c) {
  if (c.name === 'NEEDS REVIEW') return 'review';
  if (FORCE_EXPENSE.has(c.name)) return FORCE_EXPENSE.get(c.name);
  if (c.type === 'Transfer' || /^transfer/i.test(c.name)) return 'transfer';
  if (c.type === 'Income') return 'income';
  if (c.group === 'Savings') return 'savings';
  if (ONE_TIME_GROUPS.has(c.group)) return 'one_time';
  if (FIXED_NAMES.has(c.name)) return 'fixed';
  if (YOM_TOV.has(c.name)) return 'variable';
  if (FIXED_GROUPS.has(c.group)) return 'fixed';
  return 'variable';
}

const insCat = d.prepare(
  `INSERT INTO categories(name,parent,kind,sort) VALUES(?,?,?,?)
   ON CONFLICT(name) DO UPDATE SET parent=excluded.parent, kind=excluded.kind`
);
payload.categories.forEach((c, i) => insCat.run(c.name, c.group || null, kindFor(c), i));
const catId = Object.fromEntries(
  d.prepare('SELECT id,name FROM categories').all().map((r) => [r.name, r.id])
);

/* ------------------------------------------------------------------ accounts */
const BUSINESS_ACCOUNT = /cole health/i;
const insAcct = d.prepare(
  `INSERT INTO accounts(entity_id,name,mask,institution) VALUES(?,?,?,?)
   ON CONFLICT(name,mask) DO NOTHING`
);
const seenAcct = new Set();
for (const t of payload.transactions) {
  const key = `${t.account}|${t.mask}`;
  if (seenAcct.has(key)) continue;
  seenAcct.add(key);
  const ent = BUSINESS_ACCOUNT.test(t.account) ? entityId.Business : entityId.Personal;
  insAcct.run(ent, t.account || 'Unknown', t.mask || '', t.institution || '');
}
const acctId = Object.fromEntries(
  d.prepare('SELECT id,name,mask FROM accounts').all().map((r) => [`${r.name}|${r.mask}`, r.id])
);

/* -------------------------------------------------------------- transactions */
const insTx = d.prepare(
  `INSERT INTO transactions
     (external_id,account_id,entity_id,posted_date,amount,raw_description,
      category_id,source,confidence,needs_review,is_transfer,is_one_time)
   VALUES (@external_id,@account_id,@entity_id,@posted_date,@amount,@raw_description,
      @category_id,@source,@confidence,@needs_review,@is_transfer,@is_one_time)
   ON CONFLICT(external_id) DO UPDATE SET
      category_id=excluded.category_id, needs_review=excluded.needs_review,
      is_transfer=excluded.is_transfer, amount=excluded.amount`
);

const catKind = Object.fromEntries(
  d.prepare('SELECT name,kind FROM categories').all().map((r) => [r.name, r.kind])
);

let imported = 0, review = 0, transfers = 0;
const run = d.transaction((rows) => {
  for (const t of rows) {
    const cid = t.category ? catId[t.category] ?? null : null;
    const kind = t.category ? catKind[t.category] : null;
    const isTransfer = kind === 'transfer' ? 1 : 0;
    const needsReview = !cid || kind === 'review' ? 1 : 0;
    insTx.run({
      external_id: t.externalId,
      account_id: acctId[`${t.account}|${t.mask}`] ?? null,
      entity_id: BUSINESS_ACCOUNT.test(t.account) ? entityId.Business : entityId.Personal,
      posted_date: t.date,
      amount: t.amount,
      raw_description: t.description,
      category_id: cid,
      source: cid ? 'import' : null,
      confidence: cid ? 1 : null,
      needs_review: needsReview,
      is_transfer: isTransfer,
      is_one_time: kind === 'one_time' ? 1 : 0,
    });
    imported++;
    if (needsReview) review++;
    if (isTransfer) transfers++;
  }
});
run(payload.transactions);

/* --------------------------------------- build merchant memory from history */
// Everything already categorised is training data for the memory stage.
const norm = (s) =>
  (s || '')
    .replace(/^(sq|tst|sp|pp|paypal|pos|ach|web|tel|in|ls)\s*\*+\s*/i, '')
    .replace(/\b\d{2}\/\d{2}\b/g, ' ')
    .replace(/[\s*#-]*\b[a-z0-9]{6,}\b\s*$/i, '')
    .replace(/[^a-z0-9 .&'-]/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .toLowerCase();

const tally = new Map();
for (const t of payload.transactions) {
  if (!t.category) continue;
  const k = norm(t.description);
  if (!k) continue;
  if (!tally.has(k)) tally.set(k, { display: t.description, counts: new Map() });
  const e = tally.get(k);
  e.counts.set(t.category, (e.counts.get(t.category) ?? 0) + 1);
}
const insMerch = d.prepare(
  `INSERT INTO merchants(normalized,display,category_id,seen_count) VALUES(?,?,?,?)
   ON CONFLICT(normalized) DO UPDATE SET
     category_id=excluded.category_id, seen_count=excluded.seen_count`
);
let merchants = 0;
const runM = d.transaction(() => {
  for (const [k, e] of tally) {
    const [best, n] = [...e.counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!catId[best]) continue;
    insMerch.run(k, e.display, catId[best], n);
    merchants++;
  }
});
runM();

console.log(`imported     : ${imported} transactions`);
console.log(`  transfers  : ${transfers}`);
console.log(`  need review: ${review}`);
console.log(`merchant memory entries: ${merchants}`);
console.log(`categories   : ${payload.categories.length}`);
