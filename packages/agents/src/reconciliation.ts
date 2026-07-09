import Anthropic from '@anthropic-ai/sdk';
import type {
  ReconciliationContext,
  ReconciliationProposer,
  RawReconciliationProposal,
  ReconciliationMatchProposal,
} from './types';
import { DEFAULT_MODEL } from './client';

const PROMPT_VERSION = 'reconciliation-v1';

export const RECONCILIATION_SCHEMA_VERSION = 1;
export const RECONCILIATION_AGENT = 'reconciliation-agent';

const clamp01 = (n: number): number => (!Number.isFinite(n) ? 0 : n < 0 ? 0 : n > 1 ? 1 : n);

const SYSTEM_PROMPT = [
  'You are a fund-accounting assistant for a private-markets fund administrator.',
  'You PROPOSE a three-way reconciliation match linking a bank transaction to a ledger',
  'entry and/or a supporting document (bank ↔ ledger ↔ document). An expert accountant',
  'reviews and approves every match before anything posts — you never post, reconcile, or',
  'clear anything yourself, and you must not claim to. Follow these rules strictly:',
  '- You may ONLY reference candidate ids that were provided in the context; never invent ids.',
  '- If no ledger entry or document credibly matches, omit that id and set status accordingly',
  '  (matched = bank+ledger(+document) agree; partial = a plausible but incomplete match;',
  '  unmatched = no credible candidate).',
  '- For every value that supports the match, cite the exact quote from the source.',
  '- If the evidence is ambiguous, still produce your best match but lower your confidence.',
].join(' ');

// Strict tool schema — guarantees the model returns exactly this shape. Note:
// strict mode disallows minLength/maxLength/numeric constraints, so we use only
// type/enum/required/additionalProperties. ledgerEntryId/documentId are OPTIONAL.
const TOOL = {
  name: 'record_reconciliation_match',
  description:
    'Record the proposed (un-posted) reconciliation match, its evidence, and a confidence.',
  strict: true as const,
  input_schema: {
    type: 'object' as const,
    additionalProperties: false,
    required: ['payload', 'evidence', 'confidence'],
    properties: {
      payload: {
        type: 'object' as const,
        additionalProperties: false,
        required: ['bankTransactionId', 'status', 'rationale'],
        properties: {
          bankTransactionId: { type: 'string' as const },
          ledgerEntryId: { type: 'string' as const },
          documentId: { type: 'string' as const },
          status: { type: 'string' as const, enum: ['matched', 'partial', 'unmatched'] },
          rationale: { type: 'string' as const },
        },
      },
      evidence: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          additionalProperties: false,
          required: ['field', 'sourceRef', 'quote'],
          properties: {
            field: { type: 'string' as const },
            sourceRef: { type: 'string' as const },
            quote: { type: 'string' as const },
          },
        },
      },
      confidence: { type: 'number' as const, description: '0..1' },
    },
  },
};

function renderUserMessage(ctx: ReconciliationContext): string {
  const bt = ctx.bankTransaction;
  const ledgers = ctx.candidateLedgerEntries.length
    ? ctx.candidateLedgerEntries
        .map((l) => `  ${l.id}  ${l.date}  ${l.amountMinor} ${l.currency}  ${l.memo}`)
        .join('\n')
    : '  (none)';
  const docs = ctx.candidateDocuments.length
    ? ctx.candidateDocuments
        .map(
          (d) => `  ${d.id}  ${d.kind}  ${d.date}  ${d.amountMinor} ${d.currency}  ${d.reference}`,
        )
        .join('\n')
    : '  (none)';
  return [
    'Bank transaction to reconcile:',
    `  id: ${bt.id}`,
    `  date: ${bt.date}`,
    `  amountMinor: ${bt.amountMinor} ${bt.currency}`,
    `  description: ${bt.description}`,
    '',
    'Candidate ledger entries (reference these ids only):',
    ledgers,
    '',
    'Candidate documents (reference these ids only):',
    docs,
    '',
    'Propose the reconciliation match via the record_reconciliation_match tool.',
  ].join('\n');
}

/**
 * Anthropic-backed reconciliation proposer. Forces a single strict tool call so
 * the model returns exactly the match shape. This is the ONLY place that talks
 * to the model; everything downstream is deterministic and testable.
 */
export function anthropicReconciliationProposer(
  client: Anthropic,
  model: string = DEFAULT_MODEL,
): ReconciliationProposer {
  return {
    async propose(ctx: ReconciliationContext): Promise<RawReconciliationProposal> {
      const response = await client.messages.create({
        model,
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        tools: [TOOL],
        tool_choice: { type: 'tool', name: TOOL.name, disable_parallel_tool_use: true },
        messages: [{ role: 'user', content: renderUserMessage(ctx) }],
      });

      const toolUses = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === TOOL.name,
      );
      if (toolUses.length !== 1) {
        throw new Error(`expected exactly one ${TOOL.name} tool call, got ${toolUses.length}`);
      }
      // strict:true guarantees the payload/evidence/confidence shape; we stamp the
      // actual model ourselves so audit metadata cannot drift from reality.
      const raw = toolUses[0]!.input as unknown as Omit<RawReconciliationProposal, 'model'>;
      return { ...raw, model: response.model };
    },
  };
}

/**
 * Run the reconciliation agent: hand the context to a proposer, then stamp the
 * trust metadata (prompt version, agent name, schema version) ourselves. The
 * model is taken from what the proposer ACTUALLY used, so audit metadata cannot
 * drift. Returns a propose-only proposal — it does NOT post. Posting happens
 * only via review-queue approval.
 */
export async function proposeReconciliationMatch(
  ctx: ReconciliationContext,
  proposer: ReconciliationProposer,
): Promise<ReconciliationMatchProposal> {
  const raw = await proposer.propose(ctx);
  const p = raw.payload;
  // Don't rely on `strict` alone — validate the shape at runtime.
  if (
    p === null ||
    typeof p !== 'object' ||
    typeof p.bankTransactionId !== 'string' ||
    (p.status !== 'matched' && p.status !== 'partial' && p.status !== 'unmatched') ||
    typeof p.rationale !== 'string'
  ) {
    throw new Error('reconciliation proposer returned a malformed payload');
  }
  return {
    kind: 'reconciliation_match',
    schemaVersion: RECONCILIATION_SCHEMA_VERSION,
    payload: raw.payload,
    evidence: raw.evidence,
    confidence: clamp01(raw.confidence),
    model: raw.model,
    promptVersion: PROMPT_VERSION,
    createdByAgent: RECONCILIATION_AGENT,
  };
}
