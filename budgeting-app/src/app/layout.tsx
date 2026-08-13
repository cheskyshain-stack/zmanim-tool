import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Budget',
  description: 'Personal and business budgeting',
};

const NAV = [
  { href: '/', label: 'Dashboard' },
  { href: '/transactions', label: 'Transactions' },
  { href: '/properties', label: 'Properties' },
  { href: '/review', label: 'Review' },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-950 text-slate-100 antialiased">
        <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur sticky top-0 z-10">
          <nav className="mx-auto flex max-w-6xl items-center gap-1 px-4 py-3">
            <span className="mr-4 font-semibold tracking-tight">Budget</span>
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className="rounded-lg px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800 hover:text-white"
              >
                {n.label}
              </Link>
            ))}
            <form action="/api/logout" method="post" className="ml-auto">
              <button className="rounded-lg px-3 py-1.5 text-sm text-slate-400 hover:text-white">
                Sign out
              </button>
            </form>
          </nav>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
