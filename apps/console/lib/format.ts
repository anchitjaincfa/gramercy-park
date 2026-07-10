/**
 * Presentation helpers. All monetary values in this app are integer *minor
 * units* (cents); nothing here does money math — these only format for display.
 */

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const usdCompact = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 2,
});

/** Render integer minor units (cents) as `$1,234.56`. */
export function formatUSD(minor: number): string {
  return usd.format(minor / 100);
}

/** Render integer minor units compactly, e.g. `$24.0M` — for stat tiles. */
export function formatUSDCompact(minor: number): string {
  return usdCompact.format(minor / 100);
}

/** Render basis points (10000 = 100%) as a percentage, e.g. `12.00%`. */
export function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

/** Render a MOIC expressed in basis points (10000 = 1.00x) as `1.30x`. */
export function formatMoic(bps: number): string {
  return `${(bps / 10000).toFixed(2)}x`;
}

/** 0..1 confidence as `92%`. */
export function formatConfidence(c: number): string {
  return `${Math.round(c * 100)}%`;
}

/** Human-friendly ISO date, e.g. `Jun 15, 2026`. */
export function formatDate(iso: string): string {
  const d = new Date(`${iso.split('T')[0]}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}
