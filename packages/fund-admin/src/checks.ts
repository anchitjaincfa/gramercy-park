/**
 * Capital-call health checks (Phase 2, see docs/ARCHITECTURE.md §6).
 *
 * A capital call must pass a pipeline of composable `Check` functions before it
 * can be posted. Each check is a pure, deterministic function of a
 * `CapitalCallContext` returning a single `CheckResult` (`pass` | `warn` |
 * `fail`). No I/O, no randomness, no floats — money is integer minor units.
 *
 * The set is data-driven (`ALL_CHECKS`) so each check is unit-testable in
 * isolation. `checksPass` gates posting: a call is postable iff no check
 * returns `fail` (a `warn` is advisory and does not block).
 */

import type { CapitalCall, CapitalCallAllocation, Commitment, Lp } from './types';

export type CheckStatus = 'pass' | 'warn' | 'fail';

export interface CheckResult {
  code: string;
  status: CheckStatus;
  message: string;
}

export interface CapitalCallContext {
  call: CapitalCall;
  commitments: Commitment[]; // all commitments for this fund
  lpsById: Record<string, Lp>;
  priorCalledByLp: Record<string, number>; // sum of prior contribution calls per lpId (minor units)
  priorCallNumbers: number[]; // numbers of prior calls for this fund
  noticeDays: number; // required notice period (days)
  asOfDate: string; // 'today' for date checks (ISO)
}

export type Check = (ctx: CapitalCallContext) => CheckResult;

// --------------------------------------------------------------------------
// Result builders
// --------------------------------------------------------------------------

const ok = (code: string, message: string): CheckResult => ({
  code,
  status: 'pass',
  message,
});
const warn = (code: string, message: string): CheckResult => ({
  code,
  status: 'warn',
  message,
});
const fail = (code: string, message: string): CheckResult => ({
  code,
  status: 'fail',
  message,
});

// --------------------------------------------------------------------------
// Shared helpers (pure)
// --------------------------------------------------------------------------

interface AggCommitment {
  amountMinor: number;
  recallableUsedMinor: number;
  currency: string;
  fundId: string;
}

/** Aggregate all of a fund's commitments per LP (an LP may hold several). */
function aggregateCommitments(commitments: readonly Commitment[]): Map<string, AggCommitment> {
  const byLp = new Map<string, AggCommitment>();
  for (const c of commitments) {
    const existing = byLp.get(c.lpId);
    if (existing) {
      existing.amountMinor += c.amountMinor;
      existing.recallableUsedMinor += c.recallableUsedMinor;
    } else {
      byLp.set(c.lpId, {
        amountMinor: c.amountMinor,
        recallableUsedMinor: c.recallableUsedMinor,
        currency: c.currency,
        fundId: c.fundId,
      });
    }
  }
  return byLp;
}

/** Sum of allocation amounts for a given kind. */
function sumByKind(
  allocations: readonly CapitalCallAllocation[],
  kind: CapitalCallAllocation['kind'],
): number {
  let total = 0;
  for (const a of allocations) if (a.kind === kind) total += a.amountMinor;
  return total;
}

/** Total contribution amount per LP. */
function contributionByLp(allocations: readonly CapitalCallAllocation[]): Map<string, number> {
  const byLp = new Map<string, number>();
  for (const a of allocations) {
    if (a.kind !== 'contribution') continue;
    byLp.set(a.lpId, (byLp.get(a.lpId) ?? 0) + a.amountMinor);
  }
  return byLp;
}

/** Uncalled commitment for an LP: aggregate commitment minus prior contributions. */
function uncalledFor(
  lpId: string,
  agg: Map<string, AggCommitment>,
  priorCalledByLp: Record<string, number>,
): number {
  const committed = agg.get(lpId)?.amountMinor ?? 0;
  const prior = priorCalledByLp[lpId] ?? 0;
  return committed - prior;
}

/**
 * Parse a strict `YYYY-MM-DD` (optionally with a `T…` time suffix) into a whole
 * UTC epoch-day integer. Returns `null` for anything that is not a real
 * calendar date (rejects e.g. month 13 or day 32).
 */
function toEpochDay(iso: string): number | null {
  const datePart = iso.split('T')[0] ?? '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const utc = Date.UTC(year, month - 1, day);
  if (Number.isNaN(utc)) return null;
  const d = new Date(utc);
  // Reject values that JS normalised (e.g. 2026-02-30 -> March).
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null;
  }
  return Math.floor(utc / 86_400_000);
}

