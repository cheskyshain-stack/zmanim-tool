#!/usr/bin/env node
/**
 * Seed the property register from the balance sheet, the mortgage payments found
 * in the transaction feed, and what the owner has confirmed about occupancy.
 *
 * Safe to re-run: upserts on name.
 */
import Database from 'better-sqlite3';
import path from 'node:path';

const d = new Database(path.join(process.env.DATA_DIR ?? 'data', 'budget.db'));

// property_payers.kind was added after the first release; add it if missing.
const cols = d.prepare('PRAGMA table_info(property_payers)').all().map((c) => c.name);
if (!cols.includes('kind')) {
  d.exec("ALTER TABLE property_payers ADD COLUMN kind TEXT NOT NULL DEFAULT 'rent'");
}

const PROPERTIES = [
  {
    name: '293 Coles Way, Lakewood NJ', kind: 'residence', occupancy: 'n/a',
    market_value: 600000, lender: 'Santander', rate: 0.035,
    monthly_payment: 1603.99, loan_balance: 190878,
    notes: 'Primary residence',
  },
  {
    name: '12 Maple St', kind: 'rental', occupancy: 'unknown',
    market_value: 465000, lender: 'Pennymac', rate: 0.06375,
    monthly_payment: 2763.89, loan_balance: 347447,
    notes: 'Cash-out refi; first payment 2026-04-06. Refi proceeds funded another purchase.',
  },
  {
    name: '987 Grace', kind: 'rental', occupancy: 'unknown',
    market_value: 377200, lender: 'Rushmore', rate: 0.065,
    monthly_payment: 2572.25, loan_balance: 300937,
  },
  {
    name: '16717 Delia St, Wimauma FL', kind: 'rental', occupancy: 'unknown',
    market_value: 334700, lender: 'Lakeview', rate: 0.03125,
    monthly_payment: 2256.34, loan_balance: 270985,
  },
  {
    name: '267 Main St', kind: 'rental', occupancy: 'unknown',
    market_value: 115000, notes: 'No mortgage listed',
  },
  {
    name: '9514 Princess St', kind: 'rental', occupancy: 'unknown',
    market_value: 70000, lender: 'ShellPoint', rate: 0.09625,
    monthly_payment: 1474.96, loan_balance: 93341,
    notes: 'Bank not connected yet; payments visible only from 2026-07',
  },
  {
    name: '226 West Parker St', kind: 'rental', occupancy: 'unknown',
    market_value: 70000, notes: 'No mortgage listed',
  },
  // Confirmed by the owner but not yet tied to an address.
  {
    name: 'Mantoloking property A (rent $2,600)', kind: 'rental', occupancy: 'occupied',
    monthly_rent: 2600,
    notes: 'Paying. Managed by Mantoloking. Match to an address above and merge.',
  },
  {
    name: 'Mantoloking property B (rent $2,500)', kind: 'rental', occupancy: 'eviction',
    monthly_rent: 2500,
    notes: 'Not paying; eviction starting. Assume $0 rent until resolved.',
  },
  {
    name: 'Wrightdavis property', kind: 'rental', occupancy: 'vacant',
    notes: 'Currently vacant. Management changing, so a new payer name will appear.',
  },
];

// Renaming a property must update the existing row, not create a second one.
// The upsert keys on name, so retire the old name explicitly first.
const RENAMES = [['16717 Delia St', '16717 Delia St, Wimauma FL']];
for (const [oldName, newName] of RENAMES) {
  const old = d.prepare('SELECT id FROM properties WHERE name=?').get(oldName);
  const cur = d.prepare('SELECT id FROM properties WHERE name=?').get(newName);
  if (old && !cur) d.prepare('UPDATE properties SET name=? WHERE id=?').run(newName, old.id);
  else if (old && cur) {
    d.prepare('DELETE FROM property_payers WHERE property_id=?').run(old.id);
    d.prepare('DELETE FROM properties WHERE id=?').run(old.id);
  }
}

const up = d.prepare(`
  INSERT INTO properties
    (name,kind,status,occupancy,purchased_on,purchase_price,market_value,sold_on,sold_price,
     lender,rate,monthly_payment,loan_balance,monthly_rent,tax_year,insurance_year,notes,sort)
  VALUES
    (@name,@kind,@status,@occupancy,@purchased_on,@purchase_price,@market_value,@sold_on,
     @sold_price,@lender,@rate,@monthly_payment,@loan_balance,@monthly_rent,@tax_year,
     @insurance_year,@notes,@sort)
  ON CONFLICT(name) DO UPDATE SET
    kind=excluded.kind, occupancy=excluded.occupancy, market_value=excluded.market_value,
    lender=excluded.lender, rate=excluded.rate, monthly_payment=excluded.monthly_payment,
    loan_balance=excluded.loan_balance, monthly_rent=excluded.monthly_rent,
    notes=COALESCE(excluded.notes, properties.notes)
`);

PROPERTIES.forEach((p, i) =>
  up.run({
    status: 'owned', occupancy: 'unknown', purchased_on: null, purchase_price: null,
    market_value: null, sold_on: null, sold_price: null, lender: null, rate: null,
    monthly_payment: null, loan_balance: null, monthly_rent: null, tax_year: null,
    insurance_year: null, notes: null, sort: i, ...p,
  })
);

const id = Object.fromEntries(
  d.prepare('SELECT id,name FROM properties').all().map((r) => [r.name, r.id])
);

const PAYERS = [
  // rent side: who deposits money
  ['Mantoloking property A (rent $2,600)', 'Mantoloking', 'rent', 'Manager covers two properties'],
  ['Mantoloking property B (rent $2,500)', 'Mantoloking', 'rent', 'Manager covers two properties'],
  ['Wrightdavis property', 'Wrightdavis', 'rent', 'Management changing; expect a new name'],
  // mortgage side: who takes money out. Confirmed from the servicer statements.
  ['293 Coles Way, Lakewood NJ', 'Santander', 'mortgage', 'Personal residence'],
  ['16717 Delia St, Wimauma FL', 'Lakeview', 'mortgage', null],
  ['12 Maple St', 'Pennymac', 'mortgage', null],
  ['987 Grace', 'Rushmore', 'mortgage', null],
  ['9514 Princess St', 'Shellpoin', 'mortgage', 'Also appears as NewRez'],
  ['9514 Princess St', 'Newrez', 'mortgage', 'ShellPoint trades as NewRez'],
];
const upP = d.prepare(
  `INSERT INTO property_payers(property_id,match_text,kind,note) VALUES(?,?,?,?)`
);
d.prepare('DELETE FROM property_payers').run();
for (const [prop, match, kind, note] of PAYERS) {
  if (id[prop]) upP.run(id[prop], match, kind, note);
}

console.log(`properties: ${PROPERTIES.length}`);
console.log(`payer links: ${PAYERS.length}`);
console.log('\nForward monthly rent, by occupancy:');
for (const r of d
  .prepare(
    `SELECT occupancy, COUNT(*) n, COALESCE(SUM(monthly_rent),0) rent
       FROM properties WHERE kind='rental' GROUP BY occupancy ORDER BY rent DESC`
  )
  .all()) {
  console.log(`  ${r.occupancy.padEnd(10)} ${String(r.n).padStart(2)} properties  $${r.rent.toLocaleString()}/mo`);
}
