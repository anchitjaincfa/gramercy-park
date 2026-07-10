import type { ReactNode } from 'react';

/** Small uppercase section eyebrow. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="eyebrow">{children}</p>;
}

/** Page header block used at the top of each screen. */
export function PageHeader({
  eyebrow,
  title,
  description,
  aside,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  aside?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-col gap-4 border-b border-parchment-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        <h1 className="mt-2 font-serif text-3xl font-semibold tracking-tight text-ink-900 sm:text-4xl">
          {title}
        </h1>
        {description ? (
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-700/80">{description}</p>
        ) : null}
      </div>
      {aside ? <div className="shrink-0">{aside}</div> : null}
    </div>
  );
}

/** A titled panel with a subtle header rule. */
export function Panel({
  title,
  subtitle,
  children,
  actions,
}: {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="panel overflow-hidden">
      {title ? (
        <header className="flex items-center justify-between gap-4 border-b border-parchment-200 px-6 py-4">
          <div>
            <h2 className="font-serif text-lg font-semibold text-ink-900">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-xs text-ink-700/70">{subtitle}</p> : null}
          </div>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

/** A KPI stat tile. */
export function StatTile({
  label,
  value,
  sub,
  accent = false,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
  tone?: 'positive' | 'negative' | 'neutral';
}) {
  const toneClass =
    tone === 'positive' ? 'text-sage-600' : tone === 'negative' ? 'text-red-700' : 'text-ink-900';
  return (
    <div
      className={
        accent ? 'rounded-xl border border-gold-500/30 bg-ink-900 p-5 shadow-card' : 'stat-card'
      }
    >
      <p
        className={
          accent ? 'text-[0.68rem] font-semibold uppercase tracking-label text-gold-400' : 'eyebrow'
        }
      >
        {label}
      </p>
      <p
        className={`tnum mt-3 font-serif text-2xl font-semibold sm:text-[1.7rem] ${
          accent ? 'text-parchment' : toneClass
        }`}
      >
        {value}
      </p>
      {sub ? (
        <p className={`mt-1 text-xs ${accent ? 'text-parchment-300/70' : 'text-ink-700/70'}`}>
          {sub}
        </p>
      ) : null}
    </div>
  );
}

/** A colored status pill. */
export function Pill({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'gold' | 'sage' | 'muted';
}) {
  const map: Record<string, string> = {
    neutral: 'bg-ink-50 text-ink-700 ring-ink-900/10',
    gold: 'bg-gold-500/12 text-gold-700 ring-gold-600/20',
    sage: 'bg-sage-500/12 text-sage-600 ring-sage-600/20',
    muted: 'bg-parchment-200 text-ink-700/70 ring-ink-900/5',
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${map[tone]}`}
    >
      {children}
    </span>
  );
}

/** A labelled progress meter (commitment drawn, etc.). */
export function ProgressBar({
  pct,
  label,
  rightLabel,
}: {
  pct: number;
  label?: string;
  rightLabel?: string;
}) {
  const clamped = Math.max(0, Math.min(1, pct));
  return (
    <div>
      {(label || rightLabel) && (
        <div className="mb-2 flex items-center justify-between text-xs text-ink-700/80">
          <span>{label}</span>
          <span className="tnum font-medium text-ink-900">{rightLabel}</span>
        </div>
      )}
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-parchment-200">
        <div
          className="h-full rounded-full bg-gradient-to-r from-gold-600 to-gold-400"
          style={{ width: `${clamped * 100}%` }}
        />
      </div>
    </div>
  );
}