// --------------------------------------------------------------------------
// Checks
// --------------------------------------------------------------------------

// 1. Call total must be strictly positive.
const totalPositive: Check = (ctx) =>
  ctx.call.totalMinor > 0
    ? ok('TOTAL_POSITIVE', `call total ${ctx.call.totalMinor} > 0`)
    : fail('TOTAL_POSITIVE', `call total must be > 0, got ${ctx.call.totalMinor}`);

// 2. A call must have at least one allocation.
const hasAllocations: Check = (ctx) =>
  ctx.call.allocations.length >= 1
    ? ok('HAS_ALLOCATIONS', `${ctx.call.allocations.length} allocation(s)`)
    : fail('HAS_ALLOCATIONS', 'call has no allocations');

// 3. Contribution allocations must sum exactly to the call total. `totalMinor`
//    is defined as the total contributions called (fee offsets / recalls are
//    separate mechanisms); this keeps the checks and the ledger builder in
//    agreement about what gets posted.
const allocSumEqualsTotal: Check = (ctx) => {
  const sum = sumByKind(ctx.call.allocations, 'contribution');
  return sum === ctx.call.totalMinor
    ? ok('ALLOC_SUM_EQUALS_TOTAL', `contribution allocations sum to ${sum}`)
    : fail(
        'ALLOC_SUM_EQUALS_TOTAL',
        `contribution allocations sum ${sum} != call total ${ctx.call.totalMinor}`,
      );
};

// 4. No allocation may carry a non-positive amount.
const allAllocAmountsPositive: Check = (ctx) => {
  const bad = ctx.call.allocations.filter((a) => a.amountMinor <= 0);
  return bad.length === 0
    ? ok('ALL_ALLOC_AMOUNTS_POSITIVE', 'every allocation amount > 0')
    : fail('ALL_ALLOC_AMOUNTS_POSITIVE', `${bad.length} allocation(s) with amount <= 0`);
};

// 5. Every allocation's LP must exist in the roster.
const allocLpExists: Check = (ctx) => {
  const missing = ctx.call.allocations.filter((a) => ctx.lpsById[a.lpId] === undefined);
  return missing.length === 0
    ? ok('ALLOC_LP_EXISTS', 'all allocation LPs are known')
    : fail(
        'ALLOC_LP_EXISTS',
        `unknown LP(s): ${[...new Set(missing.map((a) => a.lpId))].join(', ')}`,
      );
};

// 6. No allocation may reference an LP outside the call's firm.
const allocLpInFirm: Check = (ctx) => {
  const bad = ctx.call.allocations.filter((a) => {
    const lp = ctx.lpsById[a.lpId];
    return lp !== undefined && lp.firmId !== ctx.call.firmId;
  });
  return bad.length === 0
    ? ok('ALLOC_LP_IN_FIRM', 'all allocation LPs belong to the call firm')
    : fail(
        'ALLOC_LP_IN_FIRM',
        `${bad.length} allocation(s) to LP(s) outside firm ${ctx.call.firmId}`,
      );
};

// 7. Every allocated LP must have a commitment in this fund.
const allocLpHasCommitment: Check = (ctx) => {
  const committed = new Set(ctx.commitments.map((c) => c.lpId));
  const missing = ctx.call.allocations.filter((a) => !committed.has(a.lpId));
  return missing.length === 0
    ? ok('ALLOC_LP_HAS_COMMITMENT', 'all allocated LPs are committed')
    : fail(
        'ALLOC_LP_HAS_COMMITMENT',
        `uncommitted LP(s): ${[...new Set(missing.map((a) => a.lpId))].join(', ')}`,
      );
};

// 8. Per-LP contribution (aggregated across rows) must not exceed that LP's
//    uncalled commitment.
const contribWithinUncalled: Check = (ctx) => {
  const agg = aggregateCommitments(ctx.commitments);
  const contrib = contributionByLp(ctx.call.allocations);
  const offenders: string[] = [];
  for (const [lpId, amount] of contrib) {
    const uncalled = uncalledFor(lpId, agg, ctx.priorCalledByLp);
    if (amount > uncalled) offenders.push(lpId);
  }
  return offenders.length === 0
    ? ok('CONTRIB_WITHIN_UNCALLED', 'contributions within uncalled commitment')
    : fail('CONTRIB_WITHIN_UNCALLED', `contribution exceeds uncalled for: ${offenders.join(', ')}`);
};

