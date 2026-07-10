import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { Sidebar } from '@/components/sidebar';
import { fund } from '@/lib/seed';
import { formatDate } from '@/lib/format';

export const metadata: Metadata = {
  title: 'Gramercy Park — GP Console',
  description:
    'AI-native fund administration console for general partners. Educational study on synthetic data.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="flex min-h-screen">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white/90 px-8 py-4 backdrop-blur">
              <div>
                <div className="text-sm font-semibold text-slate-900">
                  Gramercy Park — GP Console
                </div>
                <div className="text-xs text-slate-500">
                  {fund.name} · Vintage {fund.vintage}
                </div>
              </div>
              <div className="hidden text-right sm:block">
                <div className="text-xs font-medium text-slate-500">As of</div>
                <div className="tnum text-sm font-semibold text-slate-800">
                  {formatDate(fund.asOf)}
                </div>
              </div>
            </header>

            <main className="flex-1 px-8 py-8">
              <div className="mx-auto max-w-6xl">{children}</div>
            </main>

            <footer className="border-t border-slate-200 bg-white px-8 py-5">
              <p className="mx-auto max-w-6xl text-xs leading-relaxed text-slate-400">
                Educational open-source study of the AI-native fund-administration category,
                inspired by Hanover Park. All figures are synthetic and computed by the
                deterministic engine in this repository — not real fund data, not accounting advice,
                and not affiliated with any company.
              </p>
            </footer>
          </div>
        </div>
      </body>
    </html>
  );
}
