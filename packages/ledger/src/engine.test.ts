import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { money } from '@gramercy/core';
import {
  accountsById,
  validateJournal,
  validateBatch,
  trialBalanceNet,
  type Account,
  type JournalInput,
  type JournalLineInput,
} from './index';

const USD = 'USD';

const ACCOUNTS: Account[] = [
  { id: 'a_fund_cash', entityId: 'fund', code: '1000', name: 'Cash', type: 'asset' },
  { id: 'a_fund_cap', entityId: 'fund', code: '3000', name: "Partners' Capital", type: 'equity' },
  { id: 'a_fund_exp', entityId: 'fund', code: '6000', name: 'Fund Expenses', type: 'expense' },
  { id: 'a_fund_due_to', entityId: 'fund', code: '2100', name: 'Due to MgmtCo', type: 'liability' },
  { id: 'a_mgmt_cash', entityId: 'mgmt', code: '1000', name: 'Cash', type: 'asset' },
  { id: 'a_mgmt_due_from', entityId: 'mgmt', code: '1200', name: 'Due from Fund', type: 'asset' },
];
const LOOKUP = accountsById(ACCOUNTS);

/** Attach entityId to lines the way a posted set carries it. */
function posted(j: JournalInput) {
  return j.lines.map((l) => ({ ...l, entityId: j.entityId }));
}

describe('validateJournal', () => {
  it('accepts a balanced single-entity journal', () => {
    const j: JournalInput = {
      entityId: 'fund',
      date: '2026-01-01',
      memo: 'LP contribution',
      lines: [
        { accountId: 'a_fund_cash', side: 'debit', amount: money(100_00, USD) },
        { accountId: 'a_fund_cap', side: 'credit', amount: money(100_00, USD) },
      ],
    };
    expect(validateJournal(j, LOOKUP)).toEqual([]);
    expect(trialBalanceNet(posted(j), LOOKUP, USD).amount).toBe(0);
  });

  it('rejects an unbalanced journal', () => {
    const j: JournalInput = {
      entityId: 'fund',
      date: '2026-01-01',
      memo: 'oops',
      lines: [
        { accountId: 'a_fund_cash', side: 'debit', amount: money(100_00, USD) },
        { accountId: 'a_fund_cap', side: 'credit', amount: money(90_00, USD) },
      ],
    };
    expect(validateJournal(j, LOOKUP).map((e) => e.code)).toContain('UNBALANCED_JOURNAL');
  });

  it('rejects a line whose account belongs to another entity', () => {
    const j: JournalInput = {
      entityId: 'fund',
      date: '2026-01-01',
      memo: 'wrong entity',
      lines: [
        { accountId: 'a_mgmt_cash', side: 'debit', amount: money(1_00, USD) },
        { accountId: 'a_fund_cap', side: 'credit', amount: money(1_00, USD) },
      ],
    };
    expect(validateJournal(j, LOOKUP).map((e) => e.code)).toContain('ENTITY_MISMATCH');
  });

  it('rejects non-positive and unknown-account lines', () => {
    const j: JournalInput = {
      entityId: 'fund',
      date: '2026-01-01',
      memo: 'bad lines',
      lines: [
        { accountId: 'a_fund_cash', side: 'debit', amount: money(0, USD) },
        { accountId: 'nope', side: 'credit', amount: money(1_00, USD) },
      ],
    };
    const codes = validateJournal(j, LOOKUP).map((e) => e.code);
    expect(codes).toContain('NON_POSITIVE_AMOUNT');
    expect(codes).toContain('ACCOUNT_NOT_FOUND');
  });

  it('rejects a mixed-currency journal', () => {
    const j: JournalInput = {
      entityId: 'fund',
      date: '2026-01-01',
      memo: 'fx',
      lines: [
        { accountId: 'a_fund_cash', side: 'debit', amount: money(1_00, 'USD') },
        { accountId: 'a_fund_cap', side: 'credit', amount: money(1_00, 'EUR') },
      ],
    };
    expect(validateJournal(j, LOOKUP).map((e) => e.code)).toContain('CURRENCY_MIXED_IN_LINE_SET');
  });

  it('flags an empty journal', () => {
    const j: JournalInput = { entityId: 'fund', date: '2026-01-01', memo: 'empty', lines: [] };
    expect(validateJournal(j, LOOKUP).map((e) => e.code)).toEqual(['EMPTY_JOURNAL']);
  });

  it('rejects an economic no-op (debit Cash / credit Cash) — Codex Gate 1.2', () => {
    const j: JournalInput = {
      entityId: 'fund',
      date: '2026-01-01',
      memo: 'no-op',
      lines: [
        { accountId: 'a_fund_cash', side: 'debit', amount: money(100_00, USD) },
        { accountId: 'a_fund_cash', side: 'credit', amount: money(100_00, USD) },
      ],
    };
    expect(validateJournal(j, LOOKUP).map((e) => e.code)).toContain('NO_OP_JOURNAL');
  });

  it('rejects an invalid side from untyped input — Codex Gate 1.2', () => {
    const j = {
      entityId: 'fund',
      date: '2026-01-01',
      memo: 'bad side',
      lines: [
        { accountId: 'a_fund_cash', side: 'sideways', amount: money(1_00, USD) },
        { accountId: 'a_fund_cap', side: 'credit', amount: money(1_00, USD) },
      ],
    } as unknown as JournalInput;
    expect(validateJournal(j, LOOKUP).map((e) => e.code)).toContain('INVALID_SIDE');
  });
});

