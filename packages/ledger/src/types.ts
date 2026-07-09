import type { Money } from '@gramercy/core';

/** The five account classes. */
export type AccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense';

/** The side a line posts to. */
export type Side = 'debit' | 'credit';

/** The side on which an account's balance naturally increases. */
export type NormalSide = Side;

/** Debit-normal: assets & expenses. Credit-normal: liabilities, equity, income. */
export function normalSideOf(type: AccountType): NormalSide {
  return type === 'asset' || type === 'expense' ? 'debit' : 'credit';
}

export interface Account {
  readonly id: string;
  readonly entityId: string;
  readonly code: string;
  readonly name: string;
  readonly type: AccountType;
}

export interface JournalLineInput {
  readonly accountId: string;
  readonly side: Side;
  /** Must be strictly positive; direction is carried by `side`, not the sign. */
  readonly amount: Money;
}

export interface JournalInput {
  readonly entityId: string;
  readonly date: string; // ISO date (YYYY-MM-DD)
  readonly memo: string;
  readonly lines: readonly JournalLineInput[];
}

/**
 * A batch groups one or more entity-balanced journals into an atomic,
 * possibly intercompany transaction (see docs/ARCHITECTURE.md §3.1).
 */
export interface BatchInput {
  readonly date: string;
  readonly memo: string;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly idempotencyKey: string;
  readonly journals: readonly JournalInput[];
}

/** A validation problem, tied to where it occurred. */
export interface LedgerError {
  readonly code:
    | 'EMPTY_JOURNAL'
    | 'UNBALANCED_JOURNAL'
    | 'UNBALANCED_BATCH'
    | 'NON_POSITIVE_AMOUNT'
    | 'ACCOUNT_NOT_FOUND'
    | 'ENTITY_MISMATCH'
    | 'CURRENCY_MIXED_IN_LINE_SET'
    | 'INVALID_SIDE'
    | 'NO_OP_JOURNAL'
    | 'EMPTY_BATCH';
  readonly message: string;
  readonly journalIndex?: number;
  readonly lineIndex?: number;
}

/** An account's balance expressed in normal-side terms (always non-negative for a healthy account). */
export interface AccountBalance {
  readonly accountId: string;
  readonly type: AccountType;
  /** Signed net in debit-minus-credit terms (for trial-balance summation). */
  readonly netDebitMinusCredit: Money;
  /** Balance in the account's own normal-side orientation. */
  readonly normalBalance: Money;
}
