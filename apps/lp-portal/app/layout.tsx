import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { Nav } from '../components/Nav';
import { fund, lp } from '../lib/seed';

export const metadata: Metadata = {
  title: 'Gramercy Park — Investor Portal',
  description:
    'Limited partner investor portal for Gramercy Park Capital — capital accounts, calls, distributions, and reporting.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="border-b border-white/10 bg-ink-900 text-parchment">
          <div className="mx-auto max-w-6xl px-6">
            <div className="flex flex-col gap-4 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-md bg-gold-500/15 font-serif text-lg font-semibold text-gold-400 ring-1 ring-inset ring-gold-500/30">
                  GP
                </span>
                <div className="leading-tight">
                  <p className="font-serif text-[1.05rem] font-semibold tracking-tight">
                    Gramercy Park
                  </p>
                  <p className="text-[0.7rem] uppercase tracking-label text-parchment-300/70">
                    Investor Portal
                  </p>
                </div>
              </div>
              <div className="text-left sm:text-right">
                <p className="text-sm font-medium text-parchment">{lp.name}</p>
                <p className="text-xs text-parchment-300/70">{fund.name}</p>
              </div>
            </div>
            <div className="border-t border-white/10 py-2">
              <Nav />
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-6 py-10">{children}</main>

        <footer className="mt-8 border-t border-parchment-200 bg-white/40">
          <div className="mx-auto max-w-6xl px-6 py-6 text-xs leading-relaxed text-ink-700/60">
            <p className="font-medium text-ink-700/80">
              Gramercy Park — AI-native fund administration.
            </p>
            <p className="mt-1 max-w-3xl">
              This portal is an educational study built on entirely synthetic data. Figures are
              generated from the open-source Gramercy Park fund-administration engine and do not
              represent any real fund, security, offer, or investment advice.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
