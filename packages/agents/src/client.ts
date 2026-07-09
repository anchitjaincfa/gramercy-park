import Anthropic from '@anthropic-ai/sdk';
import type { JournalEntryContext, JournalEntryProposer, RawJournalEntryProposal } from './types';

/** Default model — Opus 4.8 (see the claude-api guidance). Never downgrade silently. */
export const DEFAULT_MODEL = 'claude-opus-4-8';
export const PROMPT_VERSION = 'journal-entry-v1';

/** Construct an Anthropic client. Resolves ANTHROPIC_API_KEY from the env by default. */
export function createAnthropic(apiKey?: string): Anthropic {
  return apiKey ? new Anthropic({ apiKey }) : new Anthropic();
}

const SYSTEM_PROMPT = [
  'You are a fund-accounting assistant for a private-markets fund administrator.',
  'You PREPARE a double-entry journal entry from a bill, invoice, or email. An expert',
  'accountant reviews and approves every entry before it posts — you never post, and you',
  'must not claim to. Follow these rules strictly:',
  '- Use ONLY account codes from the provided chart of accounts.',
  '- Total debits must equal total credits (balanced entry).',
  '- Amounts are integer minor units (cents); never use decimals or floats.',
  '- For every proposed value, cite the exact quote from the source that justifies it.',
  '- If the document is ambiguous, still produce your best entry but lower your confidence.',
].join(' ');

// Strict tool schema — guarantees the model returns exactly this shape.
const PROPOSAL_TOOL = {
  name: 'record_journal_entry_proposal',
  description: 'Record the proposed (un-posted) journal entry, its evidence, and a confidence.',
  strict: true as const,
  input_schema: {
    type: 'object' as const,
    additionalProperties: false,
    required: ['payload', 'evidence', 'confidence'],
    properties: {
      payload: {
        type: 'object' as const,
        additionalProperties: false,
        required: ['entityId', 'date', 'memo', 'currency', 'lines'],
        properties: {
          entityId: { type: 'string' as const },
          date: { type: 'string' as const, description: 'ISO YYYY-MM-DD' },
          memo: { type: 'string' as const },
          currency: { type: 'string' as const },
          lines: {
            type: 'array' as const,
            items: {
              type: 'object' as const,
              additionalProperties: false,
              required: ['accountCode', 'side', 'amountMinor', 'rationale'],
              properties: {
                accountCode: { type: 'string' as const },
                side: { type: 'string' as const, enum: ['debit', 'credit'] },
                amountMinor: { type: 'integer' as const },
                rationale: { type: 'string' as const },
              },
            },
          },
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

function renderUserMessage(ctx: JournalEntryContext): string {
  const coa = ctx.chartOfAccounts.map((a) => `  ${a.code}  ${a.name}  (${a.type})`).join('\n');
  return [
    `Entity: ${ctx.entityId}`,
    `Reporting currency: ${ctx.currency}`,
    `Source reference: ${ctx.sourceRef}`,
    '',
    'Chart of accounts (use these codes only):',
    coa,
    '',
    'Document:',
    '"""',
    ctx.documentText,
    '"""',
    '',
    'Prepare the balanced journal entry via the record_journal_entry_proposal tool.',
  ].join('\n');
}

/**
 * Anthropic-backed journal-entry proposer. Forces a single strict tool call so
 * the model returns exactly the proposal shape. This is the ONLY place that
 * talks to the model; everything downstream is deterministic and testable.
 */
export function anthropicJournalEntryProposer(
  client: Anthropic,
  model: string = DEFAULT_MODEL,
): JournalEntryProposer {
  return {
    async propose(ctx: JournalEntryContext): Promise<RawJournalEntryProposal> {
      const response = await client.messages.create({
        model,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools: [PROPOSAL_TOOL],
        tool_choice: { type: 'tool', name: PROPOSAL_TOOL.name, disable_parallel_tool_use: true },
        messages: [{ role: 'user', content: renderUserMessage(ctx) }],
      });

      const toolUses = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === PROPOSAL_TOOL.name,
      );
      if (toolUses.length !== 1) {
        throw new Error(
          `expected exactly one ${PROPOSAL_TOOL.name} tool call, got ${toolUses.length}`,
        );
      }
      // strict:true guarantees the payload/evidence/confidence shape; we stamp the
      // actual model ourselves so audit metadata cannot drift from reality.
      const raw = toolUses[0]!.input as unknown as Omit<RawJournalEntryProposal, 'model'>;
      return { ...raw, model };
    },
  };
}
