import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { computeMgmtFee, computeMgmtFeePerLp, periodMgmtFees, periodsPerYear } from './fees';
import type { MgmtFeeSchedule } from './types';

const schedule = (overrides: Partial<MgmtFeeSchedule> = {}): MgmtFeeSchedule => ({
  id: 'sched-1',
  firmId: 'firm-1',
  fundId: 'fund-1',
  classId: 'class-1',
  rateBps: 200,
  basis: 'committed',
  frequency: 'quarterly',
  ...overrides,
});

describe('per-period fee does not over/under-charge across a year (Codex Gate 2b.1)', () => {
  it('billing every period sums to the exact annual fee, even with a 1-cent crumb', () => {
    // Annual fee of 1 cent, quarterly: periods must be [1,0,0,0], summing to 1
    // (NOT 1 per quarter = 4). basis 200 @ 1bp = 0.02 -> rounds to 0 annual; use
    // a basis that yields exactly 1 cent/yr: 50 minor @ 200bps = 1.
    const s = schedule({ rateBps: 200, frequency: 'quarterly' });
    const periods = periodMgmtFees(s, 50, 'USD');
    expect(periods.reduce((a, b) => a + b, 0)).toBe(1);
    const billed = [0, 1, 2, 3].map((i) => computeMgmtFee(s, 50, 'USD', i));
    expect(billed.reduce((a, b) => a + b, 0)).toBe(1);
    expect(billed).toEqual(periods);
  });
});

describe('periodsPerYear', () => {
  it('maps each frequency to its period count', () => {
    expect(periodsPerYear('quarterly')).toBe(4);
    expect(periodsPerYear('semiannual')).toBe(2);
    expect(periodsPerYear('annual')).toBe(1);
  });
});

describe('computeMgmtFee', () => {
  it('2% (200 bps) annual on 10,000,000 minor, quarterly = 50,000/period', () => {
    expect(computeMgmtFee(schedule({ frequency: 'quarterly' }), 10_000_000, 'USD')).toBe(50_000);
  });

  it('annual frequency charges the full annual fee in one period', () => {
    expect(computeMgmtFee(schedule({ frequency: 'annual' }), 10_000_000, 'USD')).toBe(200_000);
  });

  it('semiannual frequency charges half the annual fee', () => {
    expect(computeMgmtFee(schedule({ frequency: 'semiannual' }), 10_000_000, 'USD')).toBe(100_000);
  });

  it('the periods over a year sum to the exact annual fee (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2_000_000_000 }),
        fc.integer({ min: 0, max: 5_000 }),
        fc.constantFrom('quarterly', 'semiannual', 'annual'),
        (basis, rateBps, frequency) => {
          const sch = schedule({ rateBps, frequency: frequency as MgmtFeeSchedule['frequency'] });
          const annualFee = Math.round((basis * rateBps) / 10_000);
          const n = periodsPerYear(sch.frequency);
          const periodFee = computeMgmtFee(sch, basis, 'USD');
          // allocate hands leftover crumbs to the lowest index first, so the
          // first period is floor(annual/n) plus one crumb iff there is a
          // remainder. The n periods therefore total exactly annualFee.
          const floor = Math.floor(annualFee / n);
          const remainder = annualFee % n;
          const expectedFirst = floor + (remainder > 0 ? 1 : 0);
          expect(periodFee).toBe(expectedFirst);
          // Reconstruct the whole year and confirm it sums to the annual fee.
          const periods = Array.from({ length: n }, (_, i) => floor + (i < remainder ? 1 : 0));
          expect(periods.reduce((s, p) => s + p, 0)).toBe(annualFee);
          expect(periods[0]).toBe(periodFee);
        },
      ),
    );
  });

  it('rejects a non-integer basis', () => {
    expect(() => computeMgmtFee(schedule(), 1.5, 'USD')).toThrow();
  });

  it('rejects a negative basis', () => {
    expect(() => computeMgmtFee(schedule(), -1, 'USD')).toThrow();
  });

  it('rejects a negative rateBps', () => {
    expect(() => computeMgmtFee(schedule({ rateBps: -1 }), 10_000_000, 'USD')).toThrow();
  });
});

