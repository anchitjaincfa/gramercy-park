/**
 * NAV (net asset value) computation (docs/ARCHITECTURE.md §4).
 *
 * NAV is read purely from the POSTED general ledger:
 *
 *   NAV = Σ(asset accounts' normalBalance) − Σ(liability accounts' normalBalance)
 *
 * Per-LP NAV shares allocate the total NAV across LPs pro-rata to their
 * capital-account balances, using the exact largest-remainder method from
 * `@gramercy/core` so the shares always sum back to the total — no cent created
 * or destroyed.
 */

import type { Account, JournalLineInput } from '@gramercy/ledger';
import { accountBalances } from '@gramercy/ledger';
import { allocate, money } from '@gramercy/core';
import type { CapitalAccountBalance, NavSnapshotLpShare } from './types';

/** Add two safe integers, throwing rather than silently losing cents. */
function checkedAdd(a: number, b: number): number {
  const sum = a + b;
  if (!Number.isSafeInteger(sum)) {
    throw new Error(`NAV total overflowed the safe-integer range: ${a} + ${b}`);
  }
  return sum;
}

/**
 * Net asset value in integer minor units, computed purely from the posted GL.
 *
 * NAV = Σ(asset accounts' normal balance) − Σ(liability accounts' normal
 * balance). Equity/income/expense accounts do not contribute directly — NAV is
 * an assets-minus-liabilities read, and their effect is already reflected in the
 * asset and liability balances.
 */
export function computeNav(
  lines: readonly (JournalLineInput & { entityId: string })[],
  accounts: ReadonlyMap<string, Account>,
  currency: string,
): number {
  const balances = accountBalances(lines, accounts, currency);
  let assets = 0;
  let liabilities = 0;
  for (const bal of balances) {
    if (bal.type === 'asset') assets = checkedAdd(assets, bal.normalBalance.amount);
    else if (bal.type === 'liability')
      liabilities = checkedAdd(liabilities, bal.normalBalance.amount);
  }
  return checkedAdd(assets, -liabilities);
}

/**
 * Allocate `totalNavMinor` across LPs pro-rata to each LP's capital-account
 * `balanceMinor`. Weights are clamped to `max(0, balanceMinor)` — an LP with a
 * non-positive capital balance receives no NAV share. LPs are processed in
 * ascending `lpId` order so the largest-remainder tie-break is canonical
 * (deterministic regardless of input map order). Zero shares are omitted.
 *
 * Returns `[]` only when `totalNavMinor` is 0. Weights use each LP's positive
 * capital balance; an LP with a non-positive balance is not credited a share
 * (deficit-LP forfeiture — positive-balance LPs absorb the NAV). The returned
 * shares sum EXACTLY to `totalNavMinor`. `totalNavMinor` must be a non-negative
 * safe integer; if there is NAV to distribute (> 0) but no LP has a positive
 * balance, we THROW rather than emit an unreconciled snapshot.
 */
export function computeNavPerLp(
  totalNavMinor: number,
  capitalAccounts: ReadonlyMap<string, CapitalAccountBalance>,
  currency: string,
): NavSnapshotLpShare[] {
  if (!Number.isSafeInteger(totalNavMinor) || totalNavMinor < 0) {
    throw new Error(
      `computeNavPerLp requires a non-negative safe integer totalNavMinor, got ${totalNavMinor}`,
    );
  }

  if (totalNavMinor === 0) return [];

  // Canonical order: ascending lpId so the allocate() lowest-index tie-break is
  // deterministic with respect to lpId rather than map insertion order.
  const lpIds = [...capitalAccounts.keys()].sort();
  const weights = lpIds.map((lpId) => Math.max(0, capitalAccounts.get(lpId)!.balanceMinor));

  const totalWeight = weights.reduce((acc, w) => acc + w, 0);
  if (totalWeight === 0) {
    // Positive NAV but nothing to allocate against → would leave the snapshot
    // unreconciled (shares would sum to 0, not totalNavMinor). Fail loudly.
    throw new Error(
      `computeNavPerLp: ${totalNavMinor} NAV to distribute but no LP has a positive capital balance`,
    );
  }

  const parts = allocate(money(totalNavMinor, currency), weights);

  const shares: NavSnapshotLpShare[] = [];
  for (let i = 0; i < lpIds.length; i++) {
    const navShareMinor = parts[i]!.amount;
    if (navShareMinor === 0) continue; // omit zero shares
    shares.push({ lpId: lpIds[i]!, navShareMinor });
  }
  return shares;
}
