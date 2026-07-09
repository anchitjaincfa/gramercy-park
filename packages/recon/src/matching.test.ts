import { describe, expect, it } from 'vitest';
import { reconcile } from './matching';
import type { BankTransaction, LedgerCashEntry, ReconInput, SourceDocument } from './types';

// --------------------------------------------------------------------------
// Fixture builders — every test starts from an isolated, valid baseline.
// --------------------------------------------------------------------------

function bank(overrides: Partial<BankTransaction> = {}): BankTransaction {
  return {
    id: 'b1',
    firmId: 'firm1',
    entityId: 'ent1',
    date: '2026-06-01',
    amountMinor: 500_000,
    currency: 'USD',
    description: 'wire in',
    ...overrides,
  };
}

function ledger(overrides: Partial<LedgerCashEntry> = {}): LedgerCashEntry {
  return {
    id: 'l1',
    firmId: 'firm1',
    entityId: 'ent1',
    journalId: 'j1',
    accountId: 'cash',
    date: '2026-06-01',
    amountMinor: 500_000,
    currency: 'USD',
    memo: 'cash receipt',
    ...overrides,
  };
}

function doc(overrides: Partial<SourceDocument> = {}): SourceDocument {
  return {
    id: 'd1',
    firmId: 'firm1',
    entityId: 'ent1',
    kind: 'invoice',
    date: '2026-06-01',
    amountMinor: 500_000,
    currency: 'USD',
    reference: 'INV-3',
    ...overrides,
  };
}

