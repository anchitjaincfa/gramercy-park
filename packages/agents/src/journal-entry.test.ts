import { describe, it, expect } from 'vitest';
import { isOk, isErr } from '@gramercy/core';
import type { Account } from '@gramercy/ledger';
import { proposeJournalEntry } from './journal-entry';
import { approveJournalEntry, type ApproveContext } from './review-queue';
import { DEFAULT_MODEL } from './client';
import type { JournalEntryContext, JournalEntryProposer, RawJournalEntryProposal } from './types';

// Chart of accounts for entity "fund1".
const ACCOUNTS: Account[] = [
  { id: 'a_cash', entityId: 'fund1', code: '1000', name: 'Cash', type: 'asset' },
  { id: 'a_ap', entityId: 'fund1', code: '2000', name: 'Accounts Payable', type: 'liability' },
  { id: 'a_exp', entityId: 'fund1', code: '6000', name: 'Fund Expenses', type: 'expense' },
];

const CTX: JournalEntryContext = {
  entityId: 'fund1',
  currency: 'USD',
  sourceRef: 'INV-1',
  documentText: 'Vendor invoice INV-1: legal services, $500.00 due to Acme LLP.',
  chartOfAccounts: ACCOUNTS.map((a) => ({ code: a.code, name: a.name, type: a.type })),
};

/** A fixture proposer: records a fixed model output so tests need no live API. */
function fixtureProposer(raw: RawJournalEntryProposal): JournalEntryProposer {
  return { propose: async () => raw };
}

const BALANCED: RawJournalEntryProposal = {
  payload: {
    entityId: 'fund1',
    date: '2026-03-01',
    memo: 'Vendor invoice INV-1 (legal services)',
    currency: 'USD',
    lines: [
      { accountCode: '6000', side: 'debit', amountMinor: 50_000, rationale: 'legal expense' },
      {
        accountCode: '2000',
        side: 'credit',
        amountMinor: 50_000,
        rationale: 'payable to Acme LLP',
      },
    ],
  },
  evidence: [
    { field: 'lines.0.amountMinor', sourceRef: 'INV-1', quote: '$500.00' },
    { field: 'payload.memo', sourceRef: 'INV-1', quote: 'legal services' },
  ],
  confidence: 0.92,
  model: 'claude-opus-4-8',
};

const approveCtx: ApproveContext = {
  accounts: ACCOUNTS,
  sourceType: 'bill',
  sourceId: 'INV-1',
  idempotencyKey: 'bill:INV-1',
  preparerUserId: 'ai-agent',
  approverUserId: 'controller',
  approverRole: 'reviewer',
  approvalPolicies: [{ role: 'reviewer', maxAmountMinor: null }],
};

describe('proposeJournalEntry', () => {
  it('stamps trust metadata and is propose-only', async () => {
    const p = await proposeJournalEntry(CTX, fixtureProposer(BALANCED));
    expect(p.kind).toBe('journal_entry');
    expect(p.schemaVersion).toBe(1);
    expect(p.model).toBe(DEFAULT_MODEL);
    expect(p.promptVersion).toBe('journal-entry-v1');
    expect(p.createdByAgent).toBe('journal-entry-agent');
    expect(p.confidence).toBeCloseTo(0.92);
    expect(p.evidence.length).toBe(2);
  });

  it('clamps an out-of-range confidence to [0,1]', async () => {
    const p = await proposeJournalEntry(CTX, fixtureProposer({ ...BALANCED, confidence: 5 }));
    expect(p.confidence).toBe(1);
  });
});

