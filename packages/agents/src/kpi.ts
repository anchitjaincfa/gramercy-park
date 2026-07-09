import Anthropic from '@anthropic-ai/sdk';
import type { KpiContext, KpiProposer, RawKpiProposal, KpiProposal } from './types';
import { createAnthropic, DEFAULT_MODEL } from './client';

const PROMPT_VERSION = 'kpi-v1';

export { createAnthropic };

export const KPI_SCHEMA_VERSION = 1;
export const KPI_AGENT = 'kpi-agent';

const clamp01 = (n: number): number => (!Number.isFinite(n) ? 0 : n < 0 ? 0 : n > 1 ? 1 : n);

const SYSTEM_PROMPT = [
  'You are a portfolio-monitoring assistant for a private-markets fund administrator.',
  'A single company KPI is reported across MULTIPLE sources (board deck, portfolio-company',
  'form, management email). You RECONCILE those observations into one proposed value. An',
  'expert reviews every proposal before it is accepted — you never accept or record a KPI',
  'yourself, and you must not claim to. Follow these rules strictly:',
  '- Propose exactly ONE reconciled value for the metric and period.',
  '- Preserve every source observation you were given, verbatim, in the sources list.',
  '- If the sources DISAGREE, explain the disagreement in the rationale and LOWER your',
  '  confidence accordingly.',
  '- For every value you rely on, cite the exact quote from the source that reports it.',
].join(' ');

// Strict tool schema — guarantees the model returns exactly this shape. Under
// strict mode only type/enum/required/additionalProperties are honored (no
// min/max/length constraints).
const RECONCILE_TOOL = {
  name: 'record_kpi_reconciliation',
  description:
    'Record the proposed (un-accepted) reconciled KPI value, its per-source observations, evidence, and a confidence.',
  strict: true as const,
  input_schema: {
    type: 'object' as const,
    additionalProperties: false,
    required: ['payload', 'evidence', 'confidence'],
    properties: {
      payload: {
        type: 'object' as const,
        additionalProperties: false,
        required: ['companyId', 'period', 'metric', 'reconciledValue', 'sources', 'rationale'],
        properties: {
          companyId: { type: 'string' as const },
          period: { type: 'string' as const },
          metric: { type: 'string' as const },
          reconciledValue: { type: 'string' as const },
          sources: {
            type: 'array' as const,
            items: {
              type: 'object' as const,
              additionalProperties: false,
              required: ['source', 'value'],
              properties: {
                source: { type: 'string' as const },
                value: { type: 'string' as const },
              },
            },
          },
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

function renderUserMessage(ctx: KpiContext): string {
  const observations = ctx.observations
    .map((o, i) => `  ${i + 1}. source=${o.source}  value=${o.value}  quote="${o.quote}"`)
    .join('\n');
  return [
    `Company: ${ctx.companyId}`,
    `Period: ${ctx.period}`,
    `Metric: ${ctx.metric}`,
    '',
    'Observations across sources:',
    observations,
    '',
    'Reconcile these into one value via the record_kpi_reconciliation tool.',
    'If they disagree, explain it in the rationale and lower your confidence.',
  ].join('\n');
}

/**
 * Anthropic-backed KPI-reconciliation proposer. Forces a single strict tool call
 * so the model returns exactly the proposal shape. This is the ONLY place that
 * talks to the model; everything downstream is deterministic and testable.
 */
export function anthropicKpiProposer(
  client: Anthropic,
  model: string = DEFAULT_MODEL,
): KpiProposer {
  return {
    async propose(ctx: KpiContext): Promise<RawKpiProposal> {
      const response = await client.messages.create({
        model,
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        tools: [RECONCILE_TOOL],
        tool_choice: { type: 'tool', name: RECONCILE_TOOL.name, disable_parallel_tool_use: true },
        messages: [{ role: 'user', content: renderUserMessage(ctx) }],
      });

      const toolUses = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === RECONCILE_TOOL.name,
      );
      if (toolUses.length !== 1) {
        throw new Error(
          `expected exactly one ${RECONCILE_TOOL.name} tool call, got ${toolUses.length}`,
        );
      }
      // strict:true guarantees the payload/evidence/confidence shape; we stamp the
      // actual model ourselves so audit metadata cannot drift from reality.
      const input = toolUses[0]!.input as unknown as Omit<RawKpiProposal, 'model'>;
      return { ...input, model: response.model };
    },
  };
}

/**
 * Run the KPI-reconciliation agent: hand the context to a proposer, then stamp
 * the trust metadata (prompt version, agent name, schema version) ourselves. The
 * model is taken from what the proposer ACTUALLY used, so audit metadata cannot
 * drift. Returns a propose-only proposal — it does NOT record or accept the KPI.
 */
export async function proposeKpi(ctx: KpiContext, proposer: KpiProposer): Promise<KpiProposal> {
  const raw = await proposer.propose(ctx);
  const p = raw.payload;
  // Don't rely on `strict` alone — validate the shape at runtime.
  if (
    p === null ||
    typeof p !== 'object' ||
    typeof p.companyId !== 'string' ||
    typeof p.reconciledValue !== 'string' ||
    !Array.isArray(p.sources)
  ) {
    throw new Error('kpi proposer returned a malformed payload');
  }
  return {
    kind: 'kpi',
    schemaVersion: KPI_SCHEMA_VERSION,
    payload: raw.payload,
    evidence: raw.evidence,
    confidence: clamp01(raw.confidence),
    model: raw.model,
    promptVersion: PROMPT_VERSION,
    createdByAgent: KPI_AGENT,
  };
}
