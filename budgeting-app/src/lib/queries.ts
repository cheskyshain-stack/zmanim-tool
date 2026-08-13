import { db } from './db';

export type Row = Record<string, unknown>;

export const money = (n: number) =>
  (n < 0 ? '-' : '') +
  '$' +
  Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

/** Latest date we hold, so "this month" means something even on stale data. */
export function latestDate(): string {
  const r = db().prepare('SELECT MAX(posted_date) d FROM transactions').get() as { d: string };
  return r?.d ?? new Date().toISOString().slice(0, 10);
}

export function monthsBack(n: number): string {
  const d = new Date(latestDate() + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * Headline numbers. Transfers are excluded everywhere, which is the whole point:
 * moving money between your own accounts is not income and not spending.
 */
export function summary(from: string, to: string) {
  const base = `FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE t.posted_date BETWEEN ? AND ? AND t.is_transfer = 0`;

  const income = (db()
    .prepare(`SELECT COALESCE(SUM(t.amount),0) v ${base} AND t.amount > 0 AND (c.kind IS NULL OR c.kind != 'transfer')`)
    .get(from, to) as { v: number }).v;

  const spend = (db()
    .prepare(`SELECT COALESCE(SUM(-t.amount),0) v ${base} AND t.amount < 0`)
    .get(from, to) as { v: number }).v;

  const byKind = db()
    .prepare(
      `SELECT COALESCE(c.kind,'uncategorised') kind, COALESCE(SUM(-t.amount),0) v
         ${base} AND t.amount < 0
        GROUP BY COALESCE(c.kind,'uncategorised')`
    )
    .all(from, to) as Array<{ kind: string; v: number }>;

  return { income, spend, net: income - spend, byKind };
}

export function topCategories(from: string, to: string, limit = 12) {
  return db()
    .prepare(
      `SELECT COALESCE(c.name,'Uncategorised') name, COALESCE(c.kind,'uncategorised') kind,
              SUM(-t.amount) v, COUNT(*) n
         FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
        WHERE t.posted_date BETWEEN ? AND ? AND t.is_transfer = 0 AND t.amount < 0
        GROUP BY 1,2 ORDER BY v DESC LIMIT ?`
    )
    .all(from, to, limit) as Array<{ name: string; kind: string; v: number; n: number }>;
}

export function reviewQueue(limit = 100) {
  return db()
    .prepare(
      `SELECT t.id, t.posted_date, t.amount, t.raw_description,
              a.name account, c.name category
         FROM transactions t
         LEFT JOIN accounts a ON a.id = t.account_id
         LEFT JOIN categories c ON c.id = t.category_id
        WHERE t.needs_review = 1
        ORDER BY ABS(t.amount) DESC LIMIT ?`
    )
    .all(limit) as Array<{
    id: number; posted_date: string; amount: number;
    raw_description: string; account: string | null; category: string | null;
  }>;
}

export function reviewCount(): number {
  return (db().prepare('SELECT COUNT(*) n FROM transactions WHERE needs_review=1')
    .get() as { n: number }).n;
}

export function listTransactions(opts: {
  q?: string; category?: string; limit?: number; offset?: number;
}) {
  const where: string[] = ['1=1'];
  const args: unknown[] = [];
  if (opts.q) { where.push('t.raw_description LIKE ?'); args.push(`%${opts.q}%`); }
  if (opts.category === '__none__') where.push('t.category_id IS NULL');
  else if (opts.category) { where.push('c.name = ?'); args.push(opts.category); }

  const sql = `SELECT t.id, t.posted_date, t.amount, t.raw_description, t.is_transfer,
                      t.needs_review, a.name account, c.name category, c.kind kind
                 FROM transactions t
                 LEFT JOIN accounts a ON a.id = t.account_id
                 LEFT JOIN categories c ON c.id = t.category_id
                WHERE ${where.join(' AND ')}
                ORDER BY t.posted_date DESC, t.id DESC
                LIMIT ? OFFSET ?`;
  return db().prepare(sql).all(...args, opts.limit ?? 100, opts.offset ?? 0) as Array<{
    id: number; posted_date: string; amount: number; raw_description: string;
    is_transfer: number; needs_review: number;
    account: string | null; category: string | null; kind: string | null;
  }>;
}

export function allCategories() {
  return db()
    .prepare('SELECT id,name,kind,parent FROM categories ORDER BY parent, name')
    .all() as Array<{ id: number; name: string; kind: string; parent: string | null }>;
}

/** Business versus personal, the split the spreadsheet could not do. */
export function byEntity(from: string, to: string) {
  return db()
    .prepare(
      `SELECT e.name entity,
              COALESCE(SUM(CASE WHEN t.amount>0 THEN t.amount END),0) inflow,
              COALESCE(SUM(CASE WHEN t.amount<0 THEN -t.amount END),0) outflow
         FROM transactions t JOIN entities e ON e.id=t.entity_id
        WHERE t.posted_date BETWEEN ? AND ? AND t.is_transfer=0
        GROUP BY e.name ORDER BY inflow DESC`
    )
    .all(from, to) as Array<{ entity: string; inflow: number; outflow: number }>;
}
