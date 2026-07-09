import { describe, it, expect } from 'vitest';
import { accountsById, validateBatch, type Account } from '@gramercy/ledger';
import { isOk } from '@gramercy/core';
import { buildCapitalCallBatch } from './capital-call';
import type { CapitalCall } from './types';

const FUND_ID = 'fund-1';
const CASH = 'acct-cash';
const CAPITAL = 'acct-capital';

const accounts: Account[] = [
  { id: CASH, entityId: FUND_ID, code: '1000', name: 'Cash', type: 'asset' },
  { id: CAPITAL, entityId: FUND_ID, code: '3000', name: "Partners' Capital", type: 'equity' },
];

const sampleCall: CapitalCall = {
  id: 'cc-1',
  firmId: 'firm-1',
  fundId: FUND_ID,
  number: 1,
  callDate: '2026-01-15',
  dueDate: '2026-01-30',
  purpose: 'Q1 2026 deployment',
  totalMinor: 1_000_000,
  currency: 'USD',
  allocations: [
    { lpId: 'lp-a', amountMinor: 750_000, kind: 'contribution' },
    { lpId: 'lp-b', amountMinor: 250_000, kind: 'contribution' },
  ],
};

describe('buildCapitalCallBatch', () => {
  it('produces a batch that passes ledger validation', () => {
    const batch = buildCapitalCallBatch(sampleCall, {
      cashAccountId: CASH,
      capitalAccountId: CAPITAL,
    });
    const result = validateBatch(batch, accountsById(accounts));
    expect(isOk(result)).toBe(true);
  });

  it('is balanced: debits equal credits', () => {
    const batch = buildCapitalCallBatch(sampleCall, {
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

  it('sets metadata: idempotencyKey, sourceType default, sourceId, dates, memo', () => {
    const batch = buildCapitalCallBatch(sampleCall, {
      cashAccountId: CASH,
      capitalAccountId: CAPITAL,
    });
    expect(batch.idempotencyKey).toBe('call:cc-1');
    expect(batch.sourceType).toBe('capital_call');
    expect(batch.sourceId).toBe('cc-1');
    expect(batch.date).toBe('2026-01-15');
    expect(batch.memo).toBe('Q1 2026 deployment');
    expect(batch.journals[0]!.entityId).toBe(FUND_ID);
  });

  it('honors a custom sourceType', () => {
    const batch = buildCapitalCallBatch(sampleCall, {
      cashAccountId: CASH,
      capitalAccountId: CAPITAL,
      sourceType: 'custom_source',
    });
    expect(batch.sourceType).toBe('custom_source');
  });
});
