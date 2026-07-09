import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { allocateCapitalCall } from './allocation';

describe('allocateCapitalCall', () => {
  it('allocates pro-rata to uncalled commitments', () => {
    const result = allocateCapitalCall(1_000_000, 'USD', [
      { lpId: 'lp-a', uncalledMinor: 3_000_000 },
      { lpId: 'lp-b', uncalledMinor: 1_000_000 },
    ]);
    // 3:1 split of 1,000,000 -> 750,000 / 250,000
    expect(result).toEqual([
      { lpId: 'lp-a', amountMinor: 750_000, kind: 'contribution' },
      { lpId: 'lp-b', amountMinor: 250_000, kind: 'contribution' },
    ]);
  });

  it('omits LPs with zero uncalled commitment', () => {
    const result = allocateCapitalCall(1000, 'USD', [
      { lpId: 'lp-a', uncalledMinor: 1000 },
      { lpId: 'lp-b', uncalledMinor: 0 },
    ]);
    expect(result).toEqual([{ lpId: 'lp-a', amountMinor: 1000, kind: 'contribution' }]);
  });

  it('assigns leftover cents deterministically (largest-remainder, lowest index)', () => {
    // 100 minor units split evenly across 3 -> 34, 33, 33 (sums to 100)
    const result = allocateCapitalCall(100, 'USD', [
      { lpId: 'lp-a', uncalledMinor: 1 },
      { lpId: 'lp-b', uncalledMinor: 1 },
      { lpId: 'lp-c', uncalledMinor: 1 },
    ]);
    expect(result.map((r) => r.amountMinor)).toEqual([34, 33, 33]);
    expect(result.reduce((s, r) => s + r.amountMinor, 0)).toBe(100);
  });

  it('tie-break is canonical by lpId, independent of input order (Codex Gate 2a.1)', () => {
    // Same equal-weight split, but LPs passed in reverse order. The leftover
    // cent must still go to the lowest lpId (lp-a), not the first input.
    const result = allocateCapitalCall(100, 'USD', [
      { lpId: 'lp-c', uncalledMinor: 1 },
      { lpId: 'lp-b', uncalledMinor: 1 },
      { lpId: 'lp-a', uncalledMinor: 1 },
    ]);
    const byLp = Object.fromEntries(result.map((r) => [r.lpId, r.amountMinor]));
    expect(byLp).toEqual({ 'lp-a': 34, 'lp-b': 33, 'lp-c': 33 });
  });

  it('throws when every LP is fully called (all uncalled === 0)', () => {
    expect(() =>
      allocateCapitalCall(1000, 'USD', [
        { lpId: 'lp-a', uncalledMinor: 0 },
        { lpId: 'lp-b', uncalledMinor: 0 },
      ]),
    ).toThrow();
  });

  it('throws when there are no LPs', () => {
    expect(() => allocateCapitalCall(1000, 'USD', [])).toThrow();
  });

  it('property: returned allocations always sum exactly to totalMinor', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000_000 }),
        fc.array(fc.nat({ max: 10_000_000 }), { minLength: 1, maxLength: 25 }),
        (totalMinor, uncalled) => {
          fc.pre(uncalled.some((u) => u > 0)); // guard case is tested separately
          const perLp = uncalled.map((u, i) => ({ lpId: `lp-${i}`, uncalledMinor: u }));
          const result = allocateCapitalCall(totalMinor, 'USD', perLp);
          const sum = result.reduce((s, r) => s + r.amountMinor, 0);
          expect(sum).toBe(totalMinor);
          // no zero allocations are emitted
          expect(result.every((r) => r.amountMinor !== 0)).toBe(true);
        },
      ),
    );
  });
});
