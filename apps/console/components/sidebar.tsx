'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV: { href: string; label: string; hint: string }[] = [
  { href: '/', label: 'Dashboard', hint: 'Fund overview' },
  { href: '/review-queue', label: 'Review Queue', hint: 'AI proposals' },
  { href: '/capital-calls', label: 'Capital Calls', hint: 'Calls & checks' },
  { href: '/nav', label: 'NAV', hint: 'Net asset value' },
  { href: '/reconciliation', label: 'Reconciliation', hint: 'Three-way match' },
  { href: '/portfolio', label: 'Portfolio', hint: 'Positions' },
];

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-ink-800 bg-ink-950 text-slate-300">
      <div className="border-b border-ink-800 px-5 py-5">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-accent-600 text-sm font-bold text-white">
            GP
          </span>
          <div className="leading-tight">
            <div className="text-sm font-semibold text-white">Gramercy Park</div>
            <div className="text-[11px] text-slate-400">GP Console</div>
          </div>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-4">
        {NAV.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`group flex flex-col rounded-lg px-3 py-2 transition-colors ${
                active
                  ? 'bg-ink-800 text-white'
                  : 'text-slate-300 hover:bg-ink-900 hover:text-white'
              }`}
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    active ? 'bg-accent-400' : 'bg-slate-600 group-hover:bg-slate-400'
                  }`}
                />
                {item.label}
              </span>
              <span className="ml-3.5 text-[11px] text-slate-500">{item.hint}</span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-ink-800 px-5 py-4">
        <div className="rounded-lg bg-ink-900 px-3 py-3">
          <div className="text-[11px] font-medium uppercase tracking-wide text-accent-400">
            Operating principle
          </div>
          <div className="mt-1 text-xs leading-relaxed text-slate-300">
            AI prepares. Expert accountants review.
          </div>
        </div>
      </div>
    </aside>
  );
}
