/**
 * Ownership / equity-pickup math (Phase 5).
 *
 * A fund's stake value in a portfolio company is its fully-diluted ownership
 * applied to the company's fair value:
 *
 *   stakeValue = ownershipBps × companyFairValue        (equity pickup)
 *   MOIC       = stakeValue / cost                       (multiple on invested capital)
 *
 * All money is integer minor units — we never use floating point for monetary
 * amounts. The stake value funnels through `@gramercy/core`'s `applyBps` (which
 * rounds half-up via decimal.js), and MOIC bps are computed with exact BigInt
 * intermediates so large values never lose precision.
 */

import { applyBps, money } from '@gramercy/core';
import type { Investment, CompanyValuation, Position } from './types';

/** Add two safe integers, throwing rather than silently losing minor units. */
function checkedAdd(a: number, b: number): number {
  const sum = a + b;
  if (!Number.isSafeInteger(sum)) {
    throw new Error(`portfolio total overflowed the safe-integer range: ${a} + ${b}`);
  }
  return sum;
}

/**
 * The fund's stake value = `ownershipBps` × `companyFairValueMinor`, in integer
 * minor units, rounded half-up (delegated to core `applyBps`).
 *
 * Guards: `ownershipBps` must be an integer in [0, 10000] (0%–100%);
 * `companyFairValueMinor` must be a non-negative safe integer. Because
 * ownership is at most 100%, the returned stake never exceeds the company's
 * fair value.
 */
export function stakeValueMinor(
  ownershipBps: number,
  companyFairValueMinor: number,
  currency: string,
): number {
  if (!Number.isInteger(ownershipBps) || ownershipBps < 0 || ownershipBps > 10_000) {
    throw new Error(
      `stakeValueMinor requires an integer ownershipBps in [0, 10000], got ${ownershipBps}`,
    );
  }
  if (!Number.isSafeInteger(companyFairValueMinor) || companyFairValueMinor < 0) {
    throw new Error(
      `stakeValueMinor requires a non-negative safe integer companyFairValueMinor, got ${companyFairValueMinor}`,
    );
  }
  return applyBps(money(companyFairValueMinor, currency), ownershipBps).amount;
}

/**
 * MOIC in basis points = round(stakeValue / cost × 10000), using exact BigInt
 * math so no float error creeps in for large minor-unit values. Rounds half-up.
 * `cost` must be > 0 (callers handle the cost === 0 case separately).
 */
function moicBpsExact(stakeValueMinorAmt: number, costMinor: number): number {
  // round(stake * 10000 / cost) via half-up: floor((2·num + den) / (2·den)).
  // Both operands are non-negative here, so plain half-up is correct.
  const num = BigInt(stakeValueMinorAmt) * 10_000n;
  const den = BigInt(costMinor);
  const rounded = (2n * num + den) / (2n * den);
  const n = Number(rounded);
  if (!Number.isSafeInteger(n)) {
    throw new Error(
      `moicBps overflowed the safe-integer range (stake=${stakeValueMinorAmt}, cost=${costMinor})`,
    );
  }
  return n;
}

/**
 * MOIC in basis points for an aggregate `stakeValueMinorAmt` against `costMinor`,
 * using exact BigInt math (never floating point). Returns 0 when cost is 0. This
 * is the public entry point UIs should use for a blended/portfolio-level MOIC so
 * they never re-derive it with lossy float division.
 */
export function moicBps(stakeValueMinorAmt: number, costMinor: number): number {
  if (!Number.isSafeInteger(stakeValueMinorAmt) || stakeValueMinorAmt < 0) {
    throw new Error(
      `moicBps requires a non-negative safe integer stake, got ${stakeValueMinorAmt}`,
    );
  }
  if (!Number.isSafeInteger(costMinor) || costMinor < 0) {
    throw new Error(`moicBps requires a non-negative safe integer cost, got ${costMinor}`);
  }
  return costMinor > 0 ? moicBpsExact(stakeValueMinorAmt, costMinor) : 0;
}

/**
 * Compute the position of one `investment` at a `valuation` point.
 *
 * - stakeValue = `stakeValueMinor(ownershipBps, fairValueMinor)`
 * - unrealizedGain = stakeValue − cost   (may be negative)
 * - moicBps = cost > 0 ? round(stakeValue / cost × 10000) : 0
 *
 * Throws if the investment's currency differs from the valuation's currency, or
 * if the valuation is for a different company than the investment.
 */
