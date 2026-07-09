/**
 * Accounting-period gating (Phase 2c, see docs/ARCHITECTURE.md §3.3).
 *
 * A posting into a CLOSED accounting period is rejected; open and reopened
 * periods are postable. A period is a calendar month `YYYY-MM` scoped per
 * entity. These helpers are pure and deterministic — no I/O, no mutation —
 * and mirror the strict date-parsing rigor of `toEpochDay` in `checks.ts`
 * (rejecting non-calendar dates such as month 13 or day 32).
 */

import type { AccountingPeriod } from './types';

/**
 * Extract the `YYYY-MM` calendar-month key from a strict ISO date
 * (`YYYY-MM-DD`, optionally followed by a `T…` time suffix). Throws on
 * anything that is not a real calendar date — the same normalisation guard
 * as `checks.ts`'s `toEpochDay` (e.g. `2026-02-30` -> March is rejected).
 */
export function periodKeyOf(isoDate: string): string {
  // Validate the WHOLE string: a bare date, or a date + a well-formed time
  // suffix. This rejects trailing garbage like `2026-03-15Tnonsense` that a
  // naive split-on-'T' would silently accept.
  const m =
    /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?$/.exec(
      isoDate,
    );
  if (!m) {
    throw new Error(`invalid ISO date: ${isoDate}`);
  }
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const utc = Date.UTC(year, month - 1, day);
  if (Number.isNaN(utc)) {
    throw new Error(`invalid ISO date: ${isoDate}`);
  }
  const d = new Date(utc);
  // Reject values that JS normalised (e.g. 2026-02-30 -> March, or month 13).
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    throw new Error(`invalid ISO date: ${isoDate}`);
  }
  // m[1] and m[2] are guaranteed by the regex; reuse the source digits.
  return `${m[1]}-${m[2]}`;
}

/** A period is postable iff it is not closed (i.e. `open` or `reopened`). */
export function isPostable(period: AccountingPeriod): boolean {
  return period.status !== 'closed';
}

/**
 * Find the period record matching `entityId` and the month key of `isoDate`,
 * or `undefined` when none exists. Throws if `isoDate` is not a valid date.
 */
export function findPeriod(
  periods: readonly AccountingPeriod[],
  entityId: string,
  isoDate: string,
): AccountingPeriod | undefined {
  const key = periodKeyOf(isoDate);
  return periods.find((p) => p.entityId === entityId && p.period === key);
}

/**
 * Assert that a posting into `entityId` on `isoDate` is permitted. If a
 * matching period exists AND is closed, throw naming the entity + period. If
 * no matching period record exists, the posting is allowed (treated as an
 * implicitly open period).
 */
export function assertPostable(
  periods: readonly AccountingPeriod[],
  entityId: string,
  isoDate: string,
): void {
  const period = findPeriod(periods, entityId, isoDate);
  if (period !== undefined && !isPostable(period)) {
    throw new Error(
      `accounting period ${period.period} for entity ${entityId} is closed; posting rejected`,
    );
  }
}

/**
 * Return a new period with status `closed` (does not mutate the input).
 */
export function closePeriod(period: AccountingPeriod): AccountingPeriod {
  return { ...period, status: 'closed' };
}

/**
 * Return a new period with status `reopened` (does not mutate the input).
 */
export function reopenPeriod(period: AccountingPeriod): AccountingPeriod {
  return { ...period, status: 'reopened' };
}
