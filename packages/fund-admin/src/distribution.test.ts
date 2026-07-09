import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { accountsById, validateBatch, type Account } from '@gramercy/ledger';
import { isOk } from '@gramercy/core';
import { allocateDistribution, buildDistributionBatch } from './distribution';
import type { Distribution } from './types';

describe('allocateDistribution', () => {
  it('allocates pro-rata to LP weights (capital balances)', () => {
    const result = allocateDistribution(1_000_000, 'USD', [
      { lpId: 'lp-a', weightMinor: 3_000_000 },
      { lpId: 'lp-b', weightMinor: 1_000_000 },
    ]);
    // 3:1 split of 1,000,000 -> 750,000 / 250,000
    expect(result).toEqual([
      { lpId: 'lp-a', amountMinor: 750_000 },
      { lpId: 'lp-b', amountMinor: 250_000 },
    ]);
  });

  it('omits LPs with zero weight', () => {
    const result = allocateDistribution(1000, 'USD', [
      { lpId: 'lp-a', weightMinor: 1000 },
      { lpId: 'lp-b', weightMinor: 0 },
    ]);
    expect(result).toEqual([{ lpId: 'lp-a', amountMinor: 1000 }]);
  });

  it('assigns leftover cents deterministically (largest-remainder, lowest index)', () => {
    // 100 minor units split evenly across 3 -> 34, 33, 33 (sums to 100)
    const result = allocateDistribution(100, 'USD', [
      { lpId: 'lp-a', weightMinor: 1 },
      { lpId: 'lp-b', weightMinor: 1 },
      { lpId: 'lp-c', weightMinor: 1 },
    ]);
    expect(result.map((r) => r.amountMinor)).toEqual([34, 33, 33]);
    expect(result.reduce((s, r) => s + r.amountMinor, 0)).toBe(100);
  });

  it('tie-break is canonical by lpId, independent of input order', () => {
    // Same equal-weight split, but LPs passed in reverse order. The leftover
    // cent must still go to the lowest lpId (lp-a), not the first input.
    const result = allocateDistribution(100, 'USD', [
      { lpId: 'lp-c', weightMinor: 1 },
      { lpId: 'lp-b', weightMinor: 1 },
      { lpId: 'lp-a', weightMinor: 1 },
    ]);
    const byLp = Object.fromEntries(result.map((r) => [r.lpId, r.amountMinor]));
    expect(byLp).toEqual({ 'lp-a': 34, 'lp-b': 33, 'lp-c': 33 });
    // lowest lpId gets the crumb
    expect(byLp['lp-a']).toBe(34);
  });

  it('throws when every LP weight is zero', () => {
    expect(() =>
      allocateDistribution(1000, 'USD', [
        { lpId: 'lp-a', weightMinor: 0 },
        { lpId: 'lp-b', weightMinor: 0 },
      ]),
    ).toThrow();
  });

  it('throws when there are no LPs', () => {
    expect(() => allocateDistribution(1000, 'USD', [])).toThrow();
  });

  it('throws on a non-positive total', () => {
    expect(() => allocateDistribution(0, 'USD', [{ lpId: 'lp-a', weightMinor: 1 }])).toThrow();
  });

  it('property: returned allocations always sum exactly to totalMinor', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000_000 }),
        fc.array(fc.nat({ max: 10_000_000 }), { minLength: 1, maxLength: 25 }),
        (totalMinor, weights) => {
          fc.pre(weights.some((w) => w > 0)); // guard case is tested separately
          const perLp = weights.map((w, i) => ({ lpId: `lp-${i}`, weightMinor: w }));
          const result = allocateDistribution(totalMinor, 'USD', perLp);
          const sum = result.reduce((s, r) => s + r.amountMinor, 0);
          expect(sum).toBe(totalMinor);
          // no zero allocations are emitted
          expect(result.every((r) => r.amountMinor !== 0)).toBe(true);
        },
      ),
    );
  });
});

const FUND_ID = 'fund-1';
const CASH = 'acct-cash';
const CAPITAL = 'acct-capital';