// 9. No LP may be over-called cumulatively (prior + this call > commitment).
//    Iterates over EVERY committed LP, not just current contributors, so an LP
//    already over-called in prior periods is flagged even if omitted here.
const noOvercallCumulative: Check = (ctx) => {
  const agg = aggregateCommitments(ctx.commitments);
  const contrib = contributionByLp(ctx.call.allocations);
  const offenders: string[] = [];
  for (const [lpId, c] of agg) {
    const thisCall = contrib.get(lpId) ?? 0;
    const prior = ctx.priorCalledByLp[lpId] ?? 0;
    if (prior + thisCall > c.amountMinor) offenders.push(lpId);
  }
  return offenders.length === 0
    ? ok('NO_OVERCALL_CUMULATIVE', 'no cumulative over-call')
    : fail('NO_OVERCALL_CUMULATIVE', `cumulative over-call for: ${offenders.join(', ')}`);
};

// 10. The call currency must be set.
const callCurrencySet: Check = (ctx) =>
  ctx.call.currency.trim().length > 0
    ? ok('CALL_CURRENCY_SET', `currency ${ctx.call.currency}`)
    : fail('CALL_CURRENCY_SET', 'call currency is empty');

// 11. Each allocated LP's commitment currency must match the call currency.
const allocCurrencyMatchesCall: Check = (ctx) => {
  const agg = aggregateCommitments(ctx.commitments);
  const offenders: string[] = [];
  for (const a of ctx.call.allocations) {
    const c = agg.get(a.lpId);
    if (c !== undefined && c.currency !== ctx.call.currency) {
      offenders.push(a.lpId);
    }
  }
  return offenders.length === 0
    ? ok('ALLOC_CURRENCY_MATCHES_CALL', 'allocation currencies match call')
    : fail(
        'ALLOC_CURRENCY_MATCHES_CALL',
        `currency mismatch for: ${[...new Set(offenders)].join(', ')}`,
      );
};

// 12. Due date must be on or after the call date.
const dueOnOrAfterCall: Check = (ctx) => {
  const call = toEpochDay(ctx.call.callDate);
  const due = toEpochDay(ctx.call.dueDate);
  if (call === null || due === null) {
    return ok('DUE_ON_OR_AFTER_CALL', 'skipped (unparseable date)');
  }
  return due >= call
    ? ok('DUE_ON_OR_AFTER_CALL', 'due date on/after call date')
    : fail(
        'DUE_ON_OR_AFTER_CALL',
        `due date ${ctx.call.dueDate} precedes call date ${ctx.call.callDate}`,
      );
};

// 13. Due date must respect the required notice period.
const dueMeetsNoticePeriod: Check = (ctx) => {
  const call = toEpochDay(ctx.call.callDate);
  const due = toEpochDay(ctx.call.dueDate);
  if (call === null || due === null) {
    return ok('DUE_MEETS_NOTICE_PERIOD', 'skipped (unparseable date)');
  }
  return due - call >= ctx.noticeDays
    ? ok('DUE_MEETS_NOTICE_PERIOD', `>= ${ctx.noticeDays} day notice`)
    : fail('DUE_MEETS_NOTICE_PERIOD', `only ${due - call} day(s) notice, need ${ctx.noticeDays}`);
};

// 14. The call may not be future-dated relative to as-of.
const callNotFutureDated: Check = (ctx) => {
  const call = toEpochDay(ctx.call.callDate);
  const asOf = toEpochDay(ctx.asOfDate);
  if (call === null || asOf === null) {
    return ok('CALL_NOT_FUTURE_DATED', 'skipped (unparseable date)');
  }
  return call <= asOf
    ? ok('CALL_NOT_FUTURE_DATED', 'call date not in the future')
    : fail(
        'CALL_NOT_FUTURE_DATED',
        `call date ${ctx.call.callDate} is after as-of ${ctx.asOfDate}`,
      );
};

// 15. Call number must be exactly one greater than the prior max (no gaps).
const numberSequential: Check = (ctx) => {
  const maxPrior = ctx.priorCallNumbers.length > 0 ? Math.max(...ctx.priorCallNumbers) : 0;
  return ctx.call.number === maxPrior + 1
    ? ok('NUMBER_SEQUENTIAL', `call #${ctx.call.number} follows #${maxPrior}`)
    : fail('NUMBER_SEQUENTIAL', `call #${ctx.call.number} must be #${maxPrior + 1} (no gaps)`);
};

