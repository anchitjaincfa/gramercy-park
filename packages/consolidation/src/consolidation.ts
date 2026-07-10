import { type Money, add, zero, isZero, negate } from '@gramercy/core';
import {
  type Account,
  type AccountType,
  type JournalLineInput,
  accountBalances,
  normalSideOf,
} from '@gramercy/ledger';

/**
 * One entity's general ledger: its identifier plus the posted lines that belong
 * to it. Each line carries its own `entityId` (matching `entityId`), mirroring
 * the shape the ledger engine consumes.
 */
export interface EntityLedger {
  readonly entityId: string;
  readonly lines: readonly (JournalLineInput & { readonly entityId: string })[];
}

/**
 * An intercompany elimination: the due-from account on one entity and the
 * matching due-to account on its counterparty. On consolidation these two
 * balances must net to zero and are removed from the group trial balance so the
 * group is not double-counted.
 */
export interface IntercompanyPair {
  readonly dueToAccountId: string;
  readonly dueFromAccountId: string;
}

/**
 * A single line of a trial balance (per-entity or group). Same shape as the
 * ledger's `AccountBalance`, restated here as the consolidation output unit.
 */
export interface ConsolidatedLine {
  readonly accountId: string;
  readonly type: AccountType;
  /** Signed net in debit-minus-credit terms (for trial-balance summation). */
  readonly netDebitMinusCredit: Money;
  /** Balance in the account's own normal-side orientation. */
  readonly normalBalance: Money;
}

export interface Consolidation {
  /** Each entity's own trial balance, keyed by entityId. */
  readonly byEntity: Map<string, ConsolidatedLine[]>;
  /** The consolidated group trial balance, after eliminations. */
  readonly group: ConsolidatedLine[];
  /** Total magnitude (minor units, normal-side) removed by all eliminations. */
  readonly eliminatedMinor: number;
  /** True iff the group trial balance nets to zero (it always must). */
  readonly groupTrialBalanceNets: boolean;
}

type AccountLookup = ReadonlyMap<string, Account>;

/** Build a `ConsolidatedLine` for `accountId` from a signed debit-minus-credit net. */
function lineFor(
  accountId: string,
  netDebitMinusCredit: Money,
  accounts: AccountLookup,
): ConsolidatedLine {
  const account = accounts.get(accountId);
  if (!account) {
    throw new Error(`Unknown account ${accountId}`);
  }
  const normalBalance =
    normalSideOf(account.type) === 'debit' ? netDebitMinusCredit : negate(netDebitMinusCredit);
  return { accountId, type: account.type, netDebitMinusCredit, normalBalance };
}

/**
 * Signed sum of every line's debit-minus-credit net, in one currency. For any
 * balanced set of posted lines this is zero.
 */
export function groupTrialBalanceNet(group: readonly ConsolidatedLine[], currency: string): Money {
  let total = zero(currency);
  for (const line of group) {
    if (line.netDebitMinusCredit.currency !== currency) {
      throw new Error(
        `Currency mismatch in group line ${line.accountId}: expected ${currency}, got ${line.netDebitMinusCredit.currency}`,
      );
    }
    total = add(total, line.netDebitMinusCredit);
  }
  return total;
}

/**
 * Consolidate several entities into one group trial balance, eliminating the
 * given intercompany due-to/due-from pairs.
 *
 * Steps:
 *  1. Compute each entity's per-account balances (reusing the ledger engine).
 *  2. Sum balances across entities by accountId to form the pre-elimination
 *     group set.
 *  3. For each elimination pair, verify Σ dueTo == Σ dueFrom (they net to zero),
 *     record the eliminated magnitude, and drop both accounts from the group.
 *  4. Assert the resulting group trial balance nets to zero.
 *
 * Pure and deterministic. Throws on a currency mismatch or on an elimination
 * pair whose two legs do not net to zero.
 */
/** Add two safe integers, throwing rather than silently losing minor units. */
function checkedAddMinor(a: number, b: number): number {
  const sum = a + b;
  if (!Number.isSafeInteger(sum)) {
    throw new Error(
      `consolidation eliminated total overflowed the safe-integer range: ${a} + ${b}`,
    );
  }
  return sum;
}

