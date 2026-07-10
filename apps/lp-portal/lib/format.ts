/**
 * Presentation helpers for the LP portal. All monetary values in the domain and
 * engine are integer *minor units* (cents); these render them for humans without
 * ever reintroducing floating-point money into calculations.
 */

/** Render integer minor units (cents) as a USD string, e.g. 850000000 -> "$8,500,000.00". */
export function formatUSD(minor: number, opts: { cents?: boolean } = {}): string {
  const showCents = opts.cents ?? true;
  const negative = minor < 0;
  const abs = Math.abs(minor);
  const dollars = abs / 100;
  const body = dollars.toLocaleString('en-US', {
    minimumFractionDigits: showCents ? 2 : 0,
    maximumFractionDigits: showCents ? 2 : 0,
  });
  return `${negative ? '−' : ''}$${body}`;
}

/** Compact USD for stat tiles, e.g. 850000000 -> "$8.50M". */
export function formatUSDCompact(minor: number): string {
  const negative = minor < 0;
  const dollars = Math.abs(minor) / 100;
  let body: string;
  if (dollars >= 1_000_000) body = `${(dollars / 1_000_000).toFixed(2)}M`;
  else if (dollars >= 1_000) body = `${(dollars / 1_000).toFixed(1)}K`;
  else body = dollars.toFixed(0);
  return `${negative ? '−' : ''}$${body}`;
}

/** Render a signed amount with an explicit leading sign (for ledger movements). */
export function formatSignedUSD(minor: number): string {
  if (minor === 0) return formatUSD(0);
  const sign = minor > 0 ? '+' : '−';
  return `${sign}${formatUSD(Math.abs(minor))}`;
}

/** Multiplier like DPI / TVPI, e.g. 1.135 -> "1.14x". */
export function formatMultiple(x: number): string {
  return `${x.toFixed(2)}×`;
}

/** Percent from a 0..1 ratio, e.g. 0.85 -> "85.0%". */
export function formatPercent(ratio: number, digits = 1): string {
  return `${(ratio * 100).toFixed(digits)}%`;
}

/** Basis points to percent, e.g. 200 -> "2.00%". */
export function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

/** ISO date (YYYY-MM-DD) -> "Mar 30, 2023". */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map((n) => parseInt(n, 10));
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return `${months[(m ?? 1) - 1]} ${d}, ${y}`;
}
