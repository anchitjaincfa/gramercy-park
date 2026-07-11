import Anthropic from '@anthropic-ai/sdk';
import type {
  LpResponseContext,
  LpResponseProposer,
  RawLpReplyProposal,
  LpReplyProposal,
} from './types';
import { createAnthropic, DEFAULT_MODEL } from './client';

const PROMPT_VERSION = 'lp-reply-v1';

export { createAnthropic };

export const LP_REPLY_SCHEMA_VERSION = 1;
export const LP_RESPONSE_AGENT = 'lp-response-agent';

const clamp01 = (n: number): number => (!Number.isFinite(n) ? 0 : n < 0 ? 0 : n > 1 ? 1 : n);

const SYSTEM_PROMPT = [
  'You are an investor-relations assistant for a private-markets fund administrator.',
  'You DRAFT a reply to an inbound message from a single fund limited partner (LP). A human',
  'reviews and approves every reply before it is sent — you never send, and you must not claim',
  'to. Follow these rules strictly:',
  '- You may reference ONLY the facts provided in lpFacts. These facts are scoped to THIS LP.',
  '- NEVER invent numbers, dates, or commitments, and NEVER reference any other LP or fund.',
  '- If the question cannot be answered from the provided facts, say so plainly in the draft',
  '  and lower your confidence rather than guessing.',
  '- For every claim in the draft, cite which lpFact it relies on via the evidence array,',
  '  setting each evidence sourceRef to "lpFact:<label>" using a label shown below.',
].join(' ');

// Strict tool schema — guarantees the model returns exactly this shape.
const REPLY_TOOL = {
  name: 'record_lp_reply',
  description: 'Record the proposed (un-sent) LP reply, its evidence, and a confidence.',
  strict: true as const,
  input_schema: {
    type: 'object' as const,
    additionalProperties: false,
    required: ['payload', 'evidence', 'confidence'],
    properties: {
      payload: {
        type: 'object' as const,
        additionalProperties: false,
        required: ['lpId', 'subject', 'draftReply', 'suggestedActions'],
        properties: {
          lpId: { type: 'string' as const },
          subject: { type: 'string' as const },
          draftReply: { type: 'string' as const },
          suggestedActions: {
            type: 'array' as const,
            items: { type: 'string' as const },
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

function renderUserMessage(ctx: LpResponseContext): string {
  const facts = ctx.lpFacts.map((f) => `  [lpFact:${f.label}] ${f.label}: ${f.value}`).join('\n');
  return [
    `LP: ${ctx.lpName} (lpId: ${ctx.lpId})`,
    '',
    'Inbound message:',
    '"""',
    ctx.inboundMessage,
    '"""',
    '',
    'Facts you may reference (these pertain to THIS LP only):',
    facts,
    '',
    'Draft the reply via the record_lp_reply tool.',
  ].join('\n');
}

/**
 * Anthropic-backed LP-response proposer. Forces a single strict tool call so the
 * model returns exactly the reply shape. This is the ONLY place that talks to the
 * model; everything downstream is deterministic and testable. The draft is
 * grounded STRICTLY in the RLS-scoped lpFacts handed in via the context.
 */
export function anthropicLpResponseProposer(
  client: Anthropic,
  model: string = DEFAULT_MODEL,
): LpResponseProposer {
  return {
    async propose(ctx: LpResponseContext): Promise<RawLpReplyProposal> {
      const response = await client.messages.create({
        model,
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        tools: [REPLY_TOOL],
        tool_choice: { type: 'tool', name: REPLY_TOOL.name, disable_parallel_tool_use: true },
        messages: [{ role: 'user', content: renderUserMessage(ctx) }],
      });

      const toolUses = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === REPLY_TOOL.name,
      );
      if (toolUses.length !== 1) {
        throw new Error(
          `expected exactly one ${REPLY_TOOL.name} tool call, got ${toolUses.length}`,
        );
      }
      // strict:true guarantees the payload/evidence/confidence shape; we stamp the
      // actual model ourselves so audit metadata cannot drift from reality.
      const input = toolUses[0]!.input as unknown as Omit<RawLpReplyProposal, 'model'>;
      return { ...input, model: response.model };
    },
  };
}

/**
 * Run the LP-response agent: hand the context to a proposer, then stamp the trust
 * metadata (prompt version, agent name, schema version) ourselves. The model is
 * taken from what the proposer ACTUALLY used, so audit metadata cannot drift.
 * Returns a propose-only proposal — it does NOT send. Sending happens only via
 * review-queue approval by a human.
 */
export async function proposeLpReply(
  ctx: LpResponseContext,
  proposer: LpResponseProposer,
): Promise<LpReplyProposal> {
  const raw = await proposer.propose(ctx);
  const p = raw.payload;
  // Don't rely on `strict` alone — validate the shape at runtime.
  if (
    p === null ||
    typeof p !== 'object' ||
    typeof p.subject !== 'string' ||
    typeof p.draftReply !== 'string' ||
    !Array.isArray(p.suggestedActions)
  ) {
    throw new Error('lp-response proposer returned a malformed payload');
  }
  // Enforce tenant isolation: a reply must be for the LP we asked about, not a
  // different one the model may have hallucinated. The prompt asks for this; we
  // ENFORCE it here so a bad model output cannot leak across LPs.
  if (p.lpId !== ctx.lpId) {
    throw new Error(
      `lp-response tenant mismatch: reply is for "${p.lpId}" but the request was for "${ctx.lpId}"`,
    );
  }
  // Evidence grounding: every citation must point at a fact we actually supplied.
  // The prompt asks the model to cite "lpFact:<label>"; we ENFORCE it so a
  // fabricated citation (a fact that was never provided) is rejected, not sent.
  if (!Array.isArray(raw.evidence)) {
    throw new Error('lp-response proposer returned a malformed evidence array');
  }
  const allowedRefs = new Set(ctx.lpFacts.map((f) => `lpFact:${f.label}`));
  for (const e of raw.evidence) {
    if (typeof e?.sourceRef !== 'string' || !allowedRefs.has(e.sourceRef)) {
      throw new Error(
        `lp-response evidence cites ungrounded source "${String(
          e?.sourceRef,
        )}"; every sourceRef must reference a provided lpFact ("lpFact:<label>")`,
      );
    }
  }
  return {
    kind: 'lp_reply',
    schemaVersion: LP_REPLY_SCHEMA_VERSION,
    payload: raw.payload,
    evidence: raw.evidence,
    confidence: clamp01(raw.confidence),
    model: raw.model,
    promptVersion: PROMPT_VERSION,
    createdByAgent: LP_RESPONSE_AGENT,
  };
}
