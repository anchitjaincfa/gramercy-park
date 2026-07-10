import type { ReactNode } from 'react';

/** Page title block used at the top of every route. */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-col gap-3 border-b border-slate-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle ? <p className="mt-1 max-w-2xl text-sm text-slate-500">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** A bordered content card. */
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>
      {children}
    </div>
  );
}

export function CardHeader({ title, meta }: { title: string; meta?: ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
      <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
      {meta ? <div className="text-xs text-slate-400">{meta}</div> : null}
    </div>
  );
}

/** KPI stat tile. */
export function StatTile({
  label,
  value,
  sub,
  accent = false,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div
        className={`tnum mt-2 text-2xl font-semibold tracking-tight ${
          accent ? 'text-accent-700' : 'text-slate-900'
        }`}
      >
        {value}
      </div>
      {sub ? <div className="mt-1 text-xs text-slate-500">{sub}</div> : null}
    </div>
  );
}

type Tone = 'pass' | 'warn' | 'fail' | 'neutral' | 'accent' | 'info';

const toneClasses: Record<Tone, string> = {
  pass: 'bg-accent-50 text-accent-700 ring-1 ring-inset ring-accent-200',
  warn: 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200',
  fail: 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200',
  neutral: 'bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200',
  accent: 'bg-accent-600 text-white',
  info: 'bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-200',
};

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${toneClasses[tone]}`}
    >
      {children}
    </span>
  );
}

/** Horizontal-scroll wrapper so wide tables never break the page layout. */
export function TableScroll({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto">{children}</div>;
}