// 16. Call number must not duplicate a prior call number.
const numberNotDuplicate: Check = (ctx) =>
  !ctx.priorCallNumbers.includes(ctx.call.number)
    ? ok('NUMBER_NOT_DUPLICATE', `call #${ctx.call.number} is unique`)
    : fail('NUMBER_NOT_DUPLICATE', `call #${ctx.call.number} already exists`);

// 17. The fund must have at least one active committed LP.
const fundHasActiveCommitment: Check = (ctx) => {
  const has = ctx.commitments.some((c) => ctx.lpsById[c.lpId]?.status === 'active');
  return has
    ? ok('FUND_HAS_ACTIVE_COMMITMENT', 'fund has an active commitment')
    : fail('FUND_HAS_ACTIVE_COMMITMENT', 'no active committed LP in fund');
};

// 18. An inactive or transferred LP may not receive a contribution.
const noContributionToInactiveLp: Check = (ctx) => {
  const offenders: string[] = [];
  for (const a of ctx.call.allocations) {
    if (a.kind !== 'contribution') continue;
    const lp = ctx.lpsById[a.lpId];
    if (lp !== undefined && lp.status !== 'active') offenders.push(a.lpId);
  }
  return offenders.length === 0
    ? ok('NO_CONTRIBUTION_TO_INACTIVE_LP', 'contributions only to active LPs')
    : fail(
        'NO_CONTRIBUTION_TO_INACTIVE_LP',
        `contribution to non-active LP(s): ${offenders.join(', ')}`,
      );
};

// 19. Recall allocations may not exceed the LP's recallable headroom.
const recallWithinRecallable: Check = (ctx) => {
  const agg = aggregateCommitments(ctx.commitments);
  const offenders: string[] = [];
  for (const a of ctx.call.allocations) {
    if (a.kind !== 'recall') continue;
    const recallable = agg.get(a.lpId)?.recallableUsedMinor ?? 0;
    if (a.amountMinor > recallable) offenders.push(a.lpId);
  }
  return offenders.length === 0
    ? ok('RECALL_WITHIN_RECALLABLE', 'recalls within recallable headroom')
    : fail('RECALL_WITHIN_RECALLABLE', `recall exceeds recallable for: ${offenders.join(', ')}`);
};

// 20. Fee-offset amounts must be non-negative and not exceed the LP's contribution.
const feeOffsetWithinContribution: Check = (ctx) => {
  const contrib = contributionByLp(ctx.call.allocations);
  const offenders: string[] = [];
  for (const a of ctx.call.allocations) {
    if (a.kind !== 'fee_offset') continue;
    const c = contrib.get(a.lpId) ?? 0;
    if (a.amountMinor < 0 || a.amountMinor > c) offenders.push(a.lpId);
  }
  return offenders.length === 0
    ? ok('FEE_OFFSET_WITHIN_CONTRIBUTION', 'fee offsets within contribution')
    : fail('FEE_OFFSET_WITHIN_CONTRIBUTION', `invalid fee offset for: ${offenders.join(', ')}`);
};

// 21. No duplicate (lpId, kind) allocation pairs.
const noDuplicateLpKind: Check = (ctx) => {
  const seen = new Set<string>();
  const dups = new Set<string>();
  for (const a of ctx.call.allocations) {
    const key = `${a.lpId}|${a.kind}`;
    if (seen.has(key)) dups.add(key);
    seen.add(key);
  }
  return dups.size === 0
    ? ok('NO_DUPLICATE_LP_KIND', 'no duplicate (lp, kind) allocations')
    : fail('NO_DUPLICATE_LP_KIND', `duplicate allocation(s): ${[...dups].join(', ')}`);
};

// 22. Total contributions must be at least total fee offsets (net-positive call).
const contribGeFeeOffset: Check = (ctx) => {
  const contrib = sumByKind(ctx.call.allocations, 'contribution');
  const feeOffset = sumByKind(ctx.call.allocations, 'fee_offset');
  return contrib >= feeOffset
    ? ok('CONTRIB_GE_FEE_OFFSET', 'contributions >= fee offsets')
    : fail('CONTRIB_GE_FEE_OFFSET', `fee offsets ${feeOffset} exceed contributions ${contrib}`);
};

// 23. Every active committed LP should appear (warn on an omission).
const allActiveCommittedLpsIncluded: Check = (ctx) => {
  const activeCommitted = new Set(
    ctx.commitments.filter((c) => ctx.lpsById[c.lpId]?.status === 'active').map((c) => c.lpId),
  );
  const contributing = new Set(contributionByLp(ctx.call.allocations).keys());
  const missing = [...activeCommitted].filter((id) => !contributing.has(id));
  return missing.length === 0
    ? ok('ALL_ACTIVE_COMMITTED_LPS_INCLUDED', 'all active committed LPs included')
    : warn(
        'ALL_ACTIVE_COMMITTED_LPS_INCLUDED',
        `active committed LP(s) excluded: ${missing.join(', ')}`,
      );
};

