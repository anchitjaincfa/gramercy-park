import { allocate, money } from '@gramercy/core';
import type { CapitalCallAllocation } from './types';

/**
 * Allocate a capital call `totalMinor` pro-rata to each LP's uncalled
 * commitment. Uses the core `allocate` (largest-remainder), so the returned
 * allocation amounts sum EXACTLY to `totalMinor` — no cent created or lost.
 *
 * LPs with `uncalledMinor === 0` carry weight 0 and therefore receive 0; those
 * zero-amount allocations are omitted from the result. If every LP's uncalled
 * amount is 0 there is nothing to allocate against, so we throw rather than
 * silently produce an empty (and unbalanced) call.
 */
export function allocateCapitalCall(
  totalMinor: number,
  currency: string,
  perLp: readonly { lpId: string; uncalledMinor: number }[],
): CapitalCallAllocation[] {
  if (!Number.isInteger(totalMinor) || totalMinor <= 0) {
    throw new Error(`allocateCapitalCall requires a positive integer total, got ${totalMinor}`);
  }
  if (perLp.length === 0) {
    throw new Error('allocateCapitalCall requires at least one LP');
  }
  for (const p of perLp) {
    if (!Number.isInteger(p.uncalledMinor) || p.uncalledMinor < 0) {
      throw new Error(
        `uncalledMinor must be a non-negative integer; ${p.lpId} = ${p.uncalledMinor}`,
      );
    }
  }

  const totalUncalled = perLp.reduce((sum, p) => sum + p.uncalledMinor, 0);
  if (totalUncalled === 0) {
    throw new Error(
      'allocateCapitalCall requires a positive total uncalled commitment; all LPs are fully called',
    );
  }

  // Canonical, deterministic tie-break: allocate in ascending lpId order so the
  // largest-remainder "lowest index first" crumb rule maps to the lowest lpId
  // (docs/ARCHITECTURE.md §4.2), independent of the caller's input order.
  const ordered = [...perLp].sort((a, b) => (a.lpId < b.lpId ? -1 : a.lpId > b.lpId ? 1 : 0));

  const parts = allocate(
    money(totalMinor, currency),
    ordered.map((p) => p.uncalledMinor),
  );

  const allocations: CapitalCallAllocation[] = [];
  ordered.forEach((p, i) => {
    const amountMinor = parts[i]!.amount;
    if (amountMinor === 0) return; // omit zero allocations
    allocations.push({ lpId: p.lpId, amountMinor, kind: 'contribution' });
  });

  return allocations;
}
