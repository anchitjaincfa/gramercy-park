import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { stakeValueMinor, computePosition, rollupPortfolio } from './ownership';
import type { Investment, CompanyValuation } from './types';

const USD = 'USD';

function investment(overrides: Partial<Investment> = {}): Investment {
  return {
    id: 'inv-1',
    firmId: 'firm-1',
    fundId: 'fund-1',
    companyId: 'co-1',
    instrument: 'preferred',
    costMinor: 1_000_000_00, // $1,000,000
    ownershipBps: 2_000, // 20%
    round: 'Series A',
    date: '2025-01-01',
    currency: USD,
    ...overrides,
  };
}

function valuation(overrides: Partial<CompanyValuation> = {}): CompanyValuation {
  return {
    companyId: 'co-1',
    asOf: '2025-06-30',
    fairValueMinor: 10_000_000_00, // $10,000,000
    currency: USD,
    ...overrides,
  };
}

describe('stakeValueMinor', () => {
  it('takes 20% (2000 bps) of a $10,000,000 company as a $2,000,000 stake', () => {
    expect(stakeValueMinor(2_000, 10_000_000_00, USD)).toBe(2_000_000_00);
  });

  it('is 0 at 0 bps and the whole company at 10000 bps', () => {
    expect(stakeValueMinor(0, 10_000_000_00, USD)).toBe(0);
    expect(stakeValueMinor(10_000, 10_000_000_00, USD)).toBe(10_000_000_00);
  });

  it('rejects out-of-range or non-integer ownershipBps', () => {
    expect(() => stakeValueMinor(-1, 100, USD)).toThrow();
    expect(() => stakeValueMinor(10_001, 100, USD)).toThrow();
    expect(() => stakeValueMinor(1.5, 100, USD)).toThrow();
  });

  it('rejects negative or unsafe fair value', () => {
    expect(() => stakeValueMinor(1_000, -1, USD)).toThrow();
    expect(() => stakeValueMinor(1_000, Number.MAX_SAFE_INTEGER + 1, USD)).toThrow();
  });
});

describe('computePosition', () => {
  it('computes stake, unrealized gain, and MOIC for a 2.0x position', () => {
    const pos = computePosition(investment(), valuation());
    expect(pos.stakeValueMinor).toBe(2_000_000_00); // 20% of $10M = $2M
    expect(pos.unrealizedGainMinor).toBe(2_000_000_00 - 1_000_000_00); // stake − cost = $1M
    expect(pos.moicBps).toBe(20_000); // $2M / $1M = 2.0x = 20000 bps
    expect(pos.investmentId).toBe('inv-1');
    expect(pos.companyId).toBe('co-1');
    expect(pos.currency).toBe(USD);
  });

  it('yields a negative unrealized gain when marked below cost', () => {
    const pos = computePosition(investment({ costMinor: 3_000_000_00 }), valuation());
    expect(pos.stakeValueMinor).toBe(2_000_000_00);
    expect(pos.unrealizedGainMinor).toBe(-1_000_000_00);
    expect(pos.moicBps).toBe(6_667); // round(2M/3M × 10000) = 6667 bps (half-up)
  });

  it('returns moicBps 0 when cost is 0', () => {
    const pos = computePosition(investment({ costMinor: 0 }), valuation());
    expect(pos.moicBps).toBe(0);
    expect(pos.stakeValueMinor).toBe(2_000_000_00);
    expect(pos.unrealizedGainMinor).toBe(2_000_000_00);
  });

  it('throws on currency mismatch', () => {
    expect(() =>
      computePosition(investment({ currency: 'EUR' }), valuation({ currency: USD })),
    ).toThrow(/currency mismatch/i);
  });

  it('throws when the valuation is for a different company', () => {
    expect(() =>
      computePosition(investment({ companyId: 'co-1' }), valuation({ companyId: 'co-2' })),
    ).toThrow(/company mismatch/i);
  });
});