// 24. Contribution proportions should track uncalled-commitment proportions
//     across ALL active committed LPs (warn on drift). The denominator spans
//     every active committed LP — so omitting an LP that should have been called
//     pro-rata shows up as a deviation rather than being silently ignored.
const allocProportionsTrackCommitment: Check = (ctx) => {
  const agg = aggregateCommitments(ctx.commitments);
  const contrib = contributionByLp(ctx.call.allocations);
  const totalContrib = sumByKind(ctx.call.allocations, 'contribution');

  const activeCommittedLps = [...agg.keys()].filter((id) => ctx.lpsById[id]?.status === 'active');
  let totalUncalled = 0;
  for (const lpId of activeCommittedLps) {
    totalUncalled += Math.max(0, uncalledFor(lpId, agg, ctx.priorCalledByLp));
  }
  if (totalContrib === 0 || totalUncalled === 0) {
    return ok('ALLOC_PROPORTIONS_TRACK_COMMITMENT', 'no basis to compare');
  }
  let maxDeviation = 0;
  for (const lpId of activeCommittedLps) {
    const uncalled = Math.max(0, uncalledFor(lpId, agg, ctx.priorCalledByLp));
    const actual = (contrib.get(lpId) ?? 0) / totalContrib;
    const expected = uncalled / totalUncalled;
    maxDeviation = Math.max(maxDeviation, Math.abs(actual - expected));
  }
  return maxDeviation <= 0.1
    ? ok('ALLOC_PROPORTIONS_TRACK_COMMITMENT', 'allocations track commitment')
    : warn(
        'ALLOC_PROPORTIONS_TRACK_COMMITMENT',
        `allocation deviates from commitment share by ${(maxDeviation * 100).toFixed(1)}%`,
      );
};

// 25. Purpose must be non-empty.
const purposeNonEmpty: Check = (ctx) =>
  ctx.call.purpose.trim().length > 0
    ? ok('PURPOSE_NONEMPTY', 'purpose set')
    : fail('PURPOSE_NONEMPTY', 'call purpose is empty');

// 26. All provided commitments must belong to the call's fund.
const commitmentsMatchCallFund: Check = (ctx) => {
  const bad = ctx.commitments.filter((c) => c.fundId !== ctx.call.fundId);
  return bad.length === 0
    ? ok('COMMITMENTS_MATCH_CALL_FUND', 'commitments match call fund')
    : fail(
        'COMMITMENTS_MATCH_CALL_FUND',
        `${bad.length} commitment(s) not in fund ${ctx.call.fundId}`,
      );
};

// 27. The call must carry a firm id.
const callFirmSet: Check = (ctx) =>
  ctx.call.firmId.trim().length > 0
    ? ok('CALL_FIRM_SET', `firm ${ctx.call.firmId}`)
    : fail('CALL_FIRM_SET', 'call firmId is empty');

// 28. Total contributions must not exceed aggregate uncalled commitment.
const contribTotalWithinAggregateUncalled: Check = (ctx) => {
  const agg = aggregateCommitments(ctx.commitments);
  let totalUncalled = 0;
  for (const lpId of agg.keys()) {
    totalUncalled += Math.max(0, uncalledFor(lpId, agg, ctx.priorCalledByLp));
  }
  const totalContrib = sumByKind(ctx.call.allocations, 'contribution');
  return totalContrib <= totalUncalled
    ? ok(
        'CONTRIB_TOTAL_WITHIN_AGGREGATE_UNCALLED',
        `contributions ${totalContrib} <= uncalled ${totalUncalled}`,
      )
    : fail(
        'CONTRIB_TOTAL_WITHIN_AGGREGATE_UNCALLED',
        `contributions ${totalContrib} exceed aggregate uncalled ${totalUncalled}`,
      );
};

