import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { Account, JournalLineInput } from '@gramercy/ledger';
import { money } from '@gramercy/core';
import type { CapitalAccountBalance } from './types';
import { computeNav, computeNavPerLp } from './nav';

const USD = 'USD';
const ENTITY = 'fund-1';

// --- Chart of accounts for the NAV scenario --------------------------------
const CASH: Account = { id: 'a-cash', entityId: ENTITY, code: '1000', name: 'Cash', type: 'asset' };
const INVESTMENTS: Account = {
  id: 'a-inv',
  entityId: ENTITY,
  code: '1200',
  name: 'Investments',
  type: 'asset',
};
const ACCRUED: Account = {
  id: 'l-accrued',
  entityId: ENTITY,
  code: '2000',
  name: 'Accrued Expenses',
  type: 'liability',
};
const PARTNERS_CAPITAL: Account = {
  id: 'e-cap',
  entityId: ENTITY,
  code: '3000',
  name: "Partners' Capital",
  type: 'equity',
};
const UNREALIZED_GAIN: Account = {
  id: 'e-gain',
  entityId: ENTITY,
  code: '3100',
  name: 'Unrealized Gain',
  type: 'equity',
};

const accounts: ReadonlyMap<string, Account> = new Map(
  [CASH, INVESTMENTS, ACCRUED, PARTNERS_CAPITAL, UNREALIZED_GAIN].map((a) => [a.id, a]),
);

type Line = JournalLineInput & { entityId: string };
const line = (accountId: string, side: 'debit' | 'credit', amt: number): Line => ({
  accountId,
  side,
  amount: money(amt, USD),
  entityId: ENTITY,
});

describe('computeNav', () => {
  it('reads NAV = assets − liabilities from the posted GL', () => {
    // Contribution: debit Cash 1,000,000 / credit Partners' Capital 1,000,000.
    // Unrealized gain: debit Investments 200,000 / credit Unrealized Gain 200,000.
    const lines: Line[] = [
      line(CASH.id, 'debit', 1_000_000),
      line(PARTNERS_CAPITAL.id, 'credit', 1_000_000),
      line(INVESTMENTS.id, 'debit', 200_000),
      line(UNREALIZED_GAIN.id, 'credit', 200_000),
    ];

    // assets = 1,000,000 (cash) + 200,000 (investments) = 1,200,000; liabilities = 0.
    expect(computeNav(lines, accounts, USD)).toBe(1_200_000);
  });

  it('a liability reduces NAV', () => {
    const base: Line[] = [
      line(CASH.id, 'debit', 1_000_000),
      line(PARTNERS_CAPITAL.id, 'credit', 1_000_000),
      line(INVESTMENTS.id, 'debit', 200_000),
      line(UNREALIZED_GAIN.id, 'credit', 200_000),
    ];
    // Accrue a 50,000 expense: debit Unrealized Gain (equity) / credit Accrued (liability).
    const withLiability: Line[] = [
      ...base,
      line(UNREALIZED_GAIN.id, 'debit', 50_000),
      line(ACCRUED.id, 'credit', 50_000),
    ];

    // Assets unchanged (1,200,000); liabilities now 50,000 → NAV = 1,150,000.
    expect(computeNav(withLiability, accounts, USD)).toBe(1_150_000);
    expect(computeNav(withLiability, accounts, USD)).toBeLessThan(computeNav(base, accounts, USD));
  });

  it('returns 0 for no lines', () => {
    expect(computeNav([], accounts, USD)).toBe(0);
  });
});

// Build a CapitalAccountBalance with a given balanceMinor (other fields nominal).
const cap = (lpId: string, balanceMinor: number): CapitalAccountBalance => ({
  lpId,
  contributedMinor: Math.max(0, balanceMinor),
  distributedMinor: 0,
  feesMinor: 0,
  allocatedPnlMinor: balanceMinor < 0 ? balanceMinor : 0,
  balanceMinor,
});

