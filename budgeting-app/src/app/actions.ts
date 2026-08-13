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