const accounts: Account[] = [
  { id: CASH, entityId: FUND_ID, code: '1000', name: 'Cash', type: 'asset' },
  { id: CAPITAL, entityId: FUND_ID, code: '3000', name: "Partners' Capital", type: 'equity' },
];

const sampleDist: Distribution = {
  id: 'd-1',
  firmId: 'firm-1',
  fundId: FUND_ID,
  number: 1,
  date: '2026-03-31',
  kind: 'return_of_capital',
  recallable: true,
  totalMinor: 1_000_000,
  currency: 'USD',
  allocations: [
    { lpId: 'lp-a', amountMinor: 750_000 },
    { lpId: 'lp-b', amountMinor: 250_000 },
  ],
};

describe('buildDistributionBatch', () => {
  it('produces a batch that passes ledger validation', () => {
    const batch = buildDistributionBatch(sampleDist, {
      cashAccountId: CASH,
      capitalAccountId: CAPITAL,
    });
    const result = validateBatch(batch, accountsById(accounts));
    expect(isOk(result)).toBe(true);
    expect(result.ok).toBe(true);
  });

  it('is balanced: debits equal credits', () => {
    const batch = buildDistributionBatch(sampleDist, {
      cashAccountId: CASH,
      capitalAccountId: CAPITAL,
    });
    const lines = batch.journals[0]!.lines;
    const debits = lines.filter((l) => l.side === 'debit').reduce((s, l) => s + l.amount.amount, 0);
    const credits = lines
      .filter((l) => l.side === 'credit')
      .reduce((s, l) => s + l.amount.amount, 0);
    expect(debits).toBe(credits);
    expect(debits).toBe(1_000_000);
  });

  it('debits capital and credits cash (cash flows OUT)', () => {
    const batch = buildDistributionBatch(sampleDist, {
      cashAccountId: CASH,
      capitalAccountId: CAPITAL,
    });
    const lines = batch.journals[0]!.lines;
    expect(lines.every((l) => (l.side === 'debit' ? l.accountId === CAPITAL : true))).toBe(true);
    expect(lines.every((l) => (l.side === 'credit' ? l.accountId === CASH : true))).toBe(true);
  });

  it('sets metadata: idempotencyKey, sourceType default, sourceId, date, memo', () => {
    const batch = buildDistributionBatch(sampleDist, {
      cashAccountId: CASH,
      capitalAccountId: CAPITAL,
    });
    expect(batch.idempotencyKey).toBe('dist:d-1');
    expect(batch.sourceType).toBe('distribution');
    expect(batch.sourceId).toBe('d-1');
    expect(batch.date).toBe('2026-03-31');
    expect(batch.memo).toContain('return_of_capital');
    expect(batch.memo).toContain('1');
    expect(batch.journals[0]!.entityId).toBe(FUND_ID);
  });

  it('honors a custom sourceType', () => {
    const batch = buildDistributionBatch(sampleDist, {
      cashAccountId: CASH,
      capitalAccountId: CAPITAL,
      sourceType: 'custom_source',
    });
    expect(batch.sourceType).toBe('custom_source');
  });

  it('throws when there are no allocations to post', () => {
    expect(() =>
      buildDistributionBatch(
        { ...sampleDist, allocations: [] },
        { cashAccountId: CASH, capitalAccountId: CAPITAL },
      ),
    ).toThrow();
  });

  it('throws when allocations do not sum to totalMinor (Codex Gate 2b.1)', () => {
    // allocations sum 1,000,000 but declared total is 1,000,001 -> must throw,
    // not silently under-post.
    expect(() =>
      buildDistributionBatch(
        { ...sampleDist, totalMinor: 1_000_001 },
        { cashAccountId: CASH, capitalAccountId: CAPITAL },
      ),
    ).toThrow(/!=|sum/i);
  });

  it('throws when cash and capital accounts are the same (Codex Gate 2b.1)', () => {
    expect(() =>
      buildDistributionBatch(sampleDist, { cashAccountId: CASH, capitalAccountId: CASH }),
    ).toThrow(/differ/);
  });
});
