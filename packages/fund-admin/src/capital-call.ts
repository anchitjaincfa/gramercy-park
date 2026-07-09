import { money } from '@gramercy/core';
import type { BatchInput, JournalInput, JournalLineInput } from '@gramercy/ledger';
import type { CapitalCall } from './types';

/**
 * Build a balanced, single-entity (fund) ledger batch for a capital call.
 *
 * For each `contribution` allocation we post a matched pair: a DEBIT to the
 * cash account and a CREDIT to the (partners') capital account for the
 * allocated amount. Because every debit has an equal-and-opposite credit, the
 * journal (and thus the batch) balances by construction. Non-contribution
 * allocation kinds (recall / fee_offset) are handled by other builders and are
 * ignored here.
 *
 * The `idempotencyKey` (`call:<id>`) makes re-submitting the same call a no-op
 * at the persistence layer (see docs/ARCHITECTURE.md §8, §9).
 */
export function buildCapitalCallBatch(
  call: CapitalCall,
  opts: { cashAccountId: string; capitalAccountId: string; sourceType?: string },
): BatchInput {
  const lines: JournalLineInput[] = [];
  for (const alloc of call.allocations) {
    if (alloc.kind !== 'contribution') continue;
    const amount = money(alloc.amountMinor, call.currency);
    lines.push({ accountId: opts.cashAccountId, side: 'debit', amount });
    lines.push({ accountId: opts.capitalAccountId, side: 'credit', amount });
  }

  // A call with no contribution allocations (e.g. recall-only) has nothing to
  // post here and would produce an EMPTY_JOURNAL that the ledger rejects. Fail
  // loudly rather than emit an invalid batch.
  if (lines.length === 0) {
    throw new Error(
      `buildCapitalCallBatch: call ${call.id} has no contribution allocations to post`,
    );
  }

  const journal: JournalInput = {
    entityId: call.fundId,
    date: call.callDate,
    memo: call.purpose,
    lines,
  };

  return {
    date: call.callDate,
    memo: call.purpose,
    sourceType: opts.sourceType ?? 'capital_call',
    sourceId: call.id,
    idempotencyKey: `call:${call.id}`,
    journals: [journal],
  };
}
