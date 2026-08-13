import { redirect } from 'next/navigation';
import { isAuthed } from '@/lib/auth';
import { reviewQueue, allCategories, money } from '@/lib/queries';
import { db } from '@/lib/db';
import { normalizeMerchant } from '@/lib/categorize';
import { setCategory, skipTransaction } from '../actions';

export const dynamic = 'force-dynamic';

/**
 * Suggest the three most likely categories for an unknown merchant.
 *
 * Today this is nearest-merchant plus what similar amounts got categorised as.
 * When the model is wired in, it replaces the body of this function and the
 * interface here does not change.
 */
function suggest(
  txId: number,
  description: string,
  amount: number
): Array<{ id: number; name: string; fromModel?: boolean; reason?: string | null }> {
  const d = db();

  // The model's answer wins when there is one: it saw the whole taxonomy.
  const ai = d
    .prepare(
      `SELECT c.id, c.name, s.confidence, s.reason
         FROM ai_suggestions s JOIN categories c ON c.id = s.category_id
        WHERE s.transaction_id = ? ORDER BY s.rank LIMIT 3`
    )
    .all(txId) as Array<{ id: number; name: string; confidence: number | null; reason: string | null }>;
  if (ai.length) {
    return ai.map((r, i) => ({ id: r.id, name: r.name, fromModel: true, reason: i === 0 ? r.reason : null }));
  }

  const norm = normalizeMerchant(description);
  const first = norm.split(' ')[0];
  const out = new Map<number, string>();

  if (first && first.length > 2) {
    const near = d
      .prepare(
        `SELECT c.id, c.name, SUM(m.seen_count) n
           FROM merchants m JOIN categories c ON c.id=m.category_id
          WHERE m.normalized LIKE ?
          GROUP BY c.id ORDER BY n DESC LIMIT 3`
      )
      .all(`${first}%`) as Array<{ id: number; name: string }>;
    near.forEach((r) => out.set(r.id, r.name));
  }

  if (out.size < 3) {
    const lo = Math.abs(amount) * 0.75;
    const hi = Math.abs(amount) * 1.25;
    const common = d
      .prepare(
        `SELECT c.id, c.name, COUNT(*) n
           FROM transactions t JOIN categories c ON c.id=t.category_id
          WHERE ABS(t.amount) BETWEEN ? AND ? AND c.kind NOT IN ('transfer','review')
          GROUP BY c.id ORDER BY n DESC LIMIT 5`
      )
      .all(lo, hi) as Array<{ id: number; name: string }>;
    for (const r of common) {
      if (out.size >= 3) break;
      out.set(r.id, r.name);
    }
  }
  return [...out].slice(0, 3).map(([id, name]) => ({ id, name }));
}

export default async function Review() {
  if (!(await isAuthed())) redirect('/login');
  const rows = reviewQueue(60);
  const cats = allCategories();

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-8 text-center">
        <p className="text-lg font-medium text-emerald-300">Nothing to review.</p>
        <p className="mt-1 text-sm text-emerald-200/70">Every transaction has a category.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Review</h1>
        <p className="text-sm text-slate-400">
          Biggest first. Tap a suggestion, or pick from the full list.
          &ldquo;Always&rdquo; writes a rule so you are never asked again.
        </p>
      </div>

      {rows.map((t) => {
        const sugg = suggest(t.id, t.raw_description, t.amount);
        return (
          <div key={t.id} className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-medium">{t.raw_description}</div>
                <div className="text-xs text-slate-500">
                  {t.posted_date} · {t.account ?? 'unknown account'}
                  {t.category && <> · currently <span className="text-amber-400">{t.category}</span></>}
                </div>
              </div>
              <div className={`tabular-nums text-lg font-semibold ${
                t.amount < 0 ? 'text-slate-100' : 'text-emerald-400'}`}>
                {money(t.amount)}
              </div>
            </div>

            {sugg[0]?.reason && (
              <div className="mt-2 text-xs text-slate-500">
                Model: {sugg[0].reason}
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {sugg.map((s) => (
                <form key={s.id} action={setCategory}>
                  <input type="hidden" name="id" value={t.id} />
                  <input type="hidden" name="categoryId" value={s.id} />
                  <input type="hidden" name="remember" value="on" />
                  <button
                    className={`rounded-full border px-3 py-1.5 text-sm hover:border-slate-500 hover:bg-slate-700 ${
                      s.fromModel
                        ? 'border-sky-700/60 bg-sky-900/30'
                        : 'border-slate-700 bg-slate-800'
                    }`}
                    title={s.fromModel ? 'suggested by the model' : 'suggested from similar transactions'}
                  >
                    {s.name}
                  </button>
                </form>
              ))}

              <form action={setCategory} className="flex items-center gap-2">
                <input type="hidden" name="id" value={t.id} />
                <select
                  name="categoryId"
                  defaultValue=""
                  className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm"
                >
                  <option value="" disabled>Choose…</option>
                  {cats.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.parent ? `${c.parent} · ` : ''}{c.name}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-1 text-xs text-slate-400">
                  <input type="checkbox" name="similar" defaultChecked className="accent-slate-400" />
                  apply to similar
                </label>
                <label className="flex items-center gap-1 text-xs text-slate-400">
                  <input type="checkbox" name="rule" className="accent-slate-400" />
                  always
                </label>
                <button className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-900 hover:bg-white">
                  Save
                </button>
              </form>

              <form action={skipTransaction} className="ml-auto">
                <input type="hidden" name="id" value={t.id} />
                <button className="rounded-lg px-3 py-1.5 text-sm text-slate-500 hover:text-slate-300">
                  Skip
                </button>
              </form>
            </div>
          </div>
        );
      })}
    </div>
  );
}
