import {
  type Money,
  type Result,
  ok,
  err,
  add,
  sub,
  zero,
  negate,
  isPositive,
  equals,
} from '@gramercy/core';
import {
  type Account,
  type AccountBalance,
  type BatchInput,
  type JournalInput,
  type JournalLineInput,
  type LedgerError,
  normalSideOf,
} from './types';

type AccountLookup = ReadonlyMap<string, Account>;

export function accountsById(accounts: readonly Account[]): Map<string, Account> {
  return new Map(accounts.map((a) => [a.id, a]));
}

/** Totals for one balanced set of lines, per side, in a single currency. */
function sideTotals(
  lines: readonly JournalLineInput[],
  currency: string,
): { debit: Money; credit: Money } {
  let debit = zero(currency);
  let credit = zero(currency);
  for (const line of lines) {
    if (line.side === 'debit') debit = add(debit, line.amount);
    else credit = add(credit, line.amount);
  }
  return { debit, credit };
}

/**
 * Validate a single journal against the invariants:
 * single currency, positive amounts, real accounts belonging to the journal's
 * entity, and debits == credits. Pure — no I/O.
 */
export function validateJournal(
  journal: JournalInput,
  accounts: AccountLookup,
  journalIndex?: number,
): LedgerError[] {
  const errors: LedgerError[] = [];
  const at = (extra: Partial<LedgerError>): Partial<LedgerError> =>
    journalIndex === undefined ? extra : { journalIndex, ...extra };

  if (journal.lines.length === 0) {
    errors.push({ code: 'EMPTY_JOURNAL', message: 'Journal has no lines', ...at({}) });
    return errors;
  }

  const currencies = new Set(journal.lines.map((l) => l.amount.currency));
  const mixedCurrency = currencies.size > 1;
  if (mixedCurrency) {
    errors.push({
      code: 'CURRENCY_MIXED_IN_LINE_SET',
      message: `A journal must be a single currency; found ${[...currencies].join(', ')}`,
      ...at({}),
    });
  }

  journal.lines.forEach((line, lineIndex) => {
    // Guard against untyped (e.g. JSON-parsed) input where `side` may be junk.
    if (line.side !== 'debit' && line.side !== 'credit') {
      errors.push({
        code: 'INVALID_SIDE',
        message: `Line side must be 'debit' or 'credit', got ${JSON.stringify(line.side)}`,
        ...at({ lineIndex }),
      });
    }
    if (!isPositive(line.amount)) {
      errors.push({
        code: 'NON_POSITIVE_AMOUNT',
        message: `Line amount must be strictly positive (direction is carried by side)`,
        ...at({ lineIndex }),
      });
    }
    const account = accounts.get(line.accountId);
    if (!account) {
      errors.push({
        code: 'ACCOUNT_NOT_FOUND',
        message: `Unknown account ${line.accountId}`,
        ...at({ lineIndex }),
      });
    } else if (account.entityId !== journal.entityId) {
      errors.push({
        code: 'ENTITY_MISMATCH',
        message: `Account ${account.id} belongs to entity ${account.entityId}, not ${journal.entityId}`,
        ...at({ lineIndex }),
      });
    }
  });

  // Only meaningful to check balance when the currency is consistent.
  if (!mixedCurrency) {
    const currency = journal.lines[0]!.amount.currency;
    const { debit, credit } = sideTotals(journal.lines, currency);
    if (!equals(debit, credit)) {
      errors.push({
        code: 'UNBALANCED_JOURNAL',
        message: `Debits (${debit.amount}) != credits (${credit.amount}) ${currency}`,
        ...at({}),
      });
    }

    // Reject economic no-ops (e.g. debit Cash / credit Cash), where every
    // account nets to zero — a balanced journal with no real effect.
    const perAccount = new Map<string, number>();
    for (const line of journal.lines) {
      const delta = line.side === 'debit' ? line.amount.amount : -line.amount.amount;
      perAccount.set(line.accountId, (perAccount.get(line.accountId) ?? 0) + delta);
    }
    if (perAccount.size > 0 && [...perAccount.values()].every((v) => v === 0)) {
      errors.push({
        code: 'NO_OP_JOURNAL',
        message: 'Journal has no net effect (every account nets to zero)',
        ...at({}),
      });
    }
  }

  return errors;
}

