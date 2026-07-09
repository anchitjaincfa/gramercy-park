import type { CapitalAccountEvent, CapitalAccountBalance } from './types';

/**
 * Deterministic capital-account reconstruction (docs/ARCHITECTURE.md §4.2).
 *
 * An LP's capital account is rebuilt by folding that LP's events in a stable,
 * date-ascending order:
 *
 *   balanceMinor = contributedMinor − distributedMinor − feesMinor + allocatedPnlMinor
 *
 * `pnl_allocation` amounts may be NEGATIVE (a loss allocation); every other kind
 * (`contribution`, `distribution`, `mgmt_fee`) is a non-negative magnitude whose
 * sign in the formula is implied by its kind. All arithmetic is exact integer
 * minor units — never floats — so cents are neither created nor lost, and the
 * per-LP balances always reconcile to the fund's partners'-capital GL.
 */

function assertIntegerAmount(event: CapitalAccountEvent): void {
  // Require a *safe* integer: like `Money`, we reject values past ±(2^53 − 1)
  // rather than let plain-number addition silently drop cents.
  if (!Number.isSafeInteger(event.amountMinor)) {
    throw new Error(
      `capital-account event amountMinor must be a safe integer; ${event.lpId}/${event.kind} = ${event.amountMinor}`,
    );
  }
  // pnl_allocation may be any integer (losses are negative); all others are
  // non-negative magnitudes.
  if (event.kind !== 'pnl_allocation' && event.amountMinor < 0) {
    throw new Error(
      `capital-account ${event.kind} amountMinor must be a non-negative integer; ${event.lpId} = ${event.amountMinor}`,
    );
  }
}

/** Add two safe integers, throwing rather than silently losing precision. */
function checkedAdd(a: number, b: number): number {
  const sum = a + b;
  if (!Number.isSafeInteger(sum)) {
    throw new Error(`capital-account arithmetic overflowed the safe-integer range: ${a} + ${b}`);
  }
  return sum;
}

function emptyBalance(lpId: string): CapitalAccountBalance {
  return {
    lpId,
    contributedMinor: 0,
    distributedMinor: 0,
    feesMinor: 0,
    allocatedPnlMinor: 0,
    balanceMinor: 0,
  };
}

/**
 * Fold a single LP's events (already validated) into a balance. Events are
 * processed in a stable date-ascending order: sort by `date` ascending with the
 * original input index as a deterministic tie-break, so events sharing a date
 * keep their input order.
 */
function foldLpEvents(lpId: string, events: readonly CapitalAccountEvent[]): CapitalAccountBalance {
  const ordered = events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => {
      if (a.event.date < b.event.date) return -1;
      if (a.event.date > b.event.date) return 1;
      return a.index - b.index; // stable tie-break: keep input order
    });

  const acc = emptyBalance(lpId);
  for (const { event } of ordered) {
    switch (event.kind) {
      case 'contribution':
        acc.contributedMinor = checkedAdd(acc.contributedMinor, event.amountMinor);
        break;
      case 'distribution':
        acc.distributedMinor = checkedAdd(acc.distributedMinor, event.amountMinor);
        break;
      case 'mgmt_fee':
        acc.feesMinor = checkedAdd(acc.feesMinor, event.amountMinor);
        break;
      case 'pnl_allocation':
        acc.allocatedPnlMinor = checkedAdd(acc.allocatedPnlMinor, event.amountMinor);
        break;
      default: {
        // Exhaustiveness guard: a new CapitalAccountEventKind must be handled.
        const _exhaustive: never = event.kind;
        throw new Error(`unhandled capital-account event kind: ${String(_exhaustive)}`);
      }
    }
  }

  let balance = checkedAdd(acc.contributedMinor, acc.allocatedPnlMinor);
  balance = checkedAdd(balance, -acc.distributedMinor);
  balance = checkedAdd(balance, -acc.feesMinor);
  acc.balanceMinor = balance;
  return acc;
}

/**
 * Rebuild every LP's capital account from a flat event stream. Events are
 * grouped by `lpId`, then each group is folded deterministically. Returns a map
 * keyed by `lpId`. Throws if any non-`pnl_allocation` amount is negative or any
 * amount is non-integer.
 */
export function buildCapitalAccounts(
  events: readonly CapitalAccountEvent[],
): Map<string, CapitalAccountBalance> {
  // Validate up front so a bad amount fails fast regardless of grouping.
  for (const event of events) {
    assertIntegerAmount(event);
  }

  // Group by lpId, preserving first-seen input order within each LP's group.
  const byLp = new Map<string, CapitalAccountEvent[]>();
  for (const event of events) {
    const group = byLp.get(event.lpId);
    if (group) {
      group.push(event);
    } else {
      byLp.set(event.lpId, [event]);
    }
  }

  // Canonical, deterministic output order: iterate lpIds ascending so the
  // returned Map's iteration order does not depend on input event order.
  const accounts = new Map<string, CapitalAccountBalance>();
  for (const lpId of [...byLp.keys()].sort()) {
    accounts.set(lpId, foldLpEvents(lpId, byLp.get(lpId)!));
  }
  return accounts;
}

/**
 * Convenience: the capital-account balance for a single LP, computed from the
 * subset of `events` belonging to that LP. An LP with no events yields an empty
 * account (all zeros) rather than throwing.
 */
export function capitalAccountBalance(
  events: readonly CapitalAccountEvent[],
  lpId: string,
): CapitalAccountBalance {
  const relevant = events.filter((event) => event.lpId === lpId);
  if (relevant.length === 0) {
    return emptyBalance(lpId);
  }
  for (const event of relevant) {
    assertIntegerAmount(event);
  }
  return foldLpEvents(lpId, relevant);
}

/**
 * Sum of every LP's `balanceMinor`. This total must reconcile to the fund's
 * partners'-capital GL (docs/ARCHITECTURE.md §4.2). Exact integer arithmetic.
 */
export function totalFundCapital(accounts: Map<string, CapitalAccountBalance>): number {
  let total = 0;
  for (const account of accounts.values()) {
    total = checkedAdd(total, account.balanceMinor);
  }
  return total;
}
