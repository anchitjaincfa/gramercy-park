import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { CapitalAccountEvent, CapitalAccountEventKind } from './types';
import { buildCapitalAccounts, capitalAccountBalance, totalFundCapital } from './capital-account';

describe('buildCapitalAccounts — worked scenario', () => {
  it('folds contribution, pnl, fee and distribution into the right fields', () => {
    // An LP contributes 1,000,000; is allocated +200,000 P&L; charged a 20,000
    // management fee; receives a 150,000 distribution.
    // balance = 1,000,000 − 150,000 − 20,000 + 200,000 = 1,030,000.
    const events: CapitalAccountEvent[] = [
      { lpId: 'lp-a', date: '2026-01-15', kind: 'contribution', amountMinor: 1_000_000 },
      { lpId: 'lp-a', date: '2026-03-31', kind: 'pnl_allocation', amountMinor: 200_000 },
      { lpId: 'lp-a', date: '2026-04-01', kind: 'mgmt_fee', amountMinor: 20_000 },
      { lpId: 'lp-a', date: '2026-06-30', kind: 'distribution', amountMinor: 150_000 },
    ];

    const accounts = buildCapitalAccounts(events);
    const acc = accounts.get('lp-a');

    expect(acc).toEqual({
      lpId: 'lp-a',
      contributedMinor: 1_000_000,
      distributedMinor: 150_000,
      feesMinor: 20_000,
      allocatedPnlMinor: 200_000,
      balanceMinor: 1_030_000,
    });
    expect(totalFundCapital(accounts)).toBe(1_030_000);
  });

  it('is order-independent: shuffled input yields the same balance', () => {
    const ordered: CapitalAccountEvent[] = [
      { lpId: 'lp-a', date: '2026-01-15', kind: 'contribution', amountMinor: 1_000_000 },
      { lpId: 'lp-a', date: '2026-03-31', kind: 'pnl_allocation', amountMinor: 200_000 },
      { lpId: 'lp-a', date: '2026-04-01', kind: 'mgmt_fee', amountMinor: 20_000 },
      { lpId: 'lp-a', date: '2026-06-30', kind: 'distribution', amountMinor: 150_000 },
    ];
    const shuffled = [ordered[3]!, ordered[0]!, ordered[2]!, ordered[1]!];
    expect(buildCapitalAccounts(shuffled).get('lp-a')).toEqual(
      buildCapitalAccounts(ordered).get('lp-a'),
    );
  });
});

describe('buildCapitalAccounts — multiple LPs', () => {
  it('keeps each LP isolated and totals across LPs', () => {
    const events: CapitalAccountEvent[] = [
      { lpId: 'lp-a', date: '2026-01-01', kind: 'contribution', amountMinor: 500_000 },
      { lpId: 'lp-b', date: '2026-01-01', kind: 'contribution', amountMinor: 300_000 },
      { lpId: 'lp-a', date: '2026-02-01', kind: 'pnl_allocation', amountMinor: 50_000 },
      { lpId: 'lp-b', date: '2026-02-01', kind: 'mgmt_fee', amountMinor: 10_000 },
      { lpId: 'lp-b', date: '2026-03-01', kind: 'distribution', amountMinor: 20_000 },
    ];

    const accounts = buildCapitalAccounts(events);
    expect(accounts.size).toBe(2);

    expect(accounts.get('lp-a')).toEqual({
      lpId: 'lp-a',
      contributedMinor: 500_000,
      distributedMinor: 0,
      feesMinor: 0,
      allocatedPnlMinor: 50_000,
      balanceMinor: 550_000,
    });
    // lp-b: 300,000 − 20,000 − 10,000 + 0 = 270,000
    expect(accounts.get('lp-b')).toEqual({
      lpId: 'lp-b',
      contributedMinor: 300_000,
      distributedMinor: 20_000,
      feesMinor: 10_000,
      allocatedPnlMinor: 0,
      balanceMinor: 270_000,
    });

    expect(totalFundCapital(accounts)).toBe(820_000);
  });
});

describe('negative P&L (loss allocation)', () => {
  it('subtracts a loss from the balance', () => {
    const events: CapitalAccountEvent[] = [
      { lpId: 'lp-a', date: '2026-01-01', kind: 'contribution', amountMinor: 1_000_000 },
      { lpId: 'lp-a', date: '2026-02-01', kind: 'pnl_allocation', amountMinor: -300_000 },
    ];
    const acc = buildCapitalAccounts(events).get('lp-a')!;
    expect(acc.allocatedPnlMinor).toBe(-300_000);
    expect(acc.balanceMinor).toBe(700_000);
  });

  it('a loss can drive a capital account negative', () => {
    const events: CapitalAccountEvent[] = [
      { lpId: 'lp-a', date: '2026-01-01', kind: 'contribution', amountMinor: 100_000 },
      { lpId: 'lp-a', date: '2026-02-01', kind: 'pnl_allocation', amountMinor: -250_000 },
    ];
    expect(buildCapitalAccounts(events).get('lp-a')!.balanceMinor).toBe(-150_000);
  });
});

