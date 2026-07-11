/**
 * Live demo of the journal-entry agent (Phase 4). Requires ANTHROPIC_API_KEY.
 *
 *   ANTHROPIC_API_KEY=sk-ant-... npm run -w @gramercy/agents demo
 *
 * It hits the real Claude API to PREPARE a journal entry from a bill, then runs
 * it through the human-review boundary to produce a ledger-valid batch. Nothing
 * is posted — this is the "AI prepares, expert reviews" flow end to end.
 */
import type { Account } from '@gramercy/ledger';
import { isOk } from '@gramercy/core';
import { createAnthropic, anthropicJournalEntryProposer } from '../src/client';
import { proposeJournalEntry } from '../src/journal-entry';
import { approveJournalEntry } from '../src/review-queue';
import type { JournalEntryContext } from '../src/types';

const ACCOUNTS: Account[] = [
  { id: 'a_cash', entityId: 'fund1', code: '1000', name: 'Cash', type: 'asset' },
  { id: 'a_ap', entityId: 'fund1', code: '2000', name: 'Accounts Payable', type: 'liability' },
  { id: 'a_legal', entityId: 'fund1', code: '6200', name: 'Professional Fees', type: 'expense' },
  { id: 'a_admin', entityId: 'fund1', code: '6400', name: 'Fund Admin Fees', type: 'expense' },
];

const BILL = `INVOICE  —  Wilson & Marsh LLP
Bill to: Gramercy Ventures Fund I, L.P.
Date: 2026-03-14   Invoice #: WM-2048
For: Legal services rendered in connection with Q1 portfolio-company financings.
Amount due: $12,500.00   Terms: Net 30`;

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('ANTHROPIC_API_KEY is not set — skipping the live demo.');
    console.log(
      'Set it and re-run:  ANTHROPIC_API_KEY=sk-ant-... npm run -w @gramercy/agents demo',
    );
    return;
  }

  const client = createAnthropic();
  const proposer = anthropicJournalEntryProposer(client);

  const ctx: JournalEntryContext = {
    entityId: 'fund1',
    currency: 'USD',
    sourceRef: 'WM-2048',
    documentText: BILL,
    chartOfAccounts: ACCOUNTS.map((a) => ({ code: a.code, name: a.name, type: a.type })),
  };

  console.log('→ Asking Claude to PREPARE a journal entry from the bill...\n');
  const proposal = await proposeJournalEntry(ctx, proposer);

  console.log(`Proposal (model=${proposal.model}, confidence=${proposal.confidence}):`);
  console.log(JSON.stringify(proposal.payload, null, 2));
  console.log('\nEvidence:');
  for (const e of proposal.evidence) console.log(`  ${e.field} ← "${e.quote}" (${e.sourceRef})`);

  console.log('\n→ Expert approves; re-validating against the ledger...\n');
  const result = approveJournalEntry(proposal, {
    accounts: ACCOUNTS,
    sourceType: 'bill',
    sourceId: 'WM-2048',
    idempotencyKey: 'bill:WM-2048',
    preparerUserId: 'ai-agent',
    approverUserId: 'controller',
    approverRole: 'reviewer',
    approvalPolicies: [{ role: 'reviewer', maxAmountMinor: null }],
  });

  if (isOk(result)) {
    console.log('✓ Approved — ledger-valid batch ready to post:');
    console.log(JSON.stringify(result.value, null, 2));
  } else {
    console.log('✗ Rejected at the review boundary:');
    for (const err of result.error) console.log(`  [${err.code}] ${err.message}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
