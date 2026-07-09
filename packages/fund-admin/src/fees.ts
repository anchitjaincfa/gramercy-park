import { allocate, applyBps, money } from '@gramercy/core';
import type { FeeFrequency, MgmtFeeSchedule } from './types';

/**
 * Number of billing periods in a year for a given fee frequency. Management
 * fees are quoted as an ANNUAL rate (`rateBps`) but billed per period, so this
 * is the divisor used to turn an annual fee into a per-period fee.
 */
export function periodsPerYear(frequency: FeeFrequency): number {
  switch (frequency) {
    case 'quarterly':
      return 4;
    case 'semiannual':
      return 2;
    case 'annual':
      return 1;
  }
}

/**
 * The full schedule of per-period management fees for one year, in integer
 * minor units — one entry per billing period. The annual fee is
 * `applyBps(basis, rateBps)`; it is split across `periodsPerYear` buckets with
 * the core largest-remainder `allocate`, so the returned parts sum EXACTLY to
 * the annual fee (any leftover crumb lands on the earliest period). For 200 bps
 * on 10,000,000 quarterly that is `[50000, 50000, 50000, 50000]`.
 */
export function periodMgmtFees(
  schedule: MgmtFeeSchedule,
  basisAmountMinor: number,
  currency: string,
): number[] {
  if (!Number.isInteger(basisAmountMinor) || basisAmountMinor < 0) {
    throw new Error(
      `periodMgmtFees requires a non-negative integer basis, got ${basisAmountMinor}`,
    );
  }
  if (!(schedule.rateBps >= 0)) {
    throw new Error(`periodMgmtFees requires rateBps >= 0, got ${schedule.rateBps}`);
  }
  const annualFee = applyBps(money(basisAmountMinor, currency), schedule.rateBps);
  const n = periodsPerYear(schedule.frequency);
  return allocate(annualFee, new Array(n).fill(1)).map((m) => m.amount);
}

/**
 * Management fee for a SPECIFIC billing period (0-indexed), in integer minor
 * units. Because each period returns its OWN bucket from `periodMgmtFees`,
 * summing `computeMgmtFee` over all periods of a year yields the exact annual
 * fee — billing every quarter never over- or under-charges by a crumb.
 */
export function computeMgmtFee(
  schedule: MgmtFeeSchedule,
  basisAmountMinor: number,
  currency: string,
  periodIndex = 0,
): number {
  const fees = periodMgmtFees(schedule, basisAmountMinor, currency);
  if (!Number.isInteger(periodIndex) || periodIndex < 0 || periodIndex >= fees.length) {
    throw new Error(
      `periodIndex must be an integer in [0, ${fees.length - 1}], got ${periodIndex}`,
    );
  }
  return fees[periodIndex]!;
}

/**
 * Split the fund's per-period management fee across LPs pro-rata to their
 * `basisMinor`.
 *
 * The fee is computed ONCE on the aggregate basis (sum of every LP's
 * `basisMinor`) so the fund charges a single, coherent period fee, then that
 * total is allocated across LPs with the core largest-remainder `allocate`.
 * This guarantees the per-LP fees sum EXACTLY to the fund period fee — no cent
 * created or lost. Ties are broken canonically by lowest `lpId` (inputs are
 * sorted ascending), independent of caller order. Zero-fee LPs are omitted.
 * If the aggregate basis is 0 there is nothing to charge, so we return `[]`.
 */
export function computeMgmtFeePerLp(
  schedule: MgmtFeeSchedule,
  perLp: readonly { lpId: string; basisMinor: number }[],
  currency: string,
  periodIndex = 0,
): { lpId: string; feeMinor: number }[] {
  const seen = new Set<string>();
  for (const p of perLp) {
    if (!Number.isInteger(p.basisMinor) || p.basisMinor < 0) {
      throw new Error(`basisMinor must be a non-negative integer; ${p.lpId} = ${p.basisMinor}`);
    }
    if (seen.has(p.lpId)) throw new Error(`duplicate lpId in computeMgmtFeePerLp: ${p.lpId}`);
    seen.add(p.lpId);
  }

  const aggregateBasis = perLp.reduce((sum, p) => sum + p.basisMinor, 0);
  if (aggregateBasis === 0) return [];

  const fundPeriodFee = computeMgmtFee(schedule, aggregateBasis, currency, periodIndex);
  if (fundPeriodFee === 0) return [];

  // Canonical, deterministic tie-break: allocate in ascending lpId order so the
  // largest-remainder "lowest index first" crumb rule maps to the lowest lpId,
  // independent of the caller's input order (mirrors allocation.ts).
  const ordered = [...perLp].sort((a, b) => (a.lpId < b.lpId ? -1 : a.lpId > b.lpId ? 1 : 0));

  const parts = allocate(
    money(fundPeriodFee, currency),
    ordered.map((p) => p.basisMinor),
  );

  const fees: { lpId: string; feeMinor: number }[] = [];
  ordered.forEach((p, i) => {
    const feeMinor = parts[i]!.amount;
    if (feeMinor === 0) return; // omit zero fees
    fees.push({ lpId: p.lpId, feeMinor });
  });

  return fees;
}