describe('rollupPortfolio', () => {
  it('sums cost, fair value, and gain over positions with valuations', () => {
    const investments: Investment[] = [
      investment({ id: 'inv-1', companyId: 'co-1', ownershipBps: 2_000, costMinor: 1_000_000_00 }),
      investment({ id: 'inv-2', companyId: 'co-2', ownershipBps: 1_000, costMinor: 500_000_00 }),
    ];
    const vals = new Map<string, CompanyValuation>([
      ['co-1', valuation({ companyId: 'co-1', fairValueMinor: 10_000_000_00 })],
      ['co-2', valuation({ companyId: 'co-2', fairValueMinor: 20_000_000_00 })],
    ]);

    const rollup = rollupPortfolio(investments, vals, USD);
    expect(rollup.positions).toHaveLength(2);
    // co-1: 20% of $10M = $2M; co-2: 10% of $20M = $2M
    expect(rollup.totalFairValueMinor).toBe(2_000_000_00 + 2_000_000_00);
    expect(rollup.totalCostMinor).toBe(1_000_000_00 + 500_000_00);
    expect(rollup.totalUnrealizedGainMinor).toBe(
      rollup.totalFairValueMinor - rollup.totalCostMinor,
    );
  });

  it('skips investments whose company has no valuation', () => {
    const investments: Investment[] = [
      investment({ id: 'inv-1', companyId: 'co-1' }),
      investment({ id: 'inv-2', companyId: 'co-missing' }),
    ];
    const vals = new Map<string, CompanyValuation>([['co-1', valuation({ companyId: 'co-1' })]]);

    const rollup = rollupPortfolio(investments, vals, USD);
    expect(rollup.positions.map((p) => p.investmentId)).toEqual(['inv-1']);
  });

  it('throws if an included investment or valuation currency differs', () => {
    const investments: Investment[] = [investment({ currency: 'EUR' })];
    const vals = new Map<string, CompanyValuation>([['co-1', valuation({ currency: 'EUR' })]]);
    expect(() => rollupPortfolio(investments, vals, USD)).toThrow(/currency mismatch/i);
  });
});

describe('properties', () => {
  const safeFair = fc.integer({ min: 0, max: 1_000_000_000_000 });
  const bps = fc.integer({ min: 0, max: 10_000 });

  it('stake value never exceeds fair value and is monotonic in ownershipBps', () => {
    fc.assert(
      fc.property(safeFair, bps, bps, (fair, a, b) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        const sLo = stakeValueMinor(lo, fair, USD);
        const sHi = stakeValueMinor(hi, fair, USD);
        expect(sHi).toBeGreaterThanOrEqual(sLo); // monotonic non-decreasing
        expect(sHi).toBeLessThanOrEqual(fair); // never exceeds fair value
        expect(sLo).toBeGreaterThanOrEqual(0);
      }),
    );
  });

  it('rollup totals equal the sum of per-position values', () => {
    const invArb = fc.record({
      companyId: fc.constantFrom('co-1', 'co-2', 'co-3'),
      ownershipBps: bps,
      costMinor: fc.integer({ min: 0, max: 1_000_000_000 }),
    });

    fc.assert(
      fc.property(fc.array(invArb, { maxLength: 12 }), safeFair, (rows, fair) => {
        const investments: Investment[] = rows.map((r, i) =>
          investment({
            id: `inv-${i}`,
            companyId: r.companyId,
            ownershipBps: r.ownershipBps,
            costMinor: r.costMinor,
          }),
        );
        const vals = new Map<string, CompanyValuation>([
          ['co-1', valuation({ companyId: 'co-1', fairValueMinor: fair })],
          ['co-2', valuation({ companyId: 'co-2', fairValueMinor: fair })],
          ['co-3', valuation({ companyId: 'co-3', fairValueMinor: fair })],
        ]);

        const rollup = rollupPortfolio(investments, vals, USD);
        const sumCost = rollup.positions.reduce((a, p) => a + p.costMinor, 0);
        const sumFair = rollup.positions.reduce((a, p) => a + p.stakeValueMinor, 0);
        const sumGain = rollup.positions.reduce((a, p) => a + p.unrealizedGainMinor, 0);

        expect(rollup.totalCostMinor).toBe(sumCost);
        expect(rollup.totalFairValueMinor).toBe(sumFair);
        expect(rollup.totalUnrealizedGainMinor).toBe(sumGain);
        expect(rollup.totalUnrealizedGainMinor).toBe(sumFair - sumCost);
      }),
    );
  });

  it('moicBps is 0 exactly when cost is 0, positive otherwise for a positive stake', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10_000 }),
        safeFair,
        fc.integer({ min: 0, max: 1_000_000_000 }),
        (ownBps, fair, cost) => {
          const pos = computePosition(
            investment({ ownershipBps: ownBps, costMinor: cost }),
            valuation({ fairValueMinor: fair }),
          );
          if (cost === 0) expect(pos.moicBps).toBe(0);
          else expect(pos.moicBps).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });
});
