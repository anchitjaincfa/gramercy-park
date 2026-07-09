import { describe, it, expect } from 'vitest';
import { accountsById, validateBatch, type Account } from '@gramercy/ledger';
import { isOk } from '@gramercy/core';
import { buildMarkToMarketBatch } from './valuation';

const FUND_ID = 'fund-1';
const INVESTMENT = 'acct-investment';
const UNREALIZED = 'acct-unrealized-gl';

const accounts: Account[] = [
  {
    id: INVESTMENT,
    entityId: FUND_ID,
    code: '1500',
    name: 'Investment at fair value',
    type: 'asset',
  },
  { id: UNREALIZED, entityId: FUND_ID, code: '3900', name: 'Unrealized gain/loss', type: 'equity' },
];

const base = {
  entityId: FUND_ID,
  date: '2026-03-31',
  investmentAccountId: INVESTMENT,
  unrealizedGainAccountId: UNREALIZED,
  currency: 'USD',
  sourceId: 'val-1',
};

function sumBySide(lines: readonly { side: string; amount: { amount: number } }[]) {
  const debits = lines.filter((l) => l.side === 'debit').reduce((s, l) => s + l.amount.amount, 0);
  const credits = lines.filter((l) => l.side === 'credit').reduce((s, l) => s + l.amount.amount, 0);
  return { debits, credits };
}

describe('buildMarkToMarketBatch', () => {
  it('mark UP passes ledger validation, balances, and DEBITs the investment account', () => {
    const batch = buildMarkToMarketBatch({
      ...base,
      currentCarryingMinor: 1_000_000,
      newFairValueMinor: 1_250_000,
    });

    const result = validateBatch(batch, accountsById(accounts));
    expect(isOk(result)).toBe(true);

    const lines = batch.journals[0]!.lines;
    const { debits, credits } = sumBySide(lines);
    expect(debits).toBe(credits);
    expect(debits).toBe(250_000); // |delta|

    const debitLine = lines.find((l) => l.side === 'debit')!;
    const creditLine = lines.find((l) => l.side === 'credit')!;
    expect(debitLine.accountId).toBe(INVESTMENT);
    expect(creditLine.accountId).toBe(UNREALIZED);
  });

  it('mark DOWN passes validation, balances, and CREDITs the investment account', () => {
    const batch = buildMarkToMarketBatch({
      ...base,
      currentCarryingMinor: 1_000_000,
      newFairValueMinor: 600_000,
    });

    const result = validateBatch(batch, accountsById(accounts));
    expect(isOk(result)).toBe(true);

    const lines = batch.journals[0]!.lines;
    const { debits, credits } = sumBySide(lines);
    expect(debits).toBe(credits);
    expect(debits).toBe(400_000); // |delta|

    const debitLine = lines.find((l) => l.side === 'debit')!;
    const creditLine = lines.find((l) => l.side === 'credit')!;
    expect(debitLine.accountId).toBe(UNREALIZED);
    expect(creditLine.accountId).toBe(INVESTMENT);
  });

  it('sets metadata: idempotencyKey, sourceType default, sourceId, date, memo, entity', () => {
    const batch = buildMarkToMarketBatch({
      ...base,
      currentCarryingMinor: 1_000_000,
      newFairValueMinor: 1_100_000,
    });
    expect(batch.idempotencyKey).toBe('mtm:val-1');
    expect(batch.sourceType).toBe('valuation');
    expect(batch.sourceId).toBe('val-1');
    expect(batch.date).toBe('2026-03-31');
    expect(batch.memo).toBe(`Mark-to-market ${INVESTMENT} @ 2026-03-31`);
    expect(batch.journals[0]!.entityId).toBe(FUND_ID);
  });

  it('honors a custom sourceType', () => {
    const batch = buildMarkToMarketBatch({
      ...base,
      currentCarryingMinor: 1_000_000,
      newFairValueMinor: 1_100_000,
      sourceType: 'custom_valuation',
    });
    expect(batch.sourceType).toBe('custom_valuation');
  });

  it('throws when delta === 0 (nothing to mark)', () => {
    expect(() =>
      buildMarkToMarketBatch({
        ...base,
        currentCarryingMinor: 1_000_000,
        newFairValueMinor: 1_000_000,
      }),
    ).toThrow();
  });

  it('throws when investment and unrealized gain accounts are the same', () => {
    expect(() =>
      buildMarkToMarketBatch({
        ...base,
        unrealizedGainAccountId: INVESTMENT,
        currentCarryingMinor: 1_000_000,
        newFairValueMinor: 1_250_000,
      }),
    ).toThrow();
  });
});
