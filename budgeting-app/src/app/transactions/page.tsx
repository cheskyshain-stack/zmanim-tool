import { redirect } from 'next/navigation';
import Link from 'next/link';
import { isAuthed } from '@/lib/auth';
import { listTransactions, allCategories, money } from '@/lib/queries';
import { setCategory } from '../actions';

export const dynamic = 'force-dynamic';
const PAGE = 100;

export default async function Transactions({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; page?: string }>;
}) {
  if (!(await isAuthed())) redirect('/login');
  const sp = await searchParams;
  const page = Math.max(0, Number(sp.page ?? 0));
  const rows = listTransactions({
    q: sp.q, category: sp.category, limit: PAGE + 1, offset: page * PAGE,
  });
  const hasMore = rows.length > PAGE;
  const shown = rows.slice(0, PAGE);
  const cats = allCategories();

  const qs = (over: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    if (sp.q) p.set('q', sp.q);
    if (sp.category) p.set('category', sp.category);
    for (const [k, v] of Object.entries(over)) {
      if (v === undefined || v === '') p.delete(k);
      else p.set(k, String(v));
    }
    return `?${p.toString()}`;
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Transactions</h1>

      <form className="flex flex-wrap gap-2" action="/transactions">
        <input
          name="q"
          defaultValue={sp.q ?? ''}
          placeholder="Search description…"
          className="min-w-56 flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-slate-500"
        />
        <select
          name="category"
          defaultValue={sp.category ?? ''}
          className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
        >
          <option value="">All categories</option>
          <option value="__none__">Uncategorised</option>
          {cats.map((c) => (
            <option key={c.id} value={c.name}>{c.name}</option>
          ))}
        </select>
        <button className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-white">
          Filter
        </button>
        {(sp.q || sp.category) && (
          <Link href="/transactions" className="rounded-lg px-3 py-2 text-sm text-slate-400 hover:text-white">
            Clear
          </Link>
        )}
      </form>

      <div className="overflow-hidden rounded-2xl border border-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-slate-900/70 text-xs uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left font-normal">Date</th>
              <th className="px-3 py-2 text-left font-normal">Description</th>
              <th className="px-3 py-2 text-left font-normal">Category</th>
              <th className="px-3 py-2 text-right font-normal">Amount</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((t) => (
              <tr key={t.id} className="border-t border-slate-800 hover:bg-slate-900/40">
                <td className="whitespace-nowrap px-3 py-2 text-slate-400">{t.posted_date}</td>
                <td className="px-3 py-2">
                  <div className="max-w-md truncate">{t.raw_description}</div>
                  <div className="text-xs text-slate-600">{t.account}</div>
                </td>
                <td className="px-3 py-2">
                  <form action={setCategory} className="flex items-center gap-1">
                    <input type="hidden" name="id" value={t.id} />
                    <select
                      name="categoryId"
                      defaultValue={cats.find((c) => c.name === t.category)?.id ?? ''}
                      className={`max-w-48 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm hover:border-slate-700 ${
                        t.is_transfer ? 'text-slate-500' : t.category ? '' : 'text-amber-400'
                      }`}
                    >
                      <option value="">Uncategorised</option>
                      {cats.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                    <button className="rounded px-1.5 py-0.5 text-xs text-slate-500 hover:bg-slate-800 hover:text-white">
                      save
                    </button>
                  </form>
                </td>
                <td className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${
                  t.amount < 0 ? '' : 'text-emerald-400'}`}>
                  {money(t.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-500">
          Showing {page * PAGE + 1} to {page * PAGE + shown.length}
        </span>
        <div className="flex gap-2">
          {page > 0 && (
            <Link href={qs({ page: page - 1 })} className="rounded-lg border border-slate-700 px-3 py-1.5 hover:bg-slate-800">
              Previous
            </Link>
          )}
          {hasMore && (
            <Link href={qs({ page: page + 1 })} className="rounded-lg border border-slate-700 px-3 py-1.5 hover:bg-slate-800">
              Next
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
