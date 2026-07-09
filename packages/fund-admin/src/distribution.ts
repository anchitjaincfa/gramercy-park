import { allocate, money } from '@gramercy/core';
import type { BatchInput, JournalInput, JournalLineInput } from '@gramercy/ledger';
import type { Distribution, DistributionAllocation } from './types';

/**
 * Allocate a distribution `totalMinor` pro-rata to each LP's `weightMinor`
 * (e.g. capital-account balance). Uses the core `allocate` (largest-remainder),
 * so the returned allocation amounts sum EXACTLY to `totalMinor` — no cent
 * created or lost.
 *
 * LPs with `weightMinor === 0` carry weight 0 and therefore receive 0; those
 * zero-amount allocations are omitted from the result. If every LP's weight is
 * 0 there is nothing to allocate against, so we throw rather than silently
 * produce an empty (and unbalanced) distribution.
 */
export function allocateDistribution(
  totalMinor: number,
  currency: string,
  perLp: readonly { lpId: string; weightMinor: number }[],
): DistributionAllocation[] {
  if (!Number.isInteger(totalMinor) || totalMinor <= 0) {
    throw new Error(`allocateDistribution requires a positive integer total, got ${totalMinor}`);
  }
  if (perLp.length === 0) {
    throw new Error('allocateDistribution requires at least one LP');
  }
  const seen = new Set<string>();
  for (const p of perLp) {
    if (!Number.isInteger(p.weightMinor) || p.weightMinor < 0) {
      throw new Error(`weightMinor must be a non-negative integer; ${p.lpId} = ${p.weightMinor}`);
    }
    if (seen.has(p.lpId)) throw new Error(`duplicate lpId in allocateDistribution: ${p.lpId}`);
    seen.add(p.lpId);
  }

  const totalWeight = perLp.reduce((sum, p) => sum + p.weightMinor, 0);
  if (totalWeight === 0) {
    throw new Error(
      'allocateDistribution requires a positive total weight; all LP weights are zero',
    );
  }

  // Canonical, deterministic tie-break: allocate in ascending lpId order so the
  // largest-remainder "lowest index first" crumb rule maps to the lowest lpId
  // (docs/ARCHITECTURE.md §4.2), independent of the caller's input order.
  const ordered = [...perLp].sort((a, b) => (a.lpId < b.lpId ? -1 : a.lpId > b.lpId ? 1 : 0));

  const parts = allocate(
    money(totalMinor, currency),
    ordered.map((p) => p.weightMinor),
  );

  const allocations: DistributionAllocation[] = [];
  ordered.forEach((p, i) => {
    const amountMinor = parts[i]!.amount;
    if (amountMinor === 0) return; // omit zero allocations
    allocations.push({ lpId: p.lpId, amountMinor });
  });

  return allocations;
}

/**
 * Build a balanced, single-entity (fund) ledger batch for a distribution.
 *
 * A distribution pays cash OUT of the fund. For each allocation we post a
 * matched pair: a DEBIT to the (partners') capital account and a CREDIT to the
 * cash account for the allocated amount — reducing cash and reducing partners'
 * capital. Because every debit has an equal-and-opposite credit, the journal
 * (and thus the batch) balances by construction.
 *
 * The `idempotencyKey` (`dist:<id>`) makes re-submitting the same distribution
 * a no-op at the persistence layer (see docs/ARCHITECTURE.md §8, §9).
 */
export function buildDistributionBatch(
  dist: Distribution,
  opts: { cashAccountId: string; capitalAccountId: string; sourceType?: string },
): BatchInput {
  if (opts.cashAccountId === opts.capitalAccountId) {
    throw new Error('buildDistributionBatch: cash and capital accounts must differ');
  }
  // A distribution with no allocations has nothing to post here. Fail loudly.
  if (dist.allocations.length === 0) {
    throw new Error(`buildDistributionBatch: distribution ${dist.id} has no allocations to post`);
  }
  // The posted amount MUST equal the distribution's declared total; otherwise we
  // would silently under/over-post. Also reject non-positive allocation amounts.
  let allocSum = 0;
  for (const alloc of dist.allocations) {
    if (!Number.isInteger(alloc.amountMinor) || alloc.amountMinor <= 0) {
      throw new Error(
        `buildDistributionBatch: allocation for ${alloc.lpId} must be a positive integer`,
      );
    }
    allocSum += alloc.amountMinor;
  }
  if (allocSum !== dist.totalMinor) {
    throw new Error(
      `buildDistributionBatch: allocations sum ${allocSum} != distribution total ${dist.totalMinor}`,
    );
  }

  const lines: JournalLineInput[] = [];
  for (const alloc of dist.allocations) {
    const amount = money(alloc.amountMinor, dist.currency);
    lines.push({ accountId: opts.capitalAccountId, side: 'debit', amount });
    lines.push({ accountId: opts.cashAccountId, side: 'credit', amount });
  }

  const memo = `Distribution #${dist.number} (${dist.kind})`;

  const journal: JournalInput = {
    entityId: dist.fundId,
    date: dist.date,
    memo,
    lines,
  };

  return {
    date: dist.date,
    memo,
    sourceType: opts.sourceType ?? 'distribution',
    sourceId: dist.id,
    idempotencyKey: `dist:${dist.id}`,
    journals: [journal],
  };
}
