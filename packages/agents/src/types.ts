/**
 * AI agent layer (Phase 4). The operating principle is "AI prepares, expert
 * accountants review" (docs/PRODUCT.md): every agent output is a **propose-only**
 * `Proposal` — it never touches the ledger. Only an approved proposal, replayed
 * through a deterministic domain service (see review-queue.ts), becomes a posted
 * journal. This module owns the AI↔truth safety boundary.
 */

export type ProposalKind = 'journal_entry' | 'reconciliation_match' | 'kpi' | 'lp_reply';

/** A field of the payload traced back to where in the source it came from. */
export interface EvidenceCitation {
  /** Dotted path into the payload this citation supports, e.g. "lines.0.amountMinor". */
  field: string;
  /** Identifier of the source document / email / row. */
  sourceRef: string;
  /** The exact quoted span from the source that justifies the value. */
  quote: string;
}

/**
 * A typed, un-posted suggestion from an agent. Carries the metadata the safety
 * boundary needs (docs/ARCHITECTURE.md §3.5): schema version, evidence, the model
 * and prompt version that produced it, and a confidence signal. It CANNOT post.
 */
export interface Proposal<K extends ProposalKind, P> {
  readonly kind: K;
  readonly schemaVersion: number;
  readonly payload: P;
  readonly evidence: readonly EvidenceCitation[];
  /** 0..1 self-reported confidence. Advisory only — never a gate on its own. */
  readonly confidence: number;
  readonly model: string;
  readonly promptVersion: string;
  readonly createdByAgent: string;
}

// --- Journal-entry agent -----------------------------------------------------

export interface ProposedJournalLine {
  /** Chart-of-accounts CODE (not id) — the human/service resolves it to an account. */
  readonly accountCode: string;
  readonly side: 'debit' | 'credit';
  readonly amountMinor: number;
  readonly rationale: string;
}

export interface ProposedJournalEntry {
  readonly entityId: string;
  readonly date: string; // ISO YYYY-MM-DD
  readonly memo: string;
  readonly currency: string;
  readonly lines: readonly ProposedJournalLine[];
}

export type JournalEntryProposal = Proposal<'journal_entry', ProposedJournalEntry>;

/** Context handed to the journal-entry agent. */
export interface JournalEntryContext {
  /** The entity the bill/email pertains to. */
  readonly entityId: string;
  readonly currency: string;
  /** The bill / email / document text to code. */
  readonly sourceRef: string;
  readonly documentText: string;
  /** The available chart of accounts the agent may code against. */
  readonly chartOfAccounts: readonly {
    readonly code: string;
    readonly name: string;
    readonly type: 'asset' | 'liability' | 'equity' | 'income' | 'expense';
  }[];
}

/**
 * The raw structured result an LLM proposer returns for a journal entry. Kept
 * separate from `Proposal` so the model/prompt metadata is stamped by the agent,
 * not trusted from the model.
 */
export interface RawJournalEntryProposal {
  readonly payload: ProposedJournalEntry;
  readonly evidence: readonly EvidenceCitation[];
  readonly confidence: number;
  /** The model that actually produced this — stamped by the proposer, so audit
   * metadata reflects reality rather than a caller-supplied default. */
  readonly model: string;
}

/**
 * The seam that makes agents testable without a live API: a proposer turns a
 * context into a raw structured proposal. The Anthropic-backed implementation
 * lives in client.ts; tests inject a deterministic fake.
 */
export interface JournalEntryProposer {
  propose(ctx: JournalEntryContext): Promise<RawJournalEntryProposal>;
}

// --- Reconciliation-match agent ----------------------------------------------

export interface ProposedReconciliationMatch {
  readonly bankTransactionId: string;
  readonly ledgerEntryId?: string;
  readonly documentId?: string;
  readonly status: 'matched' | 'partial' | 'unmatched';
  readonly rationale: string;
}
export type ReconciliationMatchProposal = Proposal<
  'reconciliation_match',
  ProposedReconciliationMatch
>;

export interface ReconciliationContext {
  readonly bankTransaction: {
    readonly id: string;
    readonly date: string;
    readonly amountMinor: number;
    readonly currency: string;
    readonly description: string;
  };
  readonly candidateLedgerEntries: readonly {
    readonly id: string;
    readonly date: string;
    readonly amountMinor: number;
    readonly currency: string;
    readonly memo: string;
  }[];
  readonly candidateDocuments: readonly {
    readonly id: string;
    readonly kind: string;
    readonly date: string;
    readonly amountMinor: number;
    readonly currency: string;
    readonly reference: string;
  }[];
}
export interface RawReconciliationProposal {
  readonly payload: ProposedReconciliationMatch;
  readonly evidence: readonly EvidenceCitation[];
  readonly confidence: number;
  readonly model: string;
}
export interface ReconciliationProposer {
  propose(ctx: ReconciliationContext): Promise<RawReconciliationProposal>;
}

// --- KPI-reconciliation agent ------------------------------------------------

export interface KpiSourceValue {
  readonly source: string;
  readonly value: string;
}
export interface ProposedKpi {
  readonly companyId: string;
  readonly period: string;
  readonly metric: string;
  readonly reconciledValue: string;
  readonly sources: readonly KpiSourceValue[];
  readonly rationale: string;
}
export type KpiProposal = Proposal<'kpi', ProposedKpi>;

export interface KpiContext {
  readonly companyId: string;
  readonly period: string;
  readonly metric: string;
  readonly observations: readonly {
    readonly source: string;
    readonly value: string;
    readonly quote: string;
  }[];
}
export interface RawKpiProposal {
  readonly payload: ProposedKpi;
  readonly evidence: readonly EvidenceCitation[];
  readonly confidence: number;
  readonly model: string;
}
export interface KpiProposer {
  propose(ctx: KpiContext): Promise<RawKpiProposal>;
}

// --- LP-response agent -------------------------------------------------------

export interface ProposedLpReply {
  readonly lpId: string;
  readonly subject: string;
  readonly draftReply: string;
  readonly suggestedActions: readonly string[];
}
export type LpReplyProposal = Proposal<'lp_reply', ProposedLpReply>;

export interface LpResponseContext {
  readonly lpId: string;
  readonly lpName: string;
  readonly inboundMessage: string;
  /** Grounding facts the reply may reference — RLS-scoped to THIS LP only. */
  readonly lpFacts: readonly { readonly label: string; readonly value: string }[];
}
export interface RawLpReplyProposal {
  readonly payload: ProposedLpReply;
  readonly evidence: readonly EvidenceCitation[];
  readonly confidence: number;
  readonly model: string;
}
export interface LpResponseProposer {
  propose(ctx: LpResponseContext): Promise<RawLpReplyProposal>;
}