describe('computeNavPerLp', () => {
  it('allocates pro-rata and sums exactly to the total', () => {
    const caps = new Map<string, CapitalAccountBalance>([
      ['lp-a', cap('lp-a', 600_000)],
      ['lp-b', cap('lp-b', 400_000)],
    ]);
    const shares = computeNavPerLp(1_000_000, caps, USD);
    expect(shares).toEqual([
      { lpId: 'lp-a', navShareMinor: 600_000 },
      { lpId: 'lp-b', navShareMinor: 400_000 },
    ]);
  });

  it('clamps negative balances to zero weight and omits zero shares', () => {
    const caps = new Map<string, CapitalAccountBalance>([
      ['lp-a', cap('lp-a', 100)],
      ['lp-b', cap('lp-b', -500)], // negative → no share
      ['lp-c', cap('lp-c', 0)], // zero → no share
    ]);
    const shares = computeNavPerLp(1_000, caps, USD);
    expect(shares).toEqual([{ lpId: 'lp-a', navShareMinor: 1_000 }]);
  });

  it('breaks ties canonically by ascending lpId', () => {
    // Equal weights, an odd total → exactly one extra unit goes to the lowest lpId.
    const caps = new Map<string, CapitalAccountBalance>([
      // Deliberately non-sorted insertion order.
      ['lp-z', cap('lp-z', 100)],
      ['lp-a', cap('lp-a', 100)],
      ['lp-m', cap('lp-m', 100)],
    ]);
    const shares = computeNavPerLp(10, caps, USD);
    // 10 across three equal weights → 4/3/3; the extra unit goes to lp-a.
    expect(shares).toEqual([
      { lpId: 'lp-a', navShareMinor: 4 },
      { lpId: 'lp-m', navShareMinor: 3 },
      { lpId: 'lp-z', navShareMinor: 3 },
    ]);
  });

  it('returns [] when totalNavMinor is 0', () => {
    const caps = new Map<string, CapitalAccountBalance>([['lp-a', cap('lp-a', 100)]]);
    expect(computeNavPerLp(0, caps, USD)).toEqual([]);
  });

  it('throws when there is NAV to distribute but no positive weight (Codex Gate 2c.1)', () => {
    // Positive NAV but every LP balance <= 0 → an unreconciled snapshot; must throw.
    const caps = new Map<string, CapitalAccountBalance>([
      ['lp-a', cap('lp-a', 0)],
      ['lp-b', cap('lp-b', -100)],
    ]);
    expect(() => computeNavPerLp(1_000, caps, USD)).toThrow(/positive capital balance/);
  });

  it('rejects a negative totalNavMinor', () => {
    const caps = new Map<string, CapitalAccountBalance>([['lp-a', cap('lp-a', 100)]]);
    expect(() => computeNavPerLp(-1, caps, USD)).toThrow();
  });

  it('property: shares always sum to totalNavMinor when positive weight exists', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000_000 }),
        fc.array(
          fc.record({
            lpId: fc.string({ minLength: 1, maxLength: 6 }),
            balanceMinor: fc.integer({ min: -1_000_000, max: 1_000_000 }),
          }),
          { minLength: 1, maxLength: 12 },
        ),
        (totalNavMinor, rawLps) => {
          // Dedupe by lpId (a Map would collapse them anyway).
          const caps = new Map<string, CapitalAccountBalance>();
          for (const { lpId, balanceMinor } of rawLps) {
            caps.set(lpId, cap(lpId, balanceMinor));
          }
          const positiveWeight = [...caps.values()].some((c) => c.balanceMinor > 0);

          if (totalNavMinor === 0) {
            expect(computeNavPerLp(totalNavMinor, caps, USD)).toEqual([]);
          } else if (!positiveWeight) {
            // NAV to distribute but nothing to distribute it against → throws.
            expect(() => computeNavPerLp(totalNavMinor, caps, USD)).toThrow();
          } else {
            const shares = computeNavPerLp(totalNavMinor, caps, USD);
            const sum = shares.reduce((acc, s) => acc + s.navShareMinor, 0);
            expect(sum).toBe(totalNavMinor);
            // No zero shares, and canonical ascending lpId order.
            expect(shares.every((s) => s.navShareMinor !== 0)).toBe(true);
            const ids = shares.map((s) => s.lpId);
            expect(ids).toEqual([...ids].sort());
          }
        },
      ),
    );
  });
});
