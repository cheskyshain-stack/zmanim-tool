import { redirect } from 'next/navigation';
import { checkPassword, createSession, isAuthed } from '@/lib/auth';

export const dynamic = 'force-dynamic';

async function login(formData: FormData) {
  'use server';
  const pw = String(formData.get('password') ?? '');
  if (!checkPassword(pw)) redirect('/login?e=1');
  await createSession();
  redirect('/');
}

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ e?: string }>;
}) {
  if (await isAuthed()) redirect('/');
  const { e } = await searchParams;
  return (
    <div className="mx-auto mt-24 max-w-sm">
      <h1 className="text-xl font-semibold">Sign in</h1>
      <p className="mt-1 text-sm text-slate-400">This is a private site.</p>
      <form action={login} className="mt-6 space-y-3">
        <input
          name="password"
          type="password"
          autoFocus
          autoComplete="current-password"
          placeholder="Password"
          className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 outline-none focus:border-slate-500"
        />
        {e && <p className="text-sm text-rose-400">That password did not work.</p>}
        <button className="w-full rounded-xl bg-slate-100 px-4 py-3 font-medium text-slate-900 hover:bg-white">
          Sign in
        </button>
      </form>
    </div>
  );
}
