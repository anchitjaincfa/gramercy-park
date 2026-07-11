import { type Result, ok, err, money } from '@gramercy/core';
import {
  type Account,
  type BatchInput,
  type JournalInput,
  type JournalLineInput,
  accountsById,
  validateBatch,
} from '@gramercy/ledger';
import type { JournalEntryProposal } from './types';
import { JOURNAL_ENTRY_SCHEMA_VERSION } from './journal-entry';
import { type Role, type ApprovalPolicy, canApproveAmount, isSegregationOk } from '@gramercy/rbac';

/**
 * The human-in-the-loop boundary (docs/ARCHITECTURE.md §5). An approved proposal
 * is RE-VALIDATED against the real chart of accounts and the deterministic ledger
 * engine before it can become a posted batch — a stale or malformed proposal (or
 * a bad reviewer edit) is rejected here, not posted. This function returns a
 * ledger-valid `BatchInput` ready for the posting service; it never posts itself.
 */

export interface ApprovalError {
  readonly code:
    | 'INVALID_PROPOSAL'
    | 'MALFORMED_PAYLOAD'
    | 'DUPLICATE_ACCOUNT_CODE'
    | 'UNKNOWN_ACCOUNT_CODE'
    | 'NON_POSITIVE_AMOUNT'
    | 'SEGREGATION_VIOLATION'
    | 'UNAUTHORIZED'
    | 'LEDGER';
  readonly message: string;
  readonly lineIndex?: number;
}

export interface ApproveContext {
  /** The chart of accounts for the proposal's entity (codes unique per entity). */
  readonly accounts: readonly Account[];
  readonly sourceType: string;
  readonly sourceId: string;
  readonly idempotencyKey: string;
  /** Who authored the proposal (or triggered the AI). */
  readonly preparerUserId: string;
  /** The human approving — must differ from the preparer (segregation of duties). */
  readonly approverUserId: string;
  /** The approver's role, checked against the approval threshold. */
  readonly approverRole: Role;
  /** Per-role approval thresholds (from @gramercy/rbac). */
  readonly approvalPolicies: readonly ApprovalPolicy[];
}

/**
 * Turn an approved journal-entry proposal into a ledger-valid batch, or a list of
 * errors. The (possibly reviewer-edited) payload is resolved against real accounts
 * and run through `validateBatch` — the same deterministic check the ledger uses.
 */
export function approveJournalEntry(
  proposal: JournalEntryProposal,
  ctx: ApproveContext,
): Result<BatchInput, ApprovalError[]> {
  // Runtime gate: don't trust the static type — a deserialization/DB bug could
  // hand us the wrong kind or an unknown schema version.
  if (
    proposal.kind !== 'journal_entry' ||
    proposal.schemaVersion !== JOURNAL_ENTRY_SCHEMA_VERSION
  ) {
    return err([
      {
        code: 'INVALID_PROPOSAL',
        message: `expected journal_entry v${JOURNAL_ENTRY_SCHEMA_VERSION}, got ${String(
          proposal.kind,
        )} v${String(proposal.schemaVersion)}`,
      },
    ]);
  }

  const { payload } = proposal;
  // Guard payload shape so a malformed/reviewer-edited payload returns a typed
  // rejection instead of throwing (e.g. missing lines, blank currency).
  if (
    payload === null ||
    typeof payload !== 'object' ||
    typeof payload.entityId !== 'string' ||
    typeof payload.date !== 'string' ||
    typeof payload.currency !== 'string' ||
    payload.currency.trim() === '' ||
    !Array.isArray(payload.lines) ||
    payload.lines.length === 0
  ) {
    return err([{ code: 'MALFORMED_PAYLOAD', message: 'proposal payload is malformed' }]);
  }

  // Duplicate account codes make code→account resolution ambiguous.
  const seenCodes = new Set<string>();
  for (const a of ctx.accounts) {
    if (seenCodes.has(a.code)) {
      return err([
        { code: 'DUPLICATE_ACCOUNT_CODE', message: `duplicate account code "${a.code}"` },
      ]);
    }
    seenCodes.add(a.code);
  }

  const byCode = new Map(ctx.accounts.map((a) => [a.code, a]));
  const errors: ApprovalError[] = [];
  const lines: JournalLineInput[] = [];

  payload.lines.forEach((line, lineIndex) => {
    if (!Number.isSafeInteger(line.amountMinor) || line.amountMinor <= 0) {
      errors.push({
        code: 'NON_POSITIVE_AMOUNT',
        lineIndex,
        message: `line ${lineIndex} amount must be a positive safe integer, got ${line.amountMinor}`,
      });
      return;
    }
    const account = byCode.get(line.accountCode);
    if (!account) {
      errors.push({
        code: 'UNKNOWN_ACCOUNT_CODE',
        lineIndex,
        message: `line ${lineIndex} references unknown account code "${line.accountCode}"`,
      });
      return;
    }
    lines.push({
      accountId: account.id,
      side: line.side,
      amount: money(line.amountMinor, payload.currency),
    });
  });

  if (errors.length > 0) return err(errors);

  // Authorization (RBAC) — the AI prepares, but a HUMAN with the right role and
  // within their approval threshold must approve, and may not approve their own
  // preparation (segregation of duties).
  if (!isSegregationOk(ctx.preparerUserId, ctx.approverUserId)) {
    return err([
      {
        code: 'SEGREGATION_VIOLATION',
        message: `preparer and approver must differ (both "${ctx.approverUserId}")`,
      },
    ]);
  }
  const journalTotalMinor = lines
    .filter((l) => l.side === 'debit')
    .reduce((sum, l) => sum + l.amount.amount, 0);
  if (!canApproveAmount(ctx.approverRole, journalTotalMinor, ctx.approvalPolicies)) {
    return err([
      {
        code: 'UNAUTHORIZED',
        message: `role "${ctx.approverRole}" may not approve ${journalTotalMinor} minor units`,
      },
    ]);
  }

  const journal: JournalInput = {
    entityId: payload.entityId,
    date: payload.date,
    memo: payload.memo,
    lines,
  };
  const batch: BatchInput = {
    date: payload.date,
    memo: payload.memo,
    sourceType: ctx.sourceType,
    sourceId: ctx.sourceId,
    idempotencyKey: ctx.idempotencyKey,
    journals: [journal],
  };

  // Re-validate through the deterministic ledger engine — the AI's output only
  // becomes truth if it passes the same check a hand-typed entry would.
  const result = validateBatch(batch, accountsById([...ctx.accounts]));
  if (!result.ok) {
    return err(result.error.map((e) => ({ code: 'LEDGER' as const, message: e.message })));
  }
  return ok(batch);
}
