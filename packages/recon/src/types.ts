/**
 * Reconciliation domain types (Phase 3, docs/ARCHITECTURE.md §"Pillar 1 —
 * Reconciliation"). The engine performs three-way matching across a bank feed,
 * source documents, and the general ledger, then surfaces exceptions with full
 * context. All money is integer minor units (never floats).
 */

/** A line from the (mock) bank feed. `amountMinor` is signed: + inflow, − outflow. */
export interface BankTransaction {
  id: string;
  firmId: string;
  entityId: string;
  date: string; // ISO YYYY-MM-DD
  amountMinor: number;
  currency: string;
  description: string;
  counterparty?: string;
}

/** A posted GL cash-account line available to reconcile against. Signed like the bank. */
export interface LedgerCashEntry {
  id: string;
  firmId: string;
  entityId: string;
  journalId: string;
  accountId: string;
  date: string;
  amountMinor: number;
  currency: string;
  memo: string;
}

export type SourceDocumentKind =
  'invoice' | 'capital_call_notice' | 'distribution_notice' | 'mgmt_fee_invoice' | 'other';

/** Supporting evidence (a document) for a cash movement. */
export interface SourceDocument {
  id: string;
  firmId: string;
  entityId: string;
  kind: SourceDocumentKind;
  date: string;
  amountMinor: number; // magnitude (unsigned)
  currency: string;
  reference: string;
}

export type MatchStatus = 'matched' | 'partial' | 'unmatched';

/**
 * A reconciliation result for one bank transaction. `matched` = all three sides
 * (bank ↔ ledger ↔ document) agree; `partial` = the ledger agrees but no document
 * (or vice versa); `unmatched` = no counterpart found.
 */
export interface ThreeWayMatch {
  bankTransactionId: string;
  ledgerEntryId?: string;
  documentId?: string;
  status: MatchStatus;
  /** 0..1 confidence in the match. */
  confidence: number;
  reasons: string[];
}

export type ExceptionCode =
  | 'UNMATCHED_BANK'
  | 'UNMATCHED_LEDGER'
  | 'MISSING_DOCUMENT'
  | 'AMOUNT_MISMATCH'
  | 'CURRENCY_MISMATCH'
  | 'DUPLICATE_MATCH';

/** A surfaced discrepancy the reconciliation team must resolve. */
export interface ReconException {
  code: ExceptionCode;
  message: string;
  bankTransactionId?: string;
  ledgerEntryId?: string;
  documentId?: string;
}

export interface ReconInput {
  bank: readonly BankTransaction[];
  ledger: readonly LedgerCashEntry[];
  documents: readonly SourceDocument[];
  /** Max allowed |date difference| in days for a candidate match. */
  dateToleranceDays: number;
}

export interface ReconResult {
  matches: ThreeWayMatch[];
  exceptions: ReconException[];
}