export function computePosition(investment: Investment, valuation: CompanyValuation): Position {
  if (investment.currency !== valuation.currency) {
    throw new Error(
      `computePosition currency mismatch: investment ${investment.currency} vs valuation ${valuation.currency}`,
    );
  }
  if (investment.companyId !== valuation.companyId) {
    throw new Error(
      `computePosition company mismatch: investment ${investment.companyId} vs valuation ${valuation.companyId}`,
    );
  }
  // Tenant isolation: never apply another firm's mark to this firm's investment,
  // even if the two share a companyId.
  if (investment.firmId !== valuation.firmId) {
    throw new Error(
      `computePosition firm mismatch: investment ${investment.firmId} vs valuation ${valuation.firmId}`,
    );
  }
  if (!Number.isSafeInteger(investment.costMinor) || investment.costMinor < 0) {
    throw new Error(
      `computePosition requires a non-negative safe integer costMinor, got ${investment.costMinor}`,
    );
  }

  const stake = stakeValueMinor(
    investment.ownershipBps,
    valuation.fairValueMinor,
    investment.currency,
  );
  const unrealizedGainMinor = stake - investment.costMinor;
  const moicBps = investment.costMinor > 0 ? moicBpsExact(stake, investment.costMinor) : 0;

  return {
    investmentId: investment.id,
    companyId: investment.companyId,
    costMinor: investment.costMinor,
    ownershipBps: investment.ownershipBps,
    stakeValueMinor: stake,
    unrealizedGainMinor,
    moicBps,
    currency: investment.currency,
  };
}

/** The aggregate result of rolling up a set of investments into positions. */
export interface PortfolioRollup {
  readonly positions: Position[];
  readonly totalCostMinor: number;
  readonly totalFairValueMinor: number;
  readonly totalUnrealizedGainMinor: number;
  /** Ids of investments skipped because their company has no valuation — surfaced
   * (not silently dropped) so callers know the totals exclude them. */
  readonly missingValuations: string[];
}

/**
 * Roll a set of `investments` up into positions using per-company valuations.
 *
 * Investments whose company has no valuation in `valuationsByCompanyId` are
 * SKIPPED (omitted from the result, not errored). Every included investment and
 * its valuation must be denominated in `currency` — a mismatch throws rather
 * than silently mixing currencies.
 *
 * Totals are the exact sums over the included positions:
 *   totalCost      = Σ costMinor
 *   totalFairValue = Σ stakeValueMinor
 *   totalGain      = Σ unrealizedGainMinor  ( = totalFairValue − totalCost )
 */
export function rollupPortfolio(
  investments: readonly Investment[],
  valuationsByCompanyId: ReadonlyMap<string, CompanyValuation>,
  currency: string,
): PortfolioRollup {
  const positions: Position[] = [];
  const missingValuations: string[] = [];
  let totalCostMinor = 0;
  let totalFairValueMinor = 0;
  let totalUnrealizedGainMinor = 0;

  for (const investment of investments) {
    // Validate currency for EVERY investment, even ones we skip, so a
    // wrong-currency investment can't hide behind a missing valuation.
    if (investment.currency !== currency) {
      throw new Error(
        `rollupPortfolio currency mismatch: investment ${investment.id} is ${investment.currency}, expected ${currency}`,
      );
    }
    const valuation = valuationsByCompanyId.get(investment.companyId);
    if (!valuation) {
      missingValuations.push(investment.id); // surfaced, not silently dropped
      continue;
    }
    if (valuation.currency !== currency) {
      throw new Error(
        `rollupPortfolio currency mismatch: valuation for ${valuation.companyId} is ${valuation.currency}, expected ${currency}`,
      );
    }

    const position = computePosition(investment, valuation);
    positions.push(position);
    totalCostMinor = checkedAdd(totalCostMinor, position.costMinor);
    totalFairValueMinor = checkedAdd(totalFairValueMinor, position.stakeValueMinor);
    totalUnrealizedGainMinor = checkedAdd(totalUnrealizedGainMinor, position.unrealizedGainMinor);
  }

  return {
    positions,
    totalCostMinor,
    totalFairValueMinor,
    totalUnrealizedGainMinor,
    missingValuations,
  };
}
