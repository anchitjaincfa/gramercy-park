import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  money,
  add,
  sub,
  negate,
  sumMoney,
  allocate,
  allocateEven,
  applyBps,
  equals,
} from './money';

describe('Money arithmetic', () => {
  it('rejects non-integer amounts', () => {
    expect(() => money(1.5, 'USD')).toThrow(/integer/);
  });

  it('rejects currency mismatch on add/sub', () => {
    expect(() => add(money(1, 'USD'), money(1, 'EUR'))).toThrow(/mismatch/i);
    expect(() => sub(money(1, 'USD'), money(1, 'EUR'))).toThrow(/mismatch/i);
  });

  it('add and sub are inverse', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer(), (a, b) => {
        const x = money(a, 'USD');
        const y = money(b, 'USD');
        expect(equals(sub(add(x, y), y), x)).toBe(true);
      }),
    );
  });

  it('negate is its own inverse', () => {
    fc.assert(
      fc.property(fc.integer(), (a) => {
        expect(equals(negate(negate(money(a, 'USD'))), money(a, 'USD'))).toBe(true);
      }),
    );
  });
});

describe('allocate — largest-remainder', () => {
  it('parts always sum exactly to the whole (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000_000, max: 1_000_000_000 }),
        fc.array(fc.integer({ min: 0, max: 1000 }), { minLength: 1, maxLength: 25 }),
        (total, weights) => {
          fc.pre(weights.some((w) => w > 0)); // skip all-zero weight vectors
          const parts = allocate(money(total, 'USD'), weights);
          const summed = sumMoney(parts, 'USD');
          expect(summed.amount).toBe(total);
          expect(parts.length).toBe(weights.length);
        },
      ),
    );
  });

  it('preserves sign: every part matches the sign of the total', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000, max: 1_000_000 }),
        fc.array(fc.integer({ min: 0, max: 100 }), { minLength: 1, maxLength: 10 }),
        (total, weights) => {
          fc.pre(weights.some((w) => w > 0));
          const parts = allocate(money(total, 'USD'), weights);
          for (const p of parts) {
            if (total >= 0) expect(p.amount).toBeGreaterThanOrEqual(0);
            else expect(p.amount).toBeLessThanOrEqual(0);
          }
        },
      ),
    );
  });

  it('deterministic tie-break gives lower indices the extra unit first', () => {
    // 10 cents across three equal weights -> 4,3,3 (index 0 gets the odd cent).
    const parts = allocate(money(10, 'USD'), [1, 1, 1]);
    expect(parts.map((p) => p.amount)).toEqual([4, 3, 3]);
  });

  it('is stable/deterministic across repeated calls', () => {
    const a = allocate(money(100, 'USD'), [3, 3, 3, 1]).map((p) => p.amount);
    const b = allocate(money(100, 'USD'), [3, 3, 3, 1]).map((p) => p.amount);
    expect(a).toEqual(b);
  });

  it('throws on empty or all-zero weights', () => {
    expect(() => allocate(money(100, 'USD'), [])).toThrow();
    expect(() => allocate(money(100, 'USD'), [0, 0])).toThrow();
  });

  it('places the leftover cent exactly at near-2^53 scale (Decimal precision fix)', () => {
    // Exact largest-remainder reference computed in BigInt (no floating error).
    // The default 20-significant-digit Decimal truncates `total×weight/sum` here
    // (operands are ~16 digits, the product ~32), mis-assigning the leftover.
    const bigAllocate = (total: bigint, weights: bigint[]): number[] => {
      const sum = weights.reduce((a, b) => a + b, 0n);
      const bases = weights.map((w) => (total * w) / sum);
      const out = [...bases];
      let leftover = total - bases.reduce((a, b) => a + b, 0n);
      const order = weights
        .map((w, i) => ({ i, rem: (total * w) % sum }))
        .sort((a, b) => (a.rem === b.rem ? a.i - b.i : a.rem < b.rem ? 1 : -1));
      for (const { i } of order) {
        if (leftover <= 0n) break;
        out[i] = out[i]! + 1n;
        leftover -= 1n;
      }
      return out.map((n) => Number(n));
    };

    const total = 9_007_199_254_740_991; // Number.MAX_SAFE_INTEGER
    const weightsBig = [3_000_000_000_000_001n, 3_000_000_000_000_000n, 3_007_199_254_740_990n];
    const weights = weightsBig.map((w) => w.toString()); // exact string weights
    const parts = allocate(money(total, 'USD'), weights).map((p) => p.amount);

    expect(parts.reduce((a, b) => a + b, 0)).toBe(total); // no cent lost
    expect(parts).toEqual(bigAllocate(BigInt(total), weightsBig)); // exact placement
  });

  it('allocateEven splits and sums to the whole', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000, max: 1_000_000 }),
        fc.integer({ min: 1, max: 50 }),
        (total, n) => {
          const parts = allocateEven(money(total, 'USD'), n);
          expect(sumMoney(parts, 'USD').amount).toBe(total);
        },
      ),
    );
  });
});

describe('applyBps', () => {
  it('computes basis points with half-up rounding', () => {
    expect(applyBps(money(1_000_000, 'USD'), 200).amount).toBe(20_000); // 2% of $10,000.00
    expect(applyBps(money(101, 'USD'), 50).amount).toBe(1); // 0.5% of 101c = 0.505 -> 1
  });

  it('rejects non-finite bps', () => {
    expect(() => applyBps(money(100, 'USD'), Infinity)).toThrow(/finite/);
  });
});

describe('safe-integer boundary (Codex Gate 1.1)', () => {
  it('accepts MAX_SAFE_INTEGER but rejects 2**53 and beyond', () => {
    expect(money(Number.MAX_SAFE_INTEGER, 'USD').amount).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => money(2 ** 53, 'USD')).toThrow(/safe integer/);
    expect(() => money(-(2 ** 53), 'USD')).toThrow(/safe integer/);
  });

  it('rejects arithmetic results that overflow the safe range instead of losing a cent', () => {
    expect(() => add(money(Number.MAX_SAFE_INTEGER, 'USD'), money(1, 'USD'))).toThrow(
      /safe integer/,
    );
  });

  it('allocate accepts exact string/Decimal weights', () => {
    const parts = allocate(money(100, 'USD'), ['1', '2', '1']);
    expect(parts.map((p) => p.amount)).toEqual([25, 50, 25]);
    expect(sumMoney(parts, 'USD').amount).toBe(100);
  });
});
