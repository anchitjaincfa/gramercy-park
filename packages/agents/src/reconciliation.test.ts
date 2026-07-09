import { describe, it, expect } from 'vitest';
import { proposeReconciliationMatch } from './reconciliation';
import { DEFAULT_MODEL } from './client';
import type {
  ReconciliationContext,
  ReconciliationProposer,
  RawReconciliationProposal,
} from './types';

const CTX: ReconciliationContext = {
  bankTransaction: {
    id: 'bank_1',
    date: '2026-03-02',
    amountMinor: 50_000,
    currency: 'USD',
    description: 'ACH debit ACME LLP',
  },
  candidateLedgerEntries: [
    {
      id: 'led_1',
      date: '2026-03-01',
      amountMinor: 50_000,
      currency: 'USD',
      memo: 'Acme LLP payable',
    },
  ],
  candidateDocuments: [
    {
      id: 'doc_1',
      kind: 'invoice',
      date: '2026-03-01',
      amountMinor: 50_000,
      currency: 'USD',
      reference: 'INV-1',
    },
  ],
};

/** A fixture proposer: records a fixed model output so tests need no live API. */
function fixtureProposer(raw: RawReconciliationProposal): ReconciliationProposer {
  return { propose: async () => raw };
}

const MATCH: RawReconciliationProposal = {
  payload: {
    bankTransactionId: 'bank_1',
    ledgerEntryId: 'led_1',
    documentId: 'doc_1',
    status: 'matched',
    rationale:
      'Bank debit, ledger payable, and invoice all agree on amount, date, and counterparty.',
  },
  evidence: [
    { field: 'payload.ledgerEntryId', sourceRef: 'led_1', quote: 'Acme LLP payable' },
    { field: 'payload.documentId', sourceRef: 'doc_1', quote: 'INV-1' },
  ],
  confidence: 0.9,
  model: 'claude-opus-4-8',
};

describe('proposeReconciliationMatch', () => {
  it('stamps trust metadata and is propose-only', async () => {
    const p = await proposeReconciliationMatch(CTX, fixtureProposer(MATCH));
    expect(p.kind).toBe('reconciliation_match');
    expect(p.schemaVersion).toBe(1);
    expect(p.model).toBe(DEFAULT_MODEL);
    expect(p.promptVersion).toBe('reconciliation-v1');
    expect(p.createdByAgent).toBe('reconciliation-agent');
    expect(p.confidence).toBeCloseTo(0.9);
    expect(p.evidence.length).toBe(2);
    // Propose-only: it returns a proposal object and posts nothing.
    expect(typeof p).toBe('object');
    expect(p.payload.bankTransactionId).toBe('bank_1');
  });

  it('preserves status and candidate ids from the raw proposal', async () => {
    const p = await proposeReconciliationMatch(CTX, fixtureProposer(MATCH));
    expect(p.payload.status).toBe('matched');
    expect(p.payload.ledgerEntryId).toBe('led_1');
    expect(p.payload.documentId).toBe('doc_1');
    expect(p.payload.rationale).toContain('agree');
  });

  it('preserves a partial match with an omitted document id', async () => {
    const partial: RawReconciliationProposal = {
      ...MATCH,
      payload: {
        bankTransactionId: 'bank_1',
        ledgerEntryId: 'led_1',
        status: 'partial',
        rationale: 'Ledger amount agrees but no supporting document was found.',
      },
    };
    const p = await proposeReconciliationMatch(CTX, fixtureProposer(partial));
    expect(p.payload.status).toBe('partial');
    expect(p.payload.ledgerEntryId).toBe('led_1');
    expect(p.payload.documentId).toBeUndefined();
  });

  it('clamps an out-of-range confidence to [0,1]', async () => {
    const high = await proposeReconciliationMatch(
      CTX,
      fixtureProposer({ ...MATCH, confidence: 5 }),
    );
    expect(high.confidence).toBe(1);
    const low = await proposeReconciliationMatch(
      CTX,
      fixtureProposer({ ...MATCH, confidence: -3 }),
    );
    expect(low.confidence).toBe(0);
    const nan = await proposeReconciliationMatch(
      CTX,
      fixtureProposer({ ...MATCH, confidence: NaN }),
    );
    expect(nan.confidence).toBe(0);
  });
});
