import { redirect } from 'next/navigation';
import Link from 'next/link';
import { isAuthed } from '@/lib/auth';
import {
  summary, topCategories, latestDate, monthsBack, reviewCount, byEntity, money,
} from '@/lib/queries';

export const dynamic = 'force-dynamic';

const KIND_LABEL: Record<string, string> = {
  fixed: 'Fixed', variable: 'Variable', savings: 'Savings',
  one_time: 'One-time', uncategorised: 'Uncategorised', review: 'Needs review',
  income: 'Income', transfer: 'Transfer',
};

function Card({ label, value, sub, tone }: {
  label: string; value: string; sub?: string; tone?: 'good' | 'bad';
}) {
  const color = tone === 'good' ? 'text-emerald-400' : tone === 'bad' ? 'text-rose-400' : '';
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
      <div className="text-xs uppercase tracking-wider text-slate-400">{label}</div>
      <div className={`mt-2 text-3xl font-semibold tabular-nums ${color}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

export default async function Dashboard() {
  if (!(await isAuthed())) redirect('/login');

  const to = latestDate();
  const from = monthsBack(12);
  const s = summary(from, to);
  const cats = topCategories(from, to);
  const ents = byEntity(from, to);
  const needs = reviewCount();

  const spendKinds = s.byKind.filter((k) => !['income', 'transfer'].includes(k.kind));
  const totalSpend = spendKinds.reduce((a, b) => a + b.v, 0) || 1;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Last 12 months</h1>
        <p className="text-sm text-slate-400">
          {from} to {to}. Transfers between your own accounts are excluded.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card label="Money in" value={money(s.income)} />
        <Card label="Money out" value={money(s.spend)} />
        <Card
          label="Surplus"
          value={money(s.net)}
          tone={s.net >= 0 ? 'good' : 'bad'}
          sub={s.income ? `${((s.net / s.income) * 100).toFixed(1)}% of income` : undefined}
        />
      </div>

      {needs > 0 && (
        <Link
          href="/review"
          className="block rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 hover:bg-amber-500/15"
        >
          <span className="font-medium text-amber-300">{needs} transactions need review</span>
          <span className="ml-2 text-sm text-amber-200/70">
            Categorise them so the numbers above are trustworthy.
          </span>
        </Link>
      )}

      <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
        <h2 className="mb-4 font-medium">Where it goes</h2>
        <div className="space-y-3">
          {spendKinds.sort((a, b) => b.v - a.v).map((k) => (
            <div key={k.kind}>
              <div className="mb-1 flex justify-between text-sm">
                <span className="text-slate-300">{KIND_LABEL[k.kind] ?? k.kind}</span>
                <span className="tabular-nums text-slate-400">
                  {money(k.v)} · {((k.v / totalSpend) * 100).toFixed(0)}%
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                <div
                  className={`h-full ${
                    k.kind === 'fixed' ? 'bg-blue-500'
                    : k.kind === 'variable' ? 'bg-amber-500'
                    : k.kind === 'savings' ? 'bg-emerald-500'
                    : k.kind === 'one_time' ? 'bg-fuchsia-500'
                    : 'bg-slate-600'
                  }`}
                  style={{ width: `${(k.v / totalSpend) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
        <h2 className="mb-4 font-medium">Business and personal</h2>
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wider text-slate-500">
            <tr><th className="text-left font-normal">Entity</th>
              <th className="text-right font-normal">In</th>
              <th className="text-right font-normal">Out</th>
              <th className="text-right font-normal">Net</th></tr>
          </thead>
          <tbody>
            {ents.map((e) => (
              <tr key={e.entity} className="border-t border-slate-800">
                <td className="py-2">{e.entity}</td>
                <td className="py-2 text-right tabular-nums">{money(e.inflow)}</td>
                <td className="py-2 text-right tabular-nums">{money(e.outflow)}</td>
                <td className={`py-2 text-right tabular-nums ${
                  e.inflow - e.outflow >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {money(e.inflow - e.outflow)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
        <h2 className="mb-4 font-medium">Biggest categories</h2>
        <table className="w-full text-sm">
          <tbody>
            {cats.map((c) => (
              <tr key={c.name} className="border-t border-slate-800 first:border-0">
                <td className="py-2">
                  <Link className="hover:underline" href={`/transactions?category=${encodeURIComponent(c.name)}`}>
                    {c.name}
                  </Link>
                  <span className="ml-2 text-xs text-slate-500">{KIND_LABEL[c.kind] ?? c.kind}</span>
                </td>
                <td className="py-2 text-right text-xs text-slate-500">{c.n}</td>
                <td className="py-2 text-right tabular-nums">{money(c.v)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