describe('approveJournalEntry — the HITL boundary', () => {
  it('turns an approved balanced proposal into a ledger-valid batch', async () => {
    const p = await proposeJournalEntry(CTX, fixtureProposer(BALANCED));
    const result = approveJournalEntry(p, approveCtx);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.journals[0]!.lines.length).toBe(2);
      expect(result.value.idempotencyKey).toBe('bill:INV-1');
    }
  });

  it('rejects an unknown account code', async () => {
    const p = await proposeJournalEntry(
      CTX,
      fixtureProposer({
        ...BALANCED,
        payload: {
          ...BALANCED.payload,
          lines: [
            { accountCode: '9999', side: 'debit', amountMinor: 50_000, rationale: 'x' },
            { accountCode: '2000', side: 'credit', amountMinor: 50_000, rationale: 'y' },
          ],
        },
      }),
    );
    const result = approveJournalEntry(p, approveCtx);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error[0]!.code).toBe('UNKNOWN_ACCOUNT_CODE');
  });

  it('rejects an unbalanced proposal via the ledger engine (re-validation)', async () => {
    const p = await proposeJournalEntry(
      CTX,
      fixtureProposer({
        ...BALANCED,
        payload: {
          ...BALANCED.payload,
          lines: [
            { accountCode: '6000', side: 'debit', amountMinor: 50_000, rationale: 'x' },
            { accountCode: '2000', side: 'credit', amountMinor: 40_000, rationale: 'y' },
          ],
        },
      }),
    );
    const result = approveJournalEntry(p, approveCtx);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.some((e) => e.code === 'LEDGER')).toBe(true);
  });

  it('rejects a non-positive amount before it reaches the ledger', async () => {
    const p = await proposeJournalEntry(
      CTX,
      fixtureProposer({
        ...BALANCED,
        payload: {
          ...BALANCED.payload,
          lines: [
            { accountCode: '6000', side: 'debit', amountMinor: 0, rationale: 'x' },
            { accountCode: '2000', side: 'credit', amountMinor: 0, rationale: 'y' },
          ],
        },
      }),
    );
    const result = approveJournalEntry(p, approveCtx);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error[0]!.code).toBe('NON_POSITIVE_AMOUNT');
  });

  it('rejects a wrong-kind or wrong-schema proposal (Codex Gate 4.1)', async () => {
    const p = await proposeJournalEntry(CTX, fixtureProposer(BALANCED));
    const wrongKind = { ...p, kind: 'kpi' as unknown as 'journal_entry' };
    expect(isErr(approveJournalEntry(wrongKind, approveCtx))).toBe(true);
    const wrongSchema = { ...p, schemaVersion: 999 };
    const r = approveJournalEntry(wrongSchema, approveCtx);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error[0]!.code).toBe('INVALID_PROPOSAL');
  });

  it('returns a typed error (not a throw) on a malformed payload (Codex Gate 4.1)', async () => {
    const p = await proposeJournalEntry(
      CTX,
      fixtureProposer({ ...BALANCED, payload: { ...BALANCED.payload, currency: '' } }),
    );
    const result = approveJournalEntry(p, approveCtx);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error[0]!.code).toBe('MALFORMED_PAYLOAD');
  });
});

describe('approveJournalEntry — RBAC enforcement (adversarial-review fix)', () => {
  it('rejects self-approval (segregation of duties)', async () => {
    const p = await proposeJournalEntry(CTX, fixtureProposer(BALANCED));
    const r = approveJournalEntry(p, { ...approveCtx, preparerUserId: 'u1', approverUserId: 'u1' });
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error[0]!.code).toBe('SEGREGATION_VIOLATION');
  });

  it('rejects approval above the role threshold', async () => {
    // BALANCED posts 50,000 minor; a $100 (10,000 minor) reviewer cap must block it.
    const p = await proposeJournalEntry(CTX, fixtureProposer(BALANCED));
    const r = approveJournalEntry(p, {
      ...approveCtx,
      approvalPolicies: [{ role: 'reviewer', maxAmountMinor: 10_000 }],
    });
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error[0]!.code).toBe('UNAUTHORIZED');
  });

  it('rejects a role that lacks approve permission (e.g. accountant)', async () => {
    const p = await proposeJournalEntry(CTX, fixtureProposer(BALANCED));
    const r = approveJournalEntry(p, {
      ...approveCtx,
      approverRole: 'accountant',
      approvalPolicies: [{ role: 'accountant', maxAmountMinor: null }],
    });
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error[0]!.code).toBe('UNAUTHORIZED');
  });
});