describe('capitalAccountBalance convenience', () => {
  it('returns an all-zero account when the LP has no events', () => {
    expect(capitalAccountBalance([], 'lp-missing')).toEqual({
      lpId: 'lp-missing',
      contributedMinor: 0,
      distributedMinor: 0,
      feesMinor: 0,
      allocatedPnlMinor: 0,
      balanceMinor: 0,
    });
  });

  it('matches the corresponding entry from buildCapitalAccounts', () => {
    const events: CapitalAccountEvent[] = [
      { lpId: 'lp-a', date: '2026-01-01', kind: 'contribution', amountMinor: 400_000 },
      { lpId: 'lp-b', date: '2026-01-01', kind: 'contribution', amountMinor: 600_000 },
      { lpId: 'lp-a', date: '2026-02-01', kind: 'mgmt_fee', amountMinor: 5_000 },
    ];
    expect(capitalAccountBalance(events, 'lp-a')).toEqual(buildCapitalAccounts(events).get('lp-a'));
  });
});

describe('non-negative-amount guard for non-pnl events', () => {
  it.each<CapitalAccountEventKind>(['contribution', 'distribution', 'mgmt_fee'])(
    'throws when a %s amount is negative',
    (kind) => {
      const events: CapitalAccountEvent[] = [
        { lpId: 'lp-a', date: '2026-01-01', kind, amountMinor: -1 },
      ];
      expect(() => buildCapitalAccounts(events)).toThrow();
      expect(() => capitalAccountBalance(events, 'lp-a')).toThrow();
    },
  );

  it('throws on a non-integer amount', () => {
    const events: CapitalAccountEvent[] = [
      { lpId: 'lp-a', date: '2026-01-01', kind: 'contribution', amountMinor: 1.5 },
    ];
    expect(() => buildCapitalAccounts(events)).toThrow();
  });

  it('accepts a negative pnl_allocation without throwing', () => {
    const events: CapitalAccountEvent[] = [
      { lpId: 'lp-a', date: '2026-01-01', kind: 'pnl_allocation', amountMinor: -1 },
    ];
    expect(() => buildCapitalAccounts(events)).not.toThrow();
  });
});

// A fast-check arbitrary producing a valid random event (non-pnl amounts are
// non-negative; pnl may be any integer including negatives).
const eventArb: fc.Arbitrary<CapitalAccountEvent> = fc
  .record({
    lpId: fc.constantFrom('lp-a', 'lp-b', 'lp-c', 'lp-d'),
    date: fc.constantFrom(
      '2026-01-01',
      '2026-02-01',
      '2026-02-01', // duplicate date to exercise the stable tie-break
      '2026-03-15',
      '2026-06-30',
    ),
    kind: fc.constantFrom<CapitalAccountEventKind>(
      'contribution',
      'distribution',
      'mgmt_fee',
      'pnl_allocation',
    ),
    magnitude: fc.integer({ min: 0, max: 5_000_000 }),
    sign: fc.boolean(),
  })
  .map(({ lpId, date, kind, magnitude, sign }) => ({
    lpId,
    date,
    kind,
    // Only pnl may be negative; everything else is a non-negative magnitude.
    amountMinor: kind === 'pnl_allocation' && sign ? -magnitude : magnitude,
  }));

describe('property: exact reconciliation, no cents created or lost', () => {
  it('each LP balance equals contributed − distributed − fees + pnl, and the fund total is the sum', () => {
    fc.assert(
      fc.property(fc.array(eventArb, { maxLength: 200 }), (events) => {
        const accounts = buildCapitalAccounts(events);

        // Recompute the expected per-LP aggregates independently.
        const expected = new Map<string, { c: number; d: number; f: number; p: number }>();
        for (const e of events) {
          const agg = expected.get(e.lpId) ?? { c: 0, d: 0, f: 0, p: 0 };
          if (e.kind === 'contribution') agg.c += e.amountMinor;
          else if (e.kind === 'distribution') agg.d += e.amountMinor;
          else if (e.kind === 'mgmt_fee') agg.f += e.amountMinor;
          else agg.p += e.amountMinor;
          expected.set(e.lpId, agg);
        }

        let expectedFundTotal = 0;
        for (const [lpId, agg] of expected) {
          const acc = accounts.get(lpId)!;
          expect(acc.contributedMinor).toBe(agg.c);
          expect(acc.distributedMinor).toBe(agg.d);
          expect(acc.feesMinor).toBe(agg.f);
          expect(acc.allocatedPnlMinor).toBe(agg.p);
          expect(acc.balanceMinor).toBe(agg.c - agg.d - agg.f + agg.p);
          expectedFundTotal += agg.c - agg.d - agg.f + agg.p;
        }

        // Every account in the map corresponds to a seen LP (no phantom LPs).
        expect(accounts.size).toBe(expected.size);
        expect(totalFundCapital(accounts)).toBe(expectedFundTotal);
      }),
    );
  });
});

describe('buildCapitalAccounts — canonical output order (Codex Gate 2b.1)', () => {
  it('iterates lpIds in ascending order regardless of input event order', () => {
    const events: CapitalAccountEvent[] = [
      { lpId: 'lp-c', date: '2026-01-01', kind: 'contribution', amountMinor: 100 },
      { lpId: 'lp-a', date: '2026-01-01', kind: 'contribution', amountMinor: 100 },
      { lpId: 'lp-b', date: '2026-01-01', kind: 'contribution', amountMinor: 100 },
    ];
    expect([...buildCapitalAccounts(events).keys()]).toEqual(['lp-a', 'lp-b', 'lp-c']);
  });

  it('rejects amounts beyond the safe-integer range', () => {
    expect(() =>
      buildCapitalAccounts([
        { lpId: 'lp-a', date: '2026-01-01', kind: 'contribution', amountMinor: 2 ** 53 },
      ]),
    ).toThrow(/safe integer/);
  });
});