export function consolidate(
  entities: readonly EntityLedger[],
  accounts: AccountLookup,
  eliminations: readonly IntercompanyPair[],
  currency: string,
): Consolidation {
  const byEntity = new Map<string, ConsolidatedLine[]>();
  // Signed debit-minus-credit net per accountId, summed across all entities.
  const groupNet = new Map<string, Money>();
  const seenEntities = new Set<string>();

  for (const entity of entities) {
    if (seenEntities.has(entity.entityId)) {
      throw new Error(`duplicate entityId in consolidation: ${entity.entityId}`);
    }
    seenEntities.add(entity.entityId);

    for (const line of entity.lines) {
      // Reject a different currency up front; the ledger engine would otherwise
      // silently skip it.
      if (line.amount.currency !== currency) {
        throw new Error(
          `Currency mismatch in entity ${entity.entityId}: expected ${currency}, got ${line.amount.currency}`,
        );
      }
      // Reject unknown accounts up front; accountBalances silently drops them,
      // which would make the group trial balance spuriously non-zero.
      if (!accounts.has(line.accountId)) {
        throw new Error(`Unknown account ${line.accountId} in entity ${entity.entityId}`);
      }
    }

    const balances = accountBalances(entity.lines, accounts, currency);
    const entityLines: ConsolidatedLine[] = balances.map((b) => ({
      accountId: b.accountId,
      type: b.type,
      netDebitMinusCredit: b.netDebitMinusCredit,
      normalBalance: b.normalBalance,
    }));
    byEntity.set(entity.entityId, entityLines);

    for (const b of balances) {
      const prev = groupNet.get(b.accountId) ?? zero(currency);
      groupNet.set(b.accountId, add(prev, b.netDebitMinusCredit));
    }
  }

  // Apply eliminations. An intercompany pair must be a genuine due-from
  // (receivable, ASSET) against a due-to (payable, LIABILITY) in DIFFERENT
  // entities, and the two legs must net to zero — so a caller cannot accidentally
  // eliminate real cash/expense accounts that merely happen to offset.
  let eliminatedMinor = 0;
  const eliminatedAccounts = new Set<string>();
  for (const pair of eliminations) {
    const fromAcct = accounts.get(pair.dueFromAccountId);
    const toAcct = accounts.get(pair.dueToAccountId);
    if (!fromAcct || !toAcct) {
      throw new Error(
        `elimination references unknown account (${pair.dueFromAccountId} / ${pair.dueToAccountId})`,
      );
    }
    if (fromAcct.type !== 'asset') {
      throw new Error(`due-from ${pair.dueFromAccountId} must be an asset (receivable)`);
    }
    if (toAcct.type !== 'liability') {
      throw new Error(`due-to ${pair.dueToAccountId} must be a liability (payable)`);
    }
    if (fromAcct.entityId === toAcct.entityId) {
      throw new Error(
        `intercompany elimination legs must belong to different entities (${fromAcct.entityId})`,
      );
    }
    if (
      eliminatedAccounts.has(pair.dueFromAccountId) ||
      eliminatedAccounts.has(pair.dueToAccountId)
    ) {
      throw new Error(`an account cannot be eliminated more than once`);
    }

    const dueFrom = groupNet.get(pair.dueFromAccountId) ?? zero(currency);
    const dueTo = groupNet.get(pair.dueToAccountId) ?? zero(currency);
    const pairNet = add(dueFrom, dueTo);
    if (!isZero(pairNet)) {
      throw new Error(
        `Intercompany elimination pair does not net to zero: ` +
          `dueFrom ${pair.dueFromAccountId} (${dueFrom.amount}) + ` +
          `dueTo ${pair.dueToAccountId} (${dueTo.amount}) = ${pairNet.amount} ${currency}`,
      );
    }
    // Magnitude eliminated: the absolute size of either leg (they are equal).
    eliminatedMinor = checkedAddMinor(eliminatedMinor, Math.abs(dueFrom.amount));
    eliminatedAccounts.add(pair.dueFromAccountId);
    eliminatedAccounts.add(pair.dueToAccountId);
    groupNet.delete(pair.dueFromAccountId);
    groupNet.delete(pair.dueToAccountId);
  }

  const group: ConsolidatedLine[] = [];
  for (const [accountId, net] of groupNet) {
    group.push(lineFor(accountId, net, accounts));
  }

  // Fail loud: a balanced set of entities minus balanced eliminations MUST net
  // to zero. Return only a proven-zero group.
  const groupNetMoney = groupTrialBalanceNet(group, currency);
  if (!isZero(groupNetMoney)) {
    throw new Error(
      `consolidated group trial balance does not net to zero: ${groupNetMoney.amount} ${currency}`,
    );
  }

  return { byEntity, group, eliminatedMinor, groupTrialBalanceNets: true };
}