// 29. Warn when the call draws down more than 95% of remaining uncalled capital.
const highUtilizationWarn: Check = (ctx) => {
  const agg = aggregateCommitments(ctx.commitments);
  let totalUncalled = 0;
  for (const lpId of agg.keys()) {
    totalUncalled += Math.max(0, uncalledFor(lpId, agg, ctx.priorCalledByLp));
  }
  const totalContrib = sumByKind(ctx.call.allocations, 'contribution');
  // totalContrib / totalUncalled > 0.95 without floats.
  if (totalUncalled > 0 && totalContrib * 100 > totalUncalled * 95) {
    return warn(
      'HIGH_UTILIZATION_WARN',
      `call draws ${totalContrib} of ${totalUncalled} uncalled (>95%)`,
    );
  }
  return ok('HIGH_UTILIZATION_WARN', 'utilization within normal range');
};

// 30. Call date must be a valid ISO calendar date.
const callDateValidIso: Check = (ctx) =>
  toEpochDay(ctx.call.callDate) !== null
    ? ok('CALL_DATE_VALID_ISO', `call date ${ctx.call.callDate} is valid`)
    : fail('CALL_DATE_VALID_ISO', `invalid call date ${ctx.call.callDate}`);

// 31. Due date must be a valid ISO calendar date.
const dueDateValidIso: Check = (ctx) =>
  toEpochDay(ctx.call.dueDate) !== null
    ? ok('DUE_DATE_VALID_ISO', `due date ${ctx.call.dueDate} is valid`)
    : fail('DUE_DATE_VALID_ISO', `invalid due date ${ctx.call.dueDate}`);

// 32. Prior-called totals must be non-negative (data integrity).
const priorCalledNonNegative: Check = (ctx) => {
  const bad = Object.entries(ctx.priorCalledByLp).filter(([, v]) => v < 0);
  return bad.length === 0
    ? ok('PRIOR_CALLED_NONNEGATIVE', 'prior-called totals non-negative')
    : fail(
        'PRIOR_CALLED_NONNEGATIVE',
        `negative prior-called for: ${bad.map(([k]) => k).join(', ')}`,
      );
};

// 33. Every commitment amount must be strictly positive (data integrity).
const commitmentAmountsPositive: Check = (ctx) => {
  const bad = ctx.commitments.filter((c) => c.amountMinor <= 0);
  return bad.length === 0
    ? ok('COMMITMENT_AMOUNTS_POSITIVE', 'all commitment amounts > 0')
    : fail('COMMITMENT_AMOUNTS_POSITIVE', `${bad.length} commitment(s) with non-positive amount`);
};

// 34. Any fee-offset LP must also have a contribution in the same call.
const feeOffsetLpHasContribution: Check = (ctx) => {
  const contributing = new Set(contributionByLp(ctx.call.allocations).keys());
  const offenders = ctx.call.allocations
    .filter((a) => a.kind === 'fee_offset' && !contributing.has(a.lpId))
    .map((a) => a.lpId);
  return offenders.length === 0
    ? ok('FEE_OFFSET_LP_HAS_CONTRIBUTION', 'fee offsets pair with contributions')
    : fail(
        'FEE_OFFSET_LP_HAS_CONTRIBUTION',
        `fee offset without contribution for: ${[...new Set(offenders)].join(', ')}`,
      );
};

// --------------------------------------------------------------------------
// Registry & runners
// --------------------------------------------------------------------------

export const ALL_CHECKS: Check[] = [
  totalPositive,
  hasAllocations,
  allocSumEqualsTotal,
  allAllocAmountsPositive,
  allocLpExists,
  allocLpInFirm,
  allocLpHasCommitment,
  contribWithinUncalled,
  noOvercallCumulative,
  callCurrencySet,
  allocCurrencyMatchesCall,
  dueOnOrAfterCall,
  dueMeetsNoticePeriod,
  callNotFutureDated,
  numberSequential,
  numberNotDuplicate,
  fundHasActiveCommitment,
  noContributionToInactiveLp,
  recallWithinRecallable,
  feeOffsetWithinContribution,
  noDuplicateLpKind,
  contribGeFeeOffset,
  allActiveCommittedLpsIncluded,
  allocProportionsTrackCommitment,
  purposeNonEmpty,
  commitmentsMatchCallFund,
  callFirmSet,
  contribTotalWithinAggregateUncalled,
  highUtilizationWarn,
  callDateValidIso,
  dueDateValidIso,
  priorCalledNonNegative,
  commitmentAmountsPositive,
  feeOffsetLpHasContribution,
];

/** Run every registered check against the context. */
export function runChecks(ctx: CapitalCallContext): CheckResult[] {
  return ALL_CHECKS.map((check) => check(ctx));
}

/** A call is postable iff no check fails (warnings are advisory). */
export function checksPass(ctx: CapitalCallContext): boolean {
  return !runChecks(ctx).some((r) => r.status === 'fail');
}