function input(overrides: Partial<ReconInput> = {}): ReconInput {
  return {
    bank: [],
    ledger: [],
    documents: [],
    dateToleranceDays: 1,
    ...overrides,
  };
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe('reconcile', () => {
  it('handles empty input', () => {
    const result = reconcile(input());
    expect(result.matches).toEqual([]);
    expect(result.exceptions).toEqual([]);
  });

  it('produces a full three-way match (bank + ledger + document)', () => {
    const result = reconcile(
      input({
        bank: [bank()],
        ledger: [ledger({ date: '2026-06-02' })], // 1 day off, within tolerance
        documents: [doc()],
      }),
    );

    expect(result.matches).toHaveLength(1);
    const m = result.matches[0]!;
    expect(m.status).toBe('matched');
    expect(m.confidence).toBe(1.0);
    expect(m.bankTransactionId).toBe('b1');
    expect(m.ledgerEntryId).toBe('l1');
    expect(m.documentId).toBe('d1');
    expect(m.reasons).toEqual(['amount 500000 USD', 'date within 1d', 'doc invoice INV-3']);
    expect(result.exceptions).toEqual([]);
  });

  it('reports a partial match with MISSING_DOCUMENT when the ledger matches but no doc does', () => {
    const result = reconcile(
      input({
        bank: [bank()],
        ledger: [ledger()],
        documents: [], // no supporting document
      }),
    );

    expect(result.matches).toHaveLength(1);
    const m = result.matches[0]!;
    expect(m.status).toBe('partial');
    expect(m.confidence).toBe(0.7);
    expect(m.ledgerEntryId).toBe('l1');
    expect(m.documentId).toBeUndefined();
    expect(m.reasons).toContain('no supporting document');

    expect(result.exceptions).toHaveLength(1);
    expect(result.exceptions[0]).toMatchObject({
      code: 'MISSING_DOCUMENT',
      bankTransactionId: 'b1',
      ledgerEntryId: 'l1',
    });
  });

  it('flags a bank txn with no ledger counterpart as UNMATCHED_BANK', () => {
    const result = reconcile(
      input({
        bank: [bank()],
        ledger: [], // nothing to match
        documents: [doc()],
      }),
    );

    expect(result.matches).toHaveLength(1);
    const m = result.matches[0]!;
    expect(m.status).toBe('unmatched');
    expect(m.confidence).toBe(0.0);
    expect(m.ledgerEntryId).toBeUndefined();
    expect(m.documentId).toBeUndefined();

    const codes = result.exceptions.map((e) => e.code);
    expect(codes).toContain('UNMATCHED_BANK');
    expect(result.exceptions.find((e) => e.code === 'UNMATCHED_BANK')).toMatchObject({
      bankTransactionId: 'b1',
    });
  });

  it('flags a ledger entry with no bank counterpart as UNMATCHED_LEDGER', () => {
    const result = reconcile(
      input({
        bank: [],
        ledger: [ledger()],
        documents: [],
      }),
    );

    expect(result.matches).toEqual([]);
    expect(result.exceptions).toHaveLength(1);
    expect(result.exceptions[0]).toMatchObject({
      code: 'UNMATCHED_LEDGER',
      ledgerEntryId: 'l1',
    });
  });

  it('surfaces CURRENCY_MISMATCH when a same-amount, in-tolerance ledger differs only in currency', () => {
    const result = reconcile(
      input({
        bank: [bank({ currency: 'USD' })],
        ledger: [ledger({ currency: 'EUR' })], // same amount + date, wrong currency
        documents: [],
      }),
    );

    // No true match — the bank txn is unmatched.
    expect(result.matches[0]!.status).toBe('unmatched');

    const mismatch = result.exceptions.find((e) => e.code === 'CURRENCY_MISMATCH');
    expect(mismatch).toBeDefined();
    expect(mismatch).toMatchObject({ bankTransactionId: 'b1', ledgerEntryId: 'l1' });

    // The bank txn is still reported as unmatched, and the ledger as unmatched.
    const codes = result.exceptions.map((e) => e.code);
    expect(codes).toContain('UNMATCHED_BANK');
    expect(codes).toContain('UNMATCHED_LEDGER');
  });

  it('is deterministic: identical input yields identical output', () => {
    const build = () =>
      input({
        bank: [
          bank({ id: 'b1', date: '2026-06-03', amountMinor: 100 }),
          bank({ id: 'b2', date: '2026-06-01', amountMinor: 200 }),
          bank({ id: 'b3', date: '2026-06-02', amountMinor: 300, currency: 'GBP' }),
        ],
        ledger: [
          ledger({ id: 'l1', date: '2026-06-01', amountMinor: 200 }),
          ledger({ id: 'l2', date: '2026-06-03', amountMinor: 100 }),
          ledger({ id: 'l3', date: '2026-06-02', amountMinor: 300, currency: 'EUR' }),
        ],
        documents: [doc({ id: 'd1', date: '2026-06-01', amountMinor: 200 })],
      });

    const a = reconcile(build());
    const b = reconcile(build());
    expect(a).toEqual(b);
    // Deep-equal serialisation guards against ordering nondeterminism too.
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('uses each ledger entry at most once (two equal bank txns do not share one ledger line)', () => {
    const result = reconcile(
      input({
        bank: [
          bank({ id: 'b1', date: '2026-06-01', amountMinor: 500_000 }),
          bank({ id: 'b2', date: '2026-06-01', amountMinor: 500_000 }),
        ],
        ledger: [ledger({ id: 'l1', date: '2026-06-01', amountMinor: 500_000 })],
        documents: [],
      }),
    );

    const statuses = result.matches.map((m) => m.status).sort();
    // One consumes the single ledger line (partial, no doc); the other is unmatched.
    expect(statuses).toEqual(['partial', 'unmatched']);

    const usedLedgerIds = result.matches
      .map((m) => m.ledgerEntryId)
      .filter((id): id is string => id !== undefined);
    expect(usedLedgerIds).toEqual(['l1']); // used exactly once

    const codes = result.exceptions.map((e) => e.code).sort();
    expect(codes).toEqual(['MISSING_DOCUMENT', 'UNMATCHED_BANK']);
  });
});

describe('reconcile — Codex Gate 3.1 regressions', () => {
  const bank = (over: Partial<import('./types').BankTransaction> = {}) => ({
    id: 'b1',
    firmId: 'f1',
    entityId: 'e1',
    date: '2026-06-01',
    amountMinor: 100_000,
    currency: 'USD',
    description: 'wire',
    ...over,
  });
  const led = (over: Partial<import('./types').LedgerCashEntry> = {}) => ({
    id: 'l1',
    firmId: 'f1',
    entityId: 'e1',
    journalId: 'j1',
    accountId: 'a1',
    date: '2026-06-01',
    amountMinor: 100_000,
    currency: 'USD',
    memo: 'cash',
    ...over,
  });

  it('does NOT match a ledger entry from a different firm or entity', () => {
    const r = reconcile({
      bank: [bank()],
      ledger: [led({ firmId: 'f2' }), led({ id: 'l2', entityId: 'e2' })],
      documents: [],
      dateToleranceDays: 3,
    });
    expect(r.matches[0]!.status).toBe('unmatched');
    expect(r.exceptions.some((e) => e.code === 'UNMATCHED_BANK')).toBe(true);
  });

  it('surfaces a same-amount document in the wrong currency as CURRENCY_MISMATCH, not MISSING_DOCUMENT', () => {
    const r = reconcile({
      bank: [bank()],
      ledger: [led()],
      documents: [
        {
          id: 'd1',
          firmId: 'f1',
          entityId: 'e1',
          kind: 'invoice',
          date: '2026-06-01',
          amountMinor: 100_000,
          currency: 'EUR',
          reference: 'INV-1',
        },
      ],
      dateToleranceDays: 3,
    });
    expect(r.matches[0]!.status).toBe('partial');
    expect(r.exceptions.some((e) => e.code === 'CURRENCY_MISMATCH')).toBe(true);
    expect(r.exceptions.some((e) => e.code === 'MISSING_DOCUMENT')).toBe(false);
  });
});
