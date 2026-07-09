import { describe, expect, it } from 'vitest';
import {
  ALL_CHECKS,
  checksPass,
  runChecks,
  type CapitalCallContext,
  type CheckResult,
} from './checks';

/**
 * Build a fresh, fully valid `CapitalCallContext` on every call so each test
 * can mutate its copy in isolation.
 *
 * Fund `fund1` / firm `firm1`:
 *  - lp1 (active): committed 1,000,000; prior 200,000 -> uncalled 800,000
 *  - lp2 (active): committed   500,000; prior 100,000 -> uncalled 400,000
 *  - lp3 (inactive): committed 300,000; prior 0        -> uncalled 300,000
 *
 * Call #3 draws contributions 80,000 (lp1) + 40,000 (lp2) and a 5,000
 * fee-offset for lp1 -> total 120,000 (totalMinor = total CONTRIBUTIONS).
 * Contribution proportions (2:1) exactly track uncalled proportions (800k:400k).
 */
function validContext(): CapitalCallContext {
  return {
    call: {
      id: 'call-3',
      firmId: 'firm1',
      fundId: 'fund1',
      number: 3,
      callDate: '2026-06-01',
      dueDate: '2026-06-15',
      purpose: 'Follow-on investment in Portfolio Co. A',
      totalMinor: 120_000,
      currency: 'USD',
      allocations: [
        { lpId: 'lp1', amountMinor: 80_000, kind: 'contribution' },
        { lpId: 'lp2', amountMinor: 40_000, kind: 'contribution' },
        { lpId: 'lp1', amountMinor: 5_000, kind: 'fee_offset' },
      ],
    },
    commitments: [
      {
        id: 'c1',
        firmId: 'firm1',
        fundId: 'fund1',
        lpId: 'lp1',
        classId: 'cls1',
        amountMinor: 1_000_000,
        currency: 'USD',
        effectiveDate: '2024-01-01',
        recallableUsedMinor: 0,
      },
      {
        id: 'c2',
        firmId: 'firm1',
        fundId: 'fund1',
        lpId: 'lp2',
        classId: 'cls1',
        amountMinor: 500_000,
        currency: 'USD',
        effectiveDate: '2024-01-01',
        recallableUsedMinor: 0,
      },
      {
        id: 'c3',
        firmId: 'firm1',
        fundId: 'fund1',
        lpId: 'lp3',
        classId: 'cls1',
        amountMinor: 300_000,
        currency: 'USD',
        effectiveDate: '2024-01-01',
        recallableUsedMinor: 0,
      },
    ],
    lpsById: {
      lp1: { id: 'lp1', firmId: 'firm1', name: 'Alpha LP', status: 'active' },
      lp2: { id: 'lp2', firmId: 'firm1', name: 'Beta LP', status: 'active' },
      lp3: { id: 'lp3', firmId: 'firm1', name: 'Gamma LP', status: 'inactive' },
    },
    priorCalledByLp: { lp1: 200_000, lp2: 100_000, lp3: 0 },
    priorCallNumbers: [1, 2],
    noticeDays: 10,
    asOfDate: '2026-07-09',
  };
}

function find(results: CheckResult[], code: string): CheckResult {
  const r = results.find((x) => x.code === code);
  if (r === undefined) throw new Error(`no check result for ${code}`);
  return r;
}

describe('capital-call health checks — valid call', () => {
  it('registers 30+ checks with unique codes', () => {
    expect(ALL_CHECKS.length).toBeGreaterThanOrEqual(30);
    const codes = runChecks(validContext()).map((r) => r.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('returns a result per check and no failures', () => {
    const results = runChecks(validContext());
    expect(results.length).toBe(ALL_CHECKS.length);
    expect(results.length).toBeGreaterThanOrEqual(30);
    expect(results.some((r) => r.status === 'fail')).toBe(false);
    expect(checksPass(validContext())).toBe(true);
  });
});

describe('capital-call health checks — invalid calls', () => {
  it('fails when allocations do not sum to the call total', () => {
    const ctx = validContext();
    ctx.call.totalMinor = 999_999; // allocations still sum to 125,000
    const results = runChecks(ctx);
    expect(find(results, 'ALLOC_SUM_EQUALS_TOTAL').status).toBe('fail');
    expect(checksPass(ctx)).toBe(false);
  });

  it('fails when an LP is over-called beyond its uncalled commitment', () => {
    const ctx = validContext();
    // lp1 uncalled is only 800,000; call 5,000,000.
    ctx.call.allocations = [
      { lpId: 'lp1', amountMinor: 5_000_000, kind: 'contribution' },
      { lpId: 'lp2', amountMinor: 40_000, kind: 'contribution' },
    ];
    ctx.call.totalMinor = 5_040_000;
    const results = runChecks(ctx);
    expect(find(results, 'CONTRIB_WITHIN_UNCALLED').status).toBe('fail');
    expect(find(results, 'NO_OVERCALL_CUMULATIVE').status).toBe('fail');
    expect(checksPass(ctx)).toBe(false);
  });

  it('fails when the due date precedes the call date', () => {
    const ctx = validContext();
    ctx.call.dueDate = '2026-05-01'; // before callDate 2026-06-01
    const results = runChecks(ctx);
    expect(find(results, 'DUE_ON_OR_AFTER_CALL').status).toBe('fail');
    expect(checksPass(ctx)).toBe(false);
  });

  it('fails when an inactive LP is allocated a contribution', () => {
    const ctx = validContext();
    ctx.call.allocations = [
      { lpId: 'lp1', amountMinor: 80_000, kind: 'contribution' },
      { lpId: 'lp2', amountMinor: 40_000, kind: 'contribution' },
      { lpId: 'lp3', amountMinor: 30_000, kind: 'contribution' }, // lp3 inactive
    ];
    ctx.call.totalMinor = 150_000;
    const results = runChecks(ctx);
    expect(find(results, 'NO_CONTRIBUTION_TO_INACTIVE_LP').status).toBe('fail');
    expect(checksPass(ctx)).toBe(false);
  });

  it('fails when the call number is not sequential', () => {
    const ctx = validContext();
    ctx.call.number = 2; // prior calls are [1, 2]
    const results = runChecks(ctx);
    expect(find(results, 'NUMBER_SEQUENTIAL').status).toBe('fail');
    expect(find(results, 'NUMBER_NOT_DUPLICATE').status).toBe('fail');
    expect(checksPass(ctx)).toBe(false);
  });
});
