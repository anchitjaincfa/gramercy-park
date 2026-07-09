import type { JournalEntryContext, JournalEntryProposal, JournalEntryProposer } from './types';
import { PROMPT_VERSION } from './client';

export const JOURNAL_ENTRY_SCHEMA_VERSION = 1;
export const JOURNAL_ENTRY_AGENT = 'journal-entry-agent';

const clamp01 = (n: number): number => (!Number.isFinite(n) ? 0 : n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * Run the journal-entry agent: hand the context to a proposer, then stamp the
 * trust metadata (prompt version, agent name, schema version) ourselves. The
 * model is taken from what the proposer ACTUALLY used, so audit metadata cannot
 * drift. Returns a propose-only proposal — it does NOT post. Posting happens
 * only via review-queue approval.
 */
export async function proposeJournalEntry(
  ctx: JournalEntryContext,
  proposer: JournalEntryProposer,
): Promise<JournalEntryProposal> {
  const raw = await proposer.propose(ctx);
  return {
    kind: 'journal_entry',
    schemaVersion: JOURNAL_ENTRY_SCHEMA_VERSION,
    payload: raw.payload,
    evidence: raw.evidence,
    confidence: clamp01(raw.confidence),
    model: raw.model,
    promptVersion: PROMPT_VERSION,
    createdByAgent: JOURNAL_ENTRY_AGENT,
  };
}
