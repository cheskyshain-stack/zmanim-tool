#!/usr/bin/env node
/**
 * Correct two things the feed cannot know on its own.
 *
 * 1. The business distributes each 1099 deposit on a fixed formula: 25% set
 *    aside for tax, 15% to maaser, the rest drawn to personal. The 25% leg was
 *    landing in "1. Business Expenses", which overstates business costs and
 *    hides the tax reserve. Money set aside is savings, not spending.
 *
 *    The legs are identified by arithmetic rather than by amount: on any date, a
 *    withdrawal equal to a maaser withdrawal times 5/3 is the tax leg, because
 *    25/15 = 5/3. That keeps working when the deposit amounts change.
 *
 * 2. The W-2 paid into the personal account is the spouse's, so it belongs to
 *    Person 2. It was sitting under "1. Salary 1 - After Tax".
 *
 * Usage: node scripts/fix-business-distribution.mjs [--dry-run]
 */
import Database from 'better-sqlite3';
import path from 'node:path';

const DRY = process.argv.includes('--dry-run');
const d = new Database(path.join(process.env.DATA_DIR ?? 'data', 'budget.db'));

const catId = (n) => (d.prepare('SELECT id FROM categories WHERE name=?').get(n) ?? {}).id ?? null;

// Tax reserve is savings: the money is still yours, just spoken for.
d.prepare(
  `INSERT INTO categories(name,parent,kind) VALUES('Tax Reserve','Savings','savings')
   ON CONFLICT(name) DO UPDATE SET kind='savings', parent='Savings'`
).run();
const TAX = catId('Tax Reserve');
const P2 = catId('2. Salary 1 - After Tax');
const MAASER = catId('Charity / Maaser');
const BIZEXP = catId('1. Business Expenses');

/* ---------------- 1. tax legs, found by the 5/3 ratio to maaser ------------ */
const biz = d
  .prepare(
    `SELECT t.id, t.posted_date, t.amount, t.category_id
       FROM transactions t
       LEFT JOIN accounts a ON a.id = t.account_id
      WHERE a.name LIKE '%COLE%' AND t.amount < 0
        AND t.raw_description LIKE '%Mobile Banking Transfer%'`
  )
  .all();

// The rule is 25% of a deposit, so test against the deposits themselves.
// Matching against the maaser leg instead is fragile: those amounts drift by a
// dollar or two and get split across several withdrawals.
const deposits = d
  .prepare(
    `SELECT t.posted_date, t.amount FROM transactions t
       LEFT JOIN accounts a ON a.id = t.account_id
      WHERE a.name LIKE '%COLE%' AND t.amount > 0`
  )
  .all();

const days = (a, b) =>
  Math.abs((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000);

/** True when `amt` is 25% of one deposit, or of several within the window. */
function isTaxLeg(amt, date) {
  const near = deposits.filter((x) => days(x.posted_date, date) <= 12);
  for (const x of near) {
    if (Math.abs(amt - x.amount * 0.25) < 1.0) return true;
  }
  // catch-up payments covering more than one deposit
  for (let i = 0; i < near.length; i++)
    for (let j = i + 1; j < near.length; j++)
      if (Math.abs(amt - (near[i].amount + near[j].amount) * 0.25) < 1.0) return true;
  return false;
}

const taxRows = [];
const unmatched = [];
for (const t of biz) {
  if (t.category_id !== BIZEXP) continue;
  (isTaxLeg(Math.abs(t.amount), t.posted_date) ? taxRows : unmatched).push(t);
}

const updCat = d.prepare(
  `UPDATE transactions SET category_id=?, is_transfer=0, needs_review=0,
          source='rule', confidence=0.99 WHERE id=?`
);
if (!DRY) {
  const run = d.transaction(() => { for (const t of taxRows) updCat.run(TAX, t.id); });
  run();
}
const taxTotal = taxRows.reduce((a, b) => a + Math.abs(b.amount), 0);
console.log(`tax reserve legs moved out of business expenses: ${taxRows.length}, $${taxTotal.toLocaleString('en-US',{maximumFractionDigits:0})}`);
if (unmatched.length) {
  console.log(`  left alone (no matching maaser leg that date): ${unmatched.length}`);
  for (const t of unmatched.slice(0, 6)) console.log(`     ${t.posted_date}  $${t.amount.toFixed(2)}`);
}

/* ---------------- 2. the W-2 belongs to Person 2 --------------------------- */
const w2 = d
  .prepare(
    `SELECT t.id, t.amount FROM transactions t
       LEFT JOIN accounts a ON a.id = t.account_id
      WHERE t.category_id = ? AND t.amount > 0
        AND a.name NOT LIKE '%COLE%'
        AND t.raw_description LIKE '%Chs Payroll%'`
  )
  .all(catId('1. Salary 1 - After Tax'));
if (!DRY && P2) {
  const run = d.transaction(() => { for (const t of w2) updCat.run(P2, t.id); });
  run();
}
const w2Total = w2.reduce((a, b) => a + b.amount, 0);
console.log(`W-2 deposits moved to Person 2: ${w2.length}, $${w2Total.toLocaleString('en-US',{maximumFractionDigits:0})}`);

/* ---------------- 3. a personal category on a business outflow ------------ */
const stray = d
  .prepare(
    `SELECT t.id FROM transactions t
       LEFT JOIN accounts a ON a.id = t.account_id
       LEFT JOIN categories c ON c.id = t.category_id
      WHERE a.name LIKE '%COLE%' AND t.amount < 0 AND c.kind = 'income'`
  )
  .all();
if (!DRY && BIZEXP) {
  const run = d.transaction(() => { for (const t of stray) updCat.run(BIZEXP, t.id); });
  run();
}
console.log(`business outflows wrongly under an income category, moved: ${stray.length}`);

/* ---------------- report the resulting shape ------------------------------ */
console.log('\nBusiness account, last 12 months:');
const to = d.prepare('SELECT MAX(posted_date) v FROM transactions').get().v;
const dt = new Date(to + 'T00:00:00Z'); dt.setUTCMonth(dt.getUTCMonth() - 12);
const from = dt.toISOString().slice(0, 10);
for (const r of d
  .prepare(
    `SELECT COALESCE(c.name,'uncategorised') cat, COUNT(*) n, SUM(t.amount) v
       FROM transactions t
       LEFT JOIN categories c ON c.id=t.category_id
       LEFT JOIN accounts a ON a.id=t.account_id
      WHERE a.name LIKE '%COLE%' AND t.posted_date BETWEEN ? AND ?
      GROUP BY 1 ORDER BY v DESC`
  )
  .all(from, to)) {
  console.log(`  ${r.cat.padEnd(30)} ${String(r.n).padStart(3)}  $${Math.round(r.v).toLocaleString().padStart(9)}`);
}