describe('validateBatch — intercompany', () => {
  it('accepts a balanced intercompany batch (MgmtCo pays a fund expense)', () => {
    const batch = {
      date: '2026-02-01',
      memo: 'MgmtCo pays vendor on behalf of Fund',
      sourceType: 'bill',
      sourceId: 'bill_1',
      idempotencyKey: 'batch_1',
      journals: [
        {
          entityId: 'mgmt',
          date: '2026-02-01',
          memo: 'Pay vendor, book receivable from Fund',
          lines: [
            { accountId: 'a_mgmt_due_from', side: 'debit', amount: money(100_00, USD) },
            { accountId: 'a_mgmt_cash', side: 'credit', amount: money(100_00, USD) },
          ] as JournalLineInput[],
        },
        {
          entityId: 'fund',
          date: '2026-02-01',
          memo: 'Book expense and payable to MgmtCo',
          lines: [
            { accountId: 'a_fund_exp', side: 'debit', amount: money(100_00, USD) },
            { accountId: 'a_fund_due_to', side: 'credit', amount: money(100_00, USD) },
          ] as JournalLineInput[],
        },
      ],
    };
    const result = validateBatch(batch, LOOKUP);
    expect(result.ok).toBe(true);
  });

  it('rejects an empty batch', () => {
    const result = validateBatch(
      {
        date: '2026-02-01',
        memo: '',
        sourceType: 's',
        sourceId: 'x',
        idempotencyKey: 'k',
        journals: [],
      },
      LOOKUP,
    );
    expect(result.ok).toBe(false);
  });
});

describe('property: any balanced journal validates and nets to zero', () => {
  it('holds across random balanced journals', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 1_000_000 }), { minLength: 1, maxLength: 20 }),
        (debits) => {
          const total = debits.reduce((a, b) => a + b, 0);
          const lines: JournalLineInput[] = [
            ...debits.map((d) => ({
              accountId: 'a_fund_cash',
              side: 'debit' as const,
              amount: money(d, USD),
            })),
            { accountId: 'a_fund_cap', side: 'credit' as const, amount: money(total, USD) },
          ];
          const j: JournalInput = { entityId: 'fund', date: '2026-01-01', memo: 'rnd', lines };
          expect(validateJournal(j, LOOKUP)).toEqual([]);
          expect(trialBalanceNet(posted(j), LOOKUP, USD).amount).toBe(0);
        },
      ),
    );
  });
});
