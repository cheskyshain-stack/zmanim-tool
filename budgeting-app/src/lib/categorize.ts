import { db } from './db.ts';

/**
 * Turn a hostile bank descriptor into a stable merchant key.
 *
 *   "SQ *JOES PIZZA 4471 LAKEWOOD NJ"  -> "joes pizza"
 *   "TST* The Coffee-"                 -> "the coffee"
 *   "Amazon.com*RT4XY1234"             -> "amazon.com"
 *
 * This single step does more for accuracy than anything else in the pipeline,
 * and it needs no model at all.
 */
const PROCESSOR_PREFIX =
  /^(sq|tst|sp|pp|paypal|pos|ach|web|tel|in|ls|gilt\s*com|amzn\s*mktp)\s*\*+\s*/i;
const TRAILING_REF = /[\s*#-]*\b[a-z0-9]{6,}\b\s*$/i;
const STATE_SUFFIX =
  /\s+[a-z .'-]+\s+(al|ak|az|ar|ca|co|ct|de|fl|ga|hi|id|il|in|ia|ks|ky|la|me|md|ma|mi|mn|ms|mo|mt|ne|nv|nh|nj|nm|ny|nc|nd|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|vt|va|wa|wv|wi|wy)\s*$/i;

export function normalizeMerchant(raw: string): string {
  let s = (raw || '').trim();
  s = s.replace(PROCESSOR_PREFIX, '');
  s = s.replace(STATE_SUFFIX, '');
  s = s.replace(/\b\d{2}\/\d{2}\b/g, ' ');            // inline dates
  s = s.replace(/\b(web|ppd|ccd|arc|id|pmts?|payment)\s*id:?\b/gi, ' ');
  s = s.replace(TRAILING_REF, '');
  s = s.replace(/[^a-z0-9 .&'-]/gi, ' ');
  s = s.replace(/\s{2,}/g, ' ').trim().toLowerCase();
  return s || (raw || '').trim().toLowerCase();
}

export type Suggestion = { categoryId: number; name: string; confidence: number };

export type Decision = {
  categoryId: number | null;
  source: 'rule' | 'memory' | 'model' | null;
  confidence: number;
  isTransfer: boolean;
  needsReview: boolean;
  alternatives: Suggestion[];
};

/**
 * Stage order matters and is the whole point: the deterministic stages are
 * instant, free, and never change their mind. Only genuinely unknown merchants
 * reach a model call.
 */
export function categorize(tx: {
  description: string;
  amount: number;
  account?: string | null;
}): Decision {
  const d = db();
  const norm = normalizeMerchant(tx.description);
  const empty: Decision = {
    categoryId: null,
    source: null,
    confidence: 0,
    isTransfer: false,
    needsReview: true,
    alternatives: [],
  };

  // --- stage 1: explicit rules, highest priority first
  const rules = d
    .prepare(
      `SELECT * FROM rules WHERE is_active=1 ORDER BY priority ASC, id ASC`
    )
    .all() as Array<{
    match_text: string;
    match_account: string | null;
    min_amount: number | null;
    max_amount: number | null;
    polarity: string | null;
    category_id: number | null;
    set_transfer: number;
  }>;

  const hay = tx.description.toLowerCase();
  const acct = (tx.account ?? '').toLowerCase();
  for (const r of rules) {
    if (!hay.includes(r.match_text.toLowerCase())) continue;
    if (r.match_account && !acct.includes(r.match_account.toLowerCase())) continue;
    if (r.min_amount != null && tx.amount < r.min_amount) continue;
    if (r.max_amount != null && tx.amount > r.max_amount) continue;
    if (r.polarity === 'positive' && tx.amount <= 0) continue;
    if (r.polarity === 'negative' && tx.amount >= 0) continue;
    return {
      categoryId: r.category_id,
      source: 'rule',
      confidence: 1,
      isTransfer: !!r.set_transfer,
      needsReview: false,
      alternatives: [],
    };
  }

  // --- stage 2: memory. Have we categorised this merchant before?
  const mem = d
    .prepare(
      `SELECT m.category_id AS cid, c.name AS name, m.seen_count AS n
         FROM merchants m JOIN categories c ON c.id = m.category_id
        WHERE m.normalized = ? AND m.category_id IS NOT NULL`
    )
    .get(norm) as { cid: number; name: string; n: number } | undefined;

  if (mem) {
    // more sightings means more confidence, capped
    const conf = Math.min(0.99, 0.75 + 0.05 * Math.min(mem.n, 4));
    const isTransfer =
      (d.prepare('SELECT kind FROM categories WHERE id=?').get(mem.cid) as
        | { kind: string }
        | undefined)?.kind === 'transfer';
    return {
      categoryId: mem.cid,
      source: 'memory',
      confidence: conf,
      isTransfer,
      needsReview: false,
      alternatives: [],
    };
  }

  // --- stage 3: unknown merchant. This is what the model is for.
  return empty;
}

/** Record a user decision so the same merchant is never asked about twice. */
export function learn(merchantNormalized: string, categoryId: number, display: string) {
  const d = db();
  d.prepare(
    `INSERT INTO merchants(normalized, display, category_id, seen_count)
     VALUES(?,?,?,1)
     ON CONFLICT(normalized) DO UPDATE SET
       category_id = excluded.category_id,
       seen_count  = merchants.seen_count + 1`
  ).run(merchantNormalized, display, categoryId);
}