/**
 * Validate a batch: every journal must independently balance per entity, and
 * the batch must balance per currency across all journals.
 *
 * NOTE (Codex Gate 1.2): because each journal is already required to balance,
 * the batch-level total is a sanity check, not the full intercompany invariant.
 * True due-to/due-from *counterparty-pair* netting requires accounts to carry a
 * counterparty reference, which is deferred to the consolidation work (Phase 7,
 * see docs/ARCHITECTURE.md §3.1). We do not claim to enforce it here.
 */
export function validateBatch(
  batch: BatchInput,
  accounts: AccountLookup,
): Result<BatchInput, LedgerError[]> {
  const errors: LedgerError[] = [];

  if (batch.journals.length === 0) {
    return err([{ code: 'EMPTY_BATCH', message: 'Batch has no journals' }]);
  }

  batch.journals.forEach((journal, i) => {
    errors.push(...validateJournal(journal, accounts, i));
  });

  // Batch-level per-currency balance across all lines.
  const totalsByCurrency = new Map<string, { debit: Money; credit: Money }>();
  for (const journal of batch.journals) {
    for (const line of journal.lines) {
      const cur = line.amount.currency;
      const cell = totalsByCurrency.get(cur) ?? { debit: zero(cur), credit: zero(cur) };
      if (line.side === 'debit') cell.debit = add(cell.debit, line.amount);
      else cell.credit = add(cell.credit, line.amount);
      totalsByCurrency.set(cur, cell);
    }
  }
  for (const [cur, { debit, credit }] of totalsByCurrency) {
    if (!equals(debit, credit)) {
      errors.push({
        code: 'UNBALANCED_BATCH',
        message: `Batch debits (${debit.amount}) != credits (${credit.amount}) ${cur}`,
      });
    }
  }

  return errors.length === 0 ? ok(batch) : err(errors);
}

/**
 * Compute per-account balances from a set of posted lines (already validated).
 * `netDebitMinusCredit` is signed for trial-balance summation; `normalBalance`
 * orients it to the account's normal side. Single currency per call.
 */
export function accountBalances(
  lines: readonly (JournalLineInput & { readonly entityId: string })[],
  accounts: AccountLookup,
  currency: string,
): AccountBalance[] {
  const net = new Map<string, Money>();
  for (const line of lines) {
    if (line.amount.currency !== currency) continue;
    const prev = net.get(line.accountId) ?? zero(currency);
    net.set(
      line.accountId,
      line.side === 'debit' ? add(prev, line.amount) : sub(prev, line.amount),
    );
  }

  const out: AccountBalance[] = [];
  for (const [accountId, netDebitMinusCredit] of net) {
    const account = accounts.get(accountId);
    if (!account) continue;
    const normalBalance =
      normalSideOf(account.type) === 'debit' ? netDebitMinusCredit : negate(netDebitMinusCredit);
    out.push({ accountId, type: account.type, netDebitMinusCredit, normalBalance });
  }
  return out;
}

/**
 * Trial balance for a set of posted lines in one currency: the signed sum of
 * all accounts' debit-minus-credit. For any balanced posted set this is zero.
 */
export function trialBalanceNet(
  lines: readonly (JournalLineInput & { readonly entityId: string })[],
  accounts: AccountLookup,
  currency: string,
): Money {
  let total = zero(currency);
  for (const bal of accountBalances(lines, accounts, currency)) {
    total = add(total, bal.netDebitMinusCredit);
  }
  return total;
}
