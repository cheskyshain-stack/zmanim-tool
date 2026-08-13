'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { normalizeMerchant, learn } from '@/lib/categorize';
import { isAuthed } from '@/lib/auth';

async function guard() {
  if (!(await isAuthed())) throw new Error('not authenticated');
}

/**
 * Assign a category to one transaction.
 *
 * `alsoRemember` writes merchant memory so the same merchant is never asked
 * about again. `alsoRule` creates a real rule, which outranks memory and
 * applies to every future transaction from that merchant.
 */
export async function setCategory(formData: FormData) {
  await guard();
  const id = Number(formData.get('id'));
  const categoryId = Number(formData.get('categoryId'));
  const alsoRemember = formData.get('remember') === 'on';
  const alsoRule = formData.get('rule') === 'on';
  const applySimilar = formData.get('similar') === 'on';
  if (!id || !categoryId) return;

  const d = db();
  const tx = d
    .prepare('SELECT id, raw_description FROM transactions WHERE id=?')
    .get(id) as { id: number; raw_description: string } | undefined;
  if (!tx) return;

  const kind = (d.prepare('SELECT kind FROM categories WHERE id=?').get(categoryId) as
    | { kind: string }
    | undefined)?.kind;
  const isTransfer = kind === 'transfer' ? 1 : 0;
  const isOneTime = kind === 'one_time' ? 1 : 0;

  d.prepare(
    `UPDATE transactions
        SET category_id=?, needs_review=0, source='user', confidence=1,
            is_transfer=?, is_one_time=?
      WHERE id=?`
  ).run(categoryId, isTransfer, isOneTime, id);

  d.prepare(
    `INSERT INTO category_events(transaction_id,category_id,source,confidence)
     VALUES(?,?,'user',1)`
  ).run(id, categoryId);

  const norm = normalizeMerchant(tx.raw_description);

  if (alsoRemember || applySimilar || alsoRule) learn(norm, categoryId, tx.raw_description);

  if (applySimilar) {
    // Every other transaction whose normalised merchant matches
    const rows = d
      .prepare('SELECT id, raw_description FROM transactions WHERE needs_review=1 AND id != ?')
      .all(id) as Array<{ id: number; raw_description: string }>;
    const upd = d.prepare(
      `UPDATE transactions SET category_id=?, needs_review=0, source='memory',
              confidence=0.9, is_transfer=?, is_one_time=? WHERE id=?`
    );
    const run = d.transaction(() => {
      for (const r of rows) {
        if (normalizeMerchant(r.raw_description) === norm) {
          upd.run(categoryId, isTransfer, isOneTime, r.id);
        }
      }
    });
    run();
  }

  if (alsoRule) {
    // Use the normalised merchant as the match text: it is the stable part
    const exists = d
      .prepare('SELECT id FROM rules WHERE match_text=? AND category_id=?')
      .get(norm, categoryId);
    if (!exists) {
      d.prepare(
        `INSERT INTO rules(priority,match_text,category_id,set_transfer)
         VALUES(50,?,?,?)`
      ).run(norm, categoryId, isTransfer);
    }
  }

  revalidatePath('/review');
  revalidatePath('/transactions');
  revalidatePath('/');
}

export async function skipTransaction(formData: FormData) {
  await guard();
  const id = Number(formData.get('id'));
  if (!id) return;
  db().prepare('UPDATE transactions SET needs_review=0 WHERE id=?').run(id);
  revalidatePath('/review');
}

/* ------------------------------------------------------------- properties */

const NUM = (v: FormDataEntryValue | null) => {
  const s = String(v ?? '').trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const TXT = (v: FormDataEntryValue | null) => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};

export async function saveProperty(formData: FormData) {
  await guard();
  const id = Number(formData.get('id'));
  if (!id) return;
  db().prepare(
    `UPDATE properties SET
       occupancy=?, status=?, purchased_on=?, purchase_price=?, market_value=?,
       monthly_rent=?, lender=?, rate=?, monthly_payment=?, loan_balance=?,
       tax_year=?, insurance_year=?, sold_on=?, sold_price=?, notes=?
     WHERE id=?`
  ).run(
    String(formData.get('occupancy') ?? 'unknown'),
    String(formData.get('status') ?? 'owned'),
    TXT(formData.get('purchased_on')), NUM(formData.get('purchase_price')),
    NUM(formData.get('market_value')), NUM(formData.get('monthly_rent')),
    TXT(formData.get('lender')), NUM(formData.get('rate')),
    NUM(formData.get('monthly_payment')), NUM(formData.get('loan_balance')),
    NUM(formData.get('tax_year')), NUM(formData.get('insurance_year')),
    TXT(formData.get('sold_on')), NUM(formData.get('sold_price')),
    TXT(formData.get('notes')),
    id
  );
  revalidatePath('/properties');
}

export async function addPayer(formData: FormData) {
  await guard();
  const propertyId = Number(formData.get('propertyId'));
  const matchText = TXT(formData.get('matchText'));
  if (!propertyId || !matchText) return;
  db().prepare(
    'INSERT INTO property_payers(property_id,match_text) VALUES(?,?)'
  ).run(propertyId, matchText);
  revalidatePath('/properties');
}

export async function removePayer(formData: FormData) {
  await guard();
  const id = Number(formData.get('id'));
  if (!id) return;
  db().prepare('DELETE FROM property_payers WHERE id=?').run(id);
  revalidatePath('/properties');
}
