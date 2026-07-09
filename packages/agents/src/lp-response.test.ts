import { describe, it, expect } from 'vitest';
import { proposeLpReply, LP_REPLY_SCHEMA_VERSION, LP_RESPONSE_AGENT } from './lp-response';
import { DEFAULT_MODEL } from './client';
import type { LpResponseContext, LpResponseProposer, RawLpReplyProposal } from './types';

const CTX: LpResponseContext = {
  lpId: 'lp_apollo',
  lpName: 'Apollo Family Office',
  inboundMessage: 'Can you confirm my current commitment and how much has been called to date?',
  lpFacts: [
    { label: 'Commitment', value: '$5,000,000' },
    { label: 'Called to date', value: '$3,250,000' },
    { label: 'Unfunded commitment', value: '$1,750,000' },
  ],
};

/** A fixture proposer: records a fixed model output so tests need no live API. */
function fixtureProposer(raw: RawLpReplyProposal): LpResponseProposer {
  return { propose: async () => raw };
}

const REPLY: RawLpReplyProposal = {
  payload: {
    lpId: 'lp_apollo',
    subject: 'Re: Commitment and capital called to date',
    draftReply:
      'Dear Apollo Family Office, your total commitment is $5,000,000, of which $3,250,000 ' +
      'has been called to date, leaving an unfunded commitment of $1,750,000.',
    suggestedActions: [
      'Attach the latest capital account statement',
      'Confirm the next expected capital call date',
    ],
  },
  evidence: [
    { field: 'payload.draftReply', sourceRef: 'lpFact:Commitment', quote: '$5,000,000' },
    { field: 'payload.draftReply', sourceRef: 'lpFact:Called to date', quote: '$3,250,000' },
  ],
  confidence: 0.88,
  model: 'claude-opus-4-8',
};

describe('proposeLpReply', () => {
  it('stamps trust metadata and is propose-only', async () => {
    const p = await proposeLpReply(CTX, fixtureProposer(REPLY));
    expect(p.kind).toBe('lp_reply');
    expect(p.schemaVersion).toBe(LP_REPLY_SCHEMA_VERSION);
    expect(p.model).toBe(DEFAULT_MODEL);
    expect(p.promptVersion).toBe('lp-reply-v1');
    expect(p.createdByAgent).toBe(LP_RESPONSE_AGENT);
    expect(p.confidence).toBeCloseTo(0.88);
    expect(p.evidence.length).toBe(2);
  });

  it('preserves the draftReply and suggestedActions verbatim', async () => {
    const p = await proposeLpReply(CTX, fixtureProposer(REPLY));
    expect(p.payload.draftReply).toBe(REPLY.payload.draftReply);
    expect(p.payload.subject).toBe(REPLY.payload.subject);
    expect(p.payload.suggestedActions).toEqual([
      'Attach the latest capital account statement',
      'Confirm the next expected capital call date',
    ]);
  });

  it('clamps an out-of-range confidence to [0,1]', async () => {
    const high = await proposeLpReply(CTX, fixtureProposer({ ...REPLY, confidence: 5 }));
    expect(high.confidence).toBe(1);
    const low = await proposeLpReply(CTX, fixtureProposer({ ...REPLY, confidence: -2 }));
    expect(low.confidence).toBe(0);
    const nan = await proposeLpReply(CTX, fixtureProposer({ ...REPLY, confidence: NaN }));
    expect(nan.confidence).toBe(0);
  });

  it('grounding contract: the reply targets the SAME LP as the context (tenant isolation)', async () => {
    const p = await proposeLpReply(CTX, fixtureProposer(REPLY));
    // The proposal is for the LP we asked about — not some other tenant's LP.
    expect(p.payload.lpId).toBe(CTX.lpId);
  });
});

describe('proposeLpReply — tenant isolation (Codex Gate 4.2)', () => {
  it('throws if the model returns a reply for a different LP', async () => {
    const crossLp: RawLpReplyProposal = {
      ...REPLY,
      payload: { ...REPLY.payload, lpId: 'lp_someone_else' },
    };
    await expect(proposeLpReply(CTX, fixtureProposer(crossLp))).rejects.toThrow(/tenant mismatch/);
  });
});
