import { redirect } from 'next/navigation';
import { isAuthed } from '@/lib/auth';
import { db } from '@/lib/db';
import { money } from '@/lib/queries';
import { saveProperty, addPayer, removePayer } from '../actions';

export const dynamic = 'force-dynamic';

type Prop = {
  id: number; name: string; kind: string; status: string; occupancy: string;
  purchased_on: string | null; purchase_price: number | null; market_value: number | null;
  sold_on: string | null; sold_price: number | null; lender: string | null;
  rate: number | null; monthly_payment: number | null; loan_balance: number | null;
  monthly_rent: number | null; tax_year: number | null; insurance_year: number | null;
  notes: string | null;
};

const OCCUPANCY = ['occupied', 'vacant', 'eviction', 'unknown', 'n/a'];
const STATUS = ['owned', 'under_contract', 'sold'];

const TONE: Record<string, string> = {
  occupied: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  vacant: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  eviction: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  unknown: 'bg-slate-700/40 text-slate-300 border-slate-600',
  'n/a': 'bg-slate-700/40 text-slate-400 border-slate-600',
};

function Field({ label, name, value, type = 'text', step, w = '' }: {
  label: string; name: string; value: string | number | null;
  type?: string; step?: string; w?: string;
}) {
  return (
    <label className={`block ${w}`}>
      <span className="mb-1 block text-[10px] uppercase tracking-wider text-slate-500">{label}</span>
      <input
        name={name} type={type} step={step} defaultValue={value ?? ''}
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm outline-none focus:border-slate-500"
      />
    </label>
  );
}

export default async function Properties() {
  if (!(await isAuthed())) redirect('/login');
  const d = db();
  const props = d.prepare('SELECT * FROM properties ORDER BY sort, name').all() as Prop[];
  const payers = d
    .prepare('SELECT * FROM property_payers ORDER BY id')
    .all() as Array<{ id: number; property_id: number; match_text: string; note: string | null }>;

  const rentals = props.filter((p) => p.kind === 'rental');
  const forwardRent = rentals
    .filter((p) => p.occupancy === 'occupied')
    .reduce((a, b) => a + (b.monthly_rent ?? 0), 0);
  const atRisk = rentals
    .filter((p) => ['vacant', 'eviction'].includes(p.occupancy))
    .reduce((a, b) => a + (b.monthly_rent ?? 0), 0);
  const debtService = rentals.reduce((a, b) => a + (b.monthly_payment ?? 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Properties</h1>
        <p className="text-sm text-slate-400">
          The register that links a bank deposit to a property. Fill in{' '}
          <span className="text-slate-200">rent payer</span> and every future deposit
          attributes itself.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          ['Rent coming in', money(forwardRent), 'occupied only', 'text-emerald-400'],
          ['Rent not coming in', money(atRisk), 'vacant or eviction', 'text-rose-400'],
          ['Mortgage payments', money(debtService), 'due regardless', ''],
        ].map(([l, v, s, c]) => (
          <div key={l} className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
            <div className="text-xs uppercase tracking-wider text-slate-400">{l}</div>
            <div className={`mt-1 text-2xl font-semibold tabular-nums ${c}`}>{v}</div>
            <div className="text-xs text-slate-500">per month, {s}</div>
          </div>
        ))}
      </div>

      {forwardRent - debtService < 0 && (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm">
          <span className="font-medium text-rose-300">
            Rent coming in is {money(debtService - forwardRent)} short of the mortgage payments each month.
          </span>{' '}
          <span className="text-rose-200/70">
            That gap is funded from household cash until the vacant and non-paying units resolve.
          </span>
        </div>
      )}

      {props.map((p) => {
        const mine = payers.filter((x) => x.property_id === p.id);
        return (
          <div key={p.id} className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 className="font-medium">{p.name}</h2>
              <span className={`rounded-full border px-2 py-0.5 text-xs ${TONE[p.occupancy] ?? TONE.unknown}`}>
                {p.occupancy}
              </span>
              {p.status !== 'owned' && (
                <span className="rounded-full border border-slate-600 bg-slate-700/40 px-2 py-0.5 text-xs text-slate-300">
                  {p.status.replace('_', ' ')}
                </span>
              )}
              {p.kind === 'residence' && (
                <span className="text-xs text-slate-500">residence</span>
              )}
            </div>

            <form action={saveProperty} className="space-y-3">
              <input type="hidden" name="id" value={p.id} />
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                <label className="block">
                  <span className="mb-1 block text-[10px] uppercase tracking-wider text-slate-500">Occupancy</span>
                  <select name="occupancy" defaultValue={p.occupancy}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm">
                    {OCCUPANCY.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] uppercase tracking-wider text-slate-500">Status</span>
                  <select name="status" defaultValue={p.status}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm">
                    {STATUS.map((o) => <option key={o} value={o}>{o.replace('_', ' ')}</option>)}
                  </select>
                </label>
                <Field label="Purchased" name="purchased_on" value={p.purchased_on} type="date" />
                <Field label="Purchase price" name="purchase_price" value={p.purchase_price} type="number" step="0.01" />
                <Field label="Market value" name="market_value" value={p.market_value} type="number" step="0.01" />
                <Field label="Monthly rent" name="monthly_rent" value={p.monthly_rent} type="number" step="0.01" />
                <Field label="Lender" name="lender" value={p.lender} />
                <Field label="Rate" name="rate" value={p.rate} type="number" step="0.00001" />
                <Field label="Monthly payment" name="monthly_payment" value={p.monthly_payment} type="number" step="0.01" />
                <Field label="Loan balance" name="loan_balance" value={p.loan_balance} type="number" step="0.01" />
                <Field label="Tax / yr" name="tax_year" value={p.tax_year} type="number" step="0.01" />
                <Field label="Insurance / yr" name="insurance_year" value={p.insurance_year} type="number" step="0.01" />
                <Field label="Sold date" name="sold_on" value={p.sold_on} type="date" />
                <Field label="Sold price" name="sold_price" value={p.sold_price} type="number" step="0.01" />
                <Field label="Notes" name="notes" value={p.notes} w="col-span-2 sm:col-span-4 lg:col-span-4" />
              </div>
              <button className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-900 hover:bg-white">
                Save
              </button>
            </form>

            <div className="mt-4 border-t border-slate-800 pt-3">
              <div className="mb-2 text-[10px] uppercase tracking-wider text-slate-500">
                Rent payer names on the bank feed
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {mine.map((x) => (
                  <span key={x.id} className="flex items-center gap-1 rounded-full border border-slate-700 bg-slate-800 px-2 py-1 text-xs">
                    {x.match_text}
                    <form action={removePayer}>
                      <input type="hidden" name="id" value={x.id} />
                      <button className="text-slate-500 hover:text-rose-400" title="remove">&times;</button>
                    </form>
                  </span>
                ))}
                <form action={addPayer} className="flex items-center gap-1">
                  <input type="hidden" name="propertyId" value={p.id} />
                  <input name="matchText" placeholder="e.g. Mantoloking"
                    className="w-40 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs outline-none focus:border-slate-500" />
                  <button className="rounded-lg border border-slate-700 px-2 py-1 text-xs hover:bg-slate-800">add</button>
                </form>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
