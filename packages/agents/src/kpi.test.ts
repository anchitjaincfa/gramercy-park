import { describe, it, expect } from 'vitest';
import { proposeKpi } from './kpi';
import { DEFAULT_MODEL } from './client';
import type { KpiContext, KpiProposer, RawKpiProposal } from './types';

const CTX: KpiContext = {
  companyId: 'co_acme',
  period: 'Q4-2025',
  metric: 'ARR',
  observations: [
    { source: 'board-deck', value: '$12.0M', quote: 'ARR reached $12.0M at year end' },
    { source: 'kpi-form', value: '$11.8M', quote: 'Annual recurring revenue: $11.8M' },
    { source: 'ceo-email', value: '$12.0M', quote: 'we closed the year at roughly $12M ARR' },
  ],
};

/** A fixture proposer: records a fixed model output so tests need no live API. */
function fixtureProposer(raw: RawKpiProposal): KpiProposer {
  return { propose: async () => raw };
}

// Two sources DISAGREE ($12.0M vs $11.8M) — a reconciliation with flagged conflict.
const RECONCILED: RawKpiProposal = {
  payload: {
    companyId: 'co_acme',
    period: 'Q4-2025',
    metric: 'ARR',
    reconciledValue: '$12.0M',
    sources: [
      { source: 'board-deck', value: '$12.0M' },
      { source: 'kpi-form', value: '$11.8M' },
      { source: 'ceo-email', value: '$12.0M' },
    ],
    rationale:
      'Two of three sources report $12.0M; the KPI form reports $11.8M. Taking the majority ' +
      'board-deck/CEO figure of $12.0M but flagging the $0.2M discrepancy with the form for review.',
  },
  evidence: [
    {
      field: 'payload.reconciledValue',
      sourceRef: 'board-deck',
      quote: 'ARR reached $12.0M at year end',
    },
    {
      field: 'payload.sources.1.value',
      sourceRef: 'kpi-form',
      quote: 'Annual recurring revenue: $11.8M',
    },
  ],
  confidence: 0.66,
  model: 'claude-opus-4-8',
};

describe('proposeKpi', () => {
  it('stamps trust metadata and is propose-only', async () => {
    const p = await proposeKpi(CTX, fixtureProposer(RECONCILED));
    expect(p.kind).toBe('kpi');
    expect(p.schemaVersion).toBe(1);
    expect(p.model).toBe(DEFAULT_MODEL);
    expect(p.promptVersion).toBe('kpi-v1');
    expect(p.createdByAgent).toBe('kpi-agent');
    expect(p.confidence).toBeCloseTo(0.66);
    expect(p.evidence.length).toBe(2);
  });

  it('preserves per-source observations and the single reconciled value', async () => {
    const p = await proposeKpi(CTX, fixtureProposer(RECONCILED));
    expect(p.payload.reconciledValue).toBe('$12.0M');
    expect(p.payload.sources.length).toBe(3);
    expect(p.payload.sources.map((s) => s.value)).toEqual(['$12.0M', '$11.8M', '$12.0M']);
    // Sources genuinely disagree, so the rationale must flag it.
    const distinct = new Set(p.payload.sources.map((s) => s.value));
    expect(distinct.size).toBeGreaterThan(1);
    expect(p.payload.rationale).toMatch(/discrepancy|flag/i);
  });

  it('clamps an out-of-range confidence to [0,1]', async () => {
    const hi = await proposeKpi(CTX, fixtureProposer({ ...RECONCILED, confidence: 5 }));
    expect(hi.confidence).toBe(1);
    const lo = await proposeKpi(CTX, fixtureProposer({ ...RECONCILED, confidence: -3 }));
    expect(lo.confidence).toBe(0);
    const nan = await proposeKpi(CTX, fixtureProposer({ ...RECONCILED, confidence: NaN }));
    expect(nan.confidence).toBe(0);
  });
});
