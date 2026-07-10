import { describe, expect, it } from 'vitest';
import type { KpiRecord } from './types';
import { collectKpis, disagreements, latestKpi } from './kpi-store';

/**
 * Fixture: two companies over two periods.
 *
 * c1 / 2026-Q1 / revenue: three sources.
 *   - board_deck reports "1000" as of 2026-04-10
 *   - email      reports "1000" as of 2026-04-15  (agrees)
 *   - form       reports "1200" as of 2026-05-01  (disagrees, and newest)
 *   => hasDisagreement true, latestValue "1200".
 *
 * c1 / 2026-Q1 / headcount: two sources, both "50" => no disagreement.
 * c2 / 2026-Q2 / revenue: single source "5000" => no disagreement.
 */
function fixture(): KpiRecord[] {
  return [
    {
      companyId: 'c1',
      period: '2026-Q1',
      metric: 'revenue',
      value: '1000',
      source: 'board_deck',
      asOf: '2026-04-10',
    },
    {
      companyId: 'c1',
      period: '2026-Q1',
      metric: 'revenue',
      value: '1000',
      source: 'email',
      asOf: '2026-04-15',
    },
    {
      companyId: 'c1',
      period: '2026-Q1',
      metric: 'revenue',
      value: '1200',
      source: 'form',
      asOf: '2026-05-01',
    },
    {
      companyId: 'c1',
      period: '2026-Q1',
      metric: 'headcount',
      value: '50',
      source: 'board_deck',
      asOf: '2026-04-10',
    },
    {
      companyId: 'c1',
      period: '2026-Q1',
      metric: 'headcount',
      value: '50',
      source: 'form',
      asOf: '2026-04-20',
    },
    {
      companyId: 'c2',
      period: '2026-Q2',
      metric: 'revenue',
      value: '5000',
      source: 'email',
      asOf: '2026-07-01',
    },
  ];
}

describe('collectKpis', () => {
  it('flags disagreement and picks the newest asOf as latestValue', () => {
    const revenue = latestKpi(fixture(), 'c1', '2026-Q1', 'revenue');
    expect(revenue).toBeDefined();
    expect(revenue!.hasDisagreement).toBe(true);
    expect(revenue!.latestValue).toBe('1200');
    // bySource sorted by source ascending.
    expect(revenue!.bySource.map((o) => o.source)).toEqual(['board_deck', 'email', 'form']);
    expect(revenue!.bySource).toHaveLength(3);
  });

  it('reports no disagreement when all sources agree', () => {
    const headcount = latestKpi(fixture(), 'c1', '2026-Q1', 'headcount');
    expect(headcount).toBeDefined();
    expect(headcount!.hasDisagreement).toBe(false);
    expect(headcount!.latestValue).toBe('50');
  });

  it('groups by (company, period, metric) in deterministic order', () => {
    const collected = collectKpis(fixture());
    expect(collected.map((k) => [k.companyId, k.period, k.metric])).toEqual([
      ['c1', '2026-Q1', 'headcount'],
      ['c1', '2026-Q1', 'revenue'],
      ['c2', '2026-Q2', 'revenue'],
    ]);
  });

  it('is order-independent: shuffled input yields identical output', () => {
    const forward = collectKpis(fixture());
    const reversed = collectKpis([...fixture()].reverse());
    expect(reversed).toEqual(forward);
  });

  it('breaks asOf ties by lowest source when choosing latestValue', () => {
    const records: KpiRecord[] = [
      {
        companyId: 'c1',
        period: 'p',
        metric: 'm',
        value: 'zed',
        source: 'zulu',
        asOf: '2026-01-01',
      },
      {
        companyId: 'c1',
        period: 'p',
        metric: 'm',
        value: 'ack',
        source: 'alpha',
        asOf: '2026-01-01',
      },
    ];
    // Same asOf -> lowest source ('alpha') wins.
    expect(latestKpi(records, 'c1', 'p', 'm')!.latestValue).toBe('ack');
  });

  it('accepts a T-suffixed asOf', () => {
    const records: KpiRecord[] = [
      {
        companyId: 'c1',
        period: 'p',
        metric: 'm',
        value: 'v',
        source: 's',
        asOf: '2026-01-01T09:30:00Z',
      },
    ];
    expect(() => collectKpis(records)).not.toThrow();
  });

  it('throws on an unparseable asOf, naming the bad record', () => {
    const bad: KpiRecord[] = [
      {
        companyId: 'cX',
        period: '2026-Q1',
        metric: 'revenue',
        value: '1',
        source: 'form',
        asOf: 'not-a-date',
      },
    ];
    expect(() => collectKpis(bad)).toThrow(/unparseable asOf/);
    expect(() => collectKpis(bad)).toThrow(/cX/);
  });

  it('throws on a normalised non-calendar asOf', () => {
    const bad: KpiRecord[] = [
      { companyId: 'c1', period: 'p', metric: 'm', value: '1', source: 's', asOf: '2026-02-30' },
    ];
    expect(() => collectKpis(bad)).toThrow(/unparseable asOf/);
  });
});

describe('latestKpi', () => {
  it('returns undefined for a missing key', () => {
    expect(latestKpi(fixture(), 'c1', '2026-Q1', 'nope')).toBeUndefined();
    expect(latestKpi(fixture(), 'nobody', '2026-Q1', 'revenue')).toBeUndefined();
  });
});

describe('disagreements', () => {
  it('returns only the collected KPIs where sources disagree', () => {
    const dis = disagreements(fixture());
    expect(dis).toHaveLength(1);
    expect(dis[0]!.companyId).toBe('c1');
    expect(dis[0]!.metric).toBe('revenue');
    expect(dis[0]!.hasDisagreement).toBe(true);
  });

  it('returns an empty array when every metric agrees', () => {
    const agreeing: KpiRecord[] = [
      { companyId: 'c1', period: 'p', metric: 'm', value: 'v', source: 'a', asOf: '2026-01-01' },
      { companyId: 'c1', period: 'p', metric: 'm', value: 'v', source: 'b', asOf: '2026-01-02' },
    ];
    expect(disagreements(agreeing)).toEqual([]);
  });
});
