import Decimal from 'decimal.js';

declare const MONEY_BRAND: unique symbol;

/**
 * Money is stored as an integer number of **minor units** (e.g. cents) plus a
 * currency tag. We never use floating point for monetary amounts. Ratios and
 * weights use `decimal.js`; allocation uses the largest-remainder method so the
 * parts always sum back to the whole — no cent is ever created or destroyed.
 *
 * The type is **branded**: the only way to obtain a `Money` is via `money()`
 * (or the operations below, which all funnel through it), so the amount/currency
 * invariants cannot be bypassed with an object literal.
 */
export interface Money {
  /** Integer count of minor units (cents). May be negative. Always a safe integer. */
  readonly amount: number;
  /** ISO-4217-style currency code, e.g. "USD". */
  readonly currency: string;
  /** Phantom brand — not present at runtime; blocks structural construction. */
  readonly [MONEY_BRAND]: true;
}

export function money(amount: number, currency: string): Money {
  // `Number.isInteger` is not enough: 2**53 is an "integer" but arithmetic on it
  // silently loses precision. A ledger must never lose a cent, so we require a
  // *safe* integer and reject (rather than silently corrupt) anything past it.
  if (!Number.isSafeInteger(amount)) {
    throw new Error(
      `Money.amount must be a safe integer number of minor units, got ${amount}. ` +
        `Values beyond ±(2^53 - 1) minor units are rejected to prevent precision loss.`,
    );
  }
  if (!currency) throw new Error('Money.currency is required');
  return { amount, currency } as Money;
}

export const zero = (currency: string): Money => money(0, currency);

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new Error(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  }
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amount + b.amount, a.currency);
}

export function sub(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amount - b.amount, a.currency);
}

export const negate = (a: Money): Money => money(-a.amount, a.currency);

export const isZero = (a: Money): boolean => a.amount === 0;
export const isNegative = (a: Money): boolean => a.amount < 0;
export const isPositive = (a: Money): boolean => a.amount > 0;

/** -1 if a<b, 0 if equal, 1 if a>b. Throws on currency mismatch. */
export function compare(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  return a.amount < b.amount ? -1 : a.amount > b.amount ? 1 : 0;
}

export const equals = (a: Money, b: Money): boolean =>
  a.currency === b.currency && a.amount === b.amount;

/** Sum a list of same-currency Money values. Requires a currency for the empty case. */
export function sumMoney(items: readonly Money[], currency: string): Money {
  let total = 0;
  for (const m of items) {
    if (m.currency !== currency) {
      throw new Error(`Currency mismatch in sumMoney: expected ${currency}, got ${m.currency}`);
    }
    total += m.amount;
  }
  return money(total, currency);
}

/**
 * Allocate `total` across buckets in proportion to `weights` using the
 * largest-remainder method. Guarantees the returned parts sum EXACTLY to
 * `total` (currency preserved). Deterministic tie-break: when two buckets have
 * equal fractional remainders, the lower index receives the extra unit first.
 *
 * - `weights` must be non-negative and not all zero. Accepts `Decimal.Value`
 *   (number | string | Decimal) so callers can pass exact weights (e.g. bps as
 *   strings) and avoid JS float precision affecting the tie-break.
 * - `total` may be negative; the sign is preserved and the magnitude allocated.
 */
export function allocate(total: Money, weights: readonly Decimal.Value[]): Money[] {
  if (weights.length === 0) throw new Error('allocate requires at least one weight');

  const decWeights = weights.map((w, i) => {
    const d = new Decimal(w);
    if (d.isNegative() || !d.isFinite()) {
      throw new Error(`allocate weights must be finite and non-negative; weights[${i}] = ${w}`);
    }
    return d;
  });

  const weightSum = decWeights.reduce((acc, w) => acc.plus(w), new Decimal(0));
  if (weightSum.isZero()) throw new Error('allocate requires weights that are not all zero');

  const sign = total.amount < 0 ? -1 : 1;
  const magnitude = Math.abs(total.amount);

  // Exact proportional share as a Decimal, then split into floor + fractional remainder.
  const bases: number[] = [];
  const remainders: Decimal[] = [];
  let allocated = 0;
  for (let i = 0; i < decWeights.length; i++) {
    const exact = new Decimal(magnitude).times(decWeights[i]!).dividedBy(weightSum);
    const base = exact.floor();
    bases.push(base.toNumber());
    remainders.push(exact.minus(base));
    allocated += base.toNumber();
  }

  let leftover = magnitude - allocated; // number of 1-minor-unit crumbs still to hand out

  // Hand out leftover units to the largest remainders, ties broken by lowest index.
  const order = remainders
    .map((rem, i) => ({ i, rem }))
    .sort((a, b) => {
      const c = b.rem.comparedTo(a.rem);
      return c !== 0 ? c : a.i - b.i;
    });

  for (const { i } of order) {
    if (leftover <= 0) break;
    bases[i] = bases[i]! + 1;
    leftover--;
  }

  return bases.map((amt) => money(sign * amt, total.currency));
}

/** Allocate `total` evenly across `n` buckets (largest-remainder). */
export function allocateEven(total: Money, n: number): Money[] {
  if (!Number.isInteger(n) || n <= 0) throw new Error(`allocateEven requires n > 0, got ${n}`);
  return allocate(total, new Array(n).fill(1));
}

/** Basis-points helper: apply `bps` (e.g. 200 = 2.00%) to a Money, rounding half-up. */
export function applyBps(base: Money, bps: Decimal.Value): Money {
  const b = new Decimal(bps);
  if (!b.isFinite()) throw new Error(`applyBps requires a finite bps, got ${bps}`);
  const result = new Decimal(base.amount).times(b).dividedBy(10_000);
  // money() enforces the safe-integer bound on the rounded result.
  return money(result.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber(), base.currency);
}
