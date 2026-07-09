import { money } from '@gramercy/core';
import type { BatchInput, JournalInput, JournalLineInput } from '@gramercy/ledger';
import type { Valuation } from './types';

/**
 * Build a balanced, single-entity ledger batch that marks an investment to a new
 * fair value (docs/ARCHITECTURE.md §4.1).
 *
 * An investment's carrying value lives in a GL asset account
 * (`investmentAccountId`). Approving a new mark posts a mark-to-market journal
 * that moves that carrying account to the new fair value against an unrealized
 * gain/loss account (`unrealizedGainAccountId`) — so NAV read purely from the
 * GL never double-counts the change.
 *
 *   delta = newFairValueMinor − currentCarryingMinor
 *     delta > 0 (mark UP)   → DEBIT investment (asset up) / CREDIT unrealized G/L
 *     delta < 0 (mark DOWN) → DEBIT unrealized G/L        / CREDIT investment
 *
 * Because the single line pair is equal-and-opposite, the journal (and batch)
 * balances by construction. A zero delta has nothing to post and would produce
 * an EMPTY_JOURNAL / no-op, so we throw rather than emit an invalid batch.
 *
 * The `idempotencyKey` (`mtm:<sourceId>`) makes re-submitting the same mark a
 * no-op at the persistence layer (see docs/ARCHITECTURE.md §8, §9).
 *
 * The account/amount/currency fields mirror the approved {@link Valuation}
 * record that triggers the mark.
 */
export function buildMarkToMarketBatch(opts: {
  entityId: string;
  date: string;
  investmentAccountId: Valuation['investmentAccountId'];
  unrealizedGainAccountId: string;
  currentCarryingMinor: number;
  newFairValueMinor: Valuation['fairValueMinor'];
  currency: Valuation['currency'];
  sourceId: string;
  sourceType?: string;
}): BatchInput {
  const {
    entityId,
    date,
    investmentAccountId,
    unrealizedGainAccountId,
    currentCarryingMinor,
    newFairValueMinor,
    currency,
    sourceId,
    sourceType,
  } = opts;

  if (investmentAccountId === unrealizedGainAccountId) {
    throw new Error('buildMarkToMarketBatch: investment and unrealized gain accounts must differ');
  }
  if (!Number.isSafeInteger(currentCarryingMinor) || !Number.isSafeInteger(newFairValueMinor)) {
    throw new Error(
      `buildMarkToMarketBatch: carrying and fair value must be safe integers, got ${currentCarryingMinor} and ${newFairValueMinor}`,
    );
  }
  if (newFairValueMinor < 0) {
    throw new Error(
      `buildMarkToMarketBatch: fair value must be non-negative, got ${newFairValueMinor}`,
    );
  }

  const delta = newFairValueMinor - currentCarryingMinor;
  // A zero delta moves nothing: posting it would yield an EMPTY_JOURNAL (no
  // lines) / no-op. Fail loudly rather than emit an invalid batch.
  if (delta === 0) {
    throw new Error(
      `buildMarkToMarketBatch: new fair value equals carrying value (${newFairValueMinor}); nothing to mark`,
    );
  }

  // Direction is carried by `side`; line amounts are always strictly positive.
  const amount = money(Math.abs(delta), currency);
  const lines: JournalLineInput[] =
    delta > 0
      ? // Mark UP: asset rises, recognize unrealized gain.
        [
          { accountId: investmentAccountId, side: 'debit', amount },
          { accountId: unrealizedGainAccountId, side: 'credit', amount },
        ]
      : // Mark DOWN: recognize unrealized loss, asset falls.
        [
          { accountId: unrealizedGainAccountId, side: 'debit', amount },
          { accountId: investmentAccountId, side: 'credit', amount },
        ];

  const memo = `Mark-to-market ${investmentAccountId} @ ${date}`;

  const journal: JournalInput = {
    entityId,
    date,
    memo,
    lines,
  };

  return {
    date,
    memo,
    sourceType: sourceType ?? 'valuation',
    sourceId,
    idempotencyKey: `mtm:${sourceId}`,
    journals: [journal],
  };
}