describe('computeMgmtFeePerLp', () => {
  it('splits the fund period fee pro-rata to basis', () => {
    const result = computeMgmtFeePerLp(
      schedule({ frequency: 'quarterly' }),
      [
        { lpId: 'lp-a', basisMinor: 7_500_000 },
        { lpId: 'lp-b', basisMinor: 2_500_000 },
      ],
      'USD',
    );
    // Fund period fee on 10,000,000 @ 200bps quarterly = 50,000; 3:1 split.
    expect(result).toEqual([
      { lpId: 'lp-a', feeMinor: 37_500 },
      { lpId: 'lp-b', feeMinor: 12_500 },
    ]);
  });

  it('returns [] when the aggregate basis is 0', () => {
    expect(
      computeMgmtFeePerLp(
        schedule(),
        [
          { lpId: 'lp-a', basisMinor: 0 },
          { lpId: 'lp-b', basisMinor: 0 },
        ],
        'USD',
      ),
    ).toEqual([]);
  });

  it('returns [] when perLp is empty', () => {
    expect(computeMgmtFeePerLp(schedule(), [], 'USD')).toEqual([]);
  });

  it('omits zero-fee LPs but keeps the sum exact', () => {
    const result = computeMgmtFeePerLp(
      schedule({ frequency: 'annual' }),
      [
        { lpId: 'lp-a', basisMinor: 10_000_000 },
        { lpId: 'lp-b', basisMinor: 0 },
      ],
      'USD',
    );
    expect(result).toEqual([{ lpId: 'lp-a', feeMinor: 200_000 }]);
  });

  it('tie-break is canonical by lpId, independent of input order', () => {
    const result = computeMgmtFeePerLp(
      schedule({ frequency: 'annual', rateBps: 10_000 }), // 100% -> fee == basis
      [
        { lpId: 'lp-c', basisMinor: 1 },
        { lpId: 'lp-b', basisMinor: 1 },
        { lpId: 'lp-a', basisMinor: 1 },
      ],
      'USD',
    );
    // Fund fee = 3 on aggregate basis 3, split 1/1/1 evenly -> 1 each.
    const byLp = Object.fromEntries(result.map((r) => [r.lpId, r.feeMinor]));
    expect(byLp).toEqual({ 'lp-a': 1, 'lp-b': 1, 'lp-c': 1 });
  });

  it('property: per-LP fees always sum to the fund period fee on the aggregate basis', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            lpId: fc.string({ minLength: 1, maxLength: 8 }),
            basisMinor: fc.integer({ min: 0, max: 500_000_000 }),
          }),
          { minLength: 1, maxLength: 12 },
        ),
        fc.integer({ min: 0, max: 5_000 }),
        fc.constantFrom('quarterly', 'semiannual', 'annual'),
        (rawLps, rateBps, frequency) => {
          // Dedupe lpIds so allocation weights map 1:1 to inputs.
          const seen = new Set<string>();
          const perLp = rawLps.filter((p) => {
            if (seen.has(p.lpId)) return false;
            seen.add(p.lpId);
            return true;
          });
          const sch = schedule({ rateBps, frequency: frequency as MgmtFeeSchedule['frequency'] });
          const aggregateBasis = perLp.reduce((s, p) => s + p.basisMinor, 0);

          const result = computeMgmtFeePerLp(sch, perLp, 'USD');
          const sum = result.reduce((s, r) => s + r.feeMinor, 0);

          if (aggregateBasis === 0) {
            expect(result).toEqual([]);
          } else {
            expect(sum).toBe(computeMgmtFee(sch, aggregateBasis, 'USD'));
          }
          // No zero fees leak through.
          expect(result.every((r) => r.feeMinor > 0)).toBe(true);
        },
      ),
    );
  });
});
