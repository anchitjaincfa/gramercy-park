/**
 * KPI collection (Phase 5, see docs/ARCHITECTURE.md §Portfolio).
 *
 * Portfolio companies report the same KPI (revenue, headcount, ARR, …) through
 * multiple channels — a board deck, an LP form, a founder email — and those
 * sources routinely disagree or arrive out of order. This module is the
 * deterministic backbone under the AI KPI-reconciliation agent: it COLLECTS raw
 * `KpiRecord` observations into a per-(company, period, metric) view, surfacing
 * the latest value (by `asOf`) and whether the sources disagree.
 *
 * Every function is pure and deterministic — no I/O, no randomness, no clock.
 * Dates are parsed with a strict `YYYY-MM-DD` parser (mirroring
 * fund-admin/checks.ts's `toEpochDay`); an unparseable `asOf` is a hard error,
 * never a silently-dropped observation.
 */

import type { CollectedKpi, KpiRecord } from './types';

/**
 * Parse a strict `YYYY-MM-DD` (optionally with a `T…` time suffix) into a whole
 * UTC epoch-day integer. Returns `null` for anything that is not a real
 * calendar date (rejects e.g. month 13 or day 32). Mirrors the strict parser in
 * fund-admin/src/checks.ts so KPI as-of dates are validated the same way.
 */
function toEpochDay(iso: string): number | null {
  // Validate the WHOLE string (a bare date, or a date + well-formed time suffix)
  // so trailing garbage like "2026-01-01Tnonsense" is rejected, not silently
  // truncated to a valid day.
  const m =
    /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?$/.exec(
      iso,
    );
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const utc = Date.UTC(year, month - 1, day);
  if (Number.isNaN(utc)) return null;
  const d = new Date(utc);
  // Reject values that JS normalised (e.g. 2026-02-30 -> March).
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null;
  }
  return Math.floor(utc / 86_400_000);
}

/** Stable string comparison (ascending) for deterministic ordering. */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Collision-proof composite group key (JSON-encoded tuple; printable). */
function groupKey(companyId: string, period: string, metric: string): string {
  return JSON.stringify([companyId, period, metric]);
}

interface Observation {
  readonly source: string;
  readonly value: string;
  readonly asOf: string;
  /** Parsed epoch-day of `asOf`, computed once during collection. */
  readonly epochDay: number;
}

/**
 * Collect raw KPI observations into a per-(companyId, period, metric) view.
 *
 * For each group: `bySource` is the observations sorted by `source` ascending;
 * `latestValue` is the value of the observation with the greatest `asOf` (ties
 * broken by lowest `source`); `hasDisagreement` is true when the group holds
 * more than one distinct `value` string. Groups are returned sorted by
 * companyId, then period, then metric.
 *
 * Throws if any record's `asOf` is not a strict `YYYY-MM-DD` calendar date.
 */
export function collectKpis(records: readonly KpiRecord[]): CollectedKpi[] {
  const groups = new Map<
    string,
    { companyId: string; period: string; metric: string; observations: Observation[] }
  >();

  for (const r of records) {
    const epochDay = toEpochDay(r.asOf);
    if (epochDay === null) {
      throw new Error(
        `KpiRecord has unparseable asOf "${r.asOf}" ` +
          `(company=${r.companyId}, period=${r.period}, metric=${r.metric}, source=${r.source})`,
      );
    }
    const key = groupKey(r.companyId, r.period, r.metric);
    let group = groups.get(key);
    if (group === undefined) {
      group = { companyId: r.companyId, period: r.period, metric: r.metric, observations: [] };
      groups.set(key, group);
    }
    group.observations.push({ source: r.source, value: r.value, asOf: r.asOf, epochDay });
  }

  const collected: CollectedKpi[] = [];
  for (const group of groups.values()) {
    // bySource: observations sorted by source ascending (source ties -> stable
    // by asOf then value, so the order is fully determined).
    const bySource = [...group.observations].sort(
      (a, b) => cmp(a.source, b.source) || a.epochDay - b.epochDay || cmp(a.value, b.value),
    );

    // latestValue: greatest asOf, ties broken by lowest source, then by lowest
    // value — a COMPLETE tie-break so duplicate (source, asOf) records with
    // differing values are still resolved deterministically (order-independent).
    let latest = group.observations[0]!;
    for (const obs of group.observations) {
      if (
        obs.epochDay > latest.epochDay ||
        (obs.epochDay === latest.epochDay &&
          (cmp(obs.source, latest.source) < 0 ||
            (obs.source === latest.source && cmp(obs.value, latest.value) < 0)))
      ) {
        latest = obs;
      }
    }

    const hasDisagreement = new Set(group.observations.map((o) => o.value)).size > 1;

    collected.push({
      companyId: group.companyId,
      period: group.period,
      metric: group.metric,
      bySource: bySource.map((o) => ({ source: o.source, value: o.value, asOf: o.asOf })),
      latestValue: latest.value,
      hasDisagreement,
    });
  }

  collected.sort(
    (a, b) => cmp(a.companyId, b.companyId) || cmp(a.period, b.period) || cmp(a.metric, b.metric),
  );
  return collected;
}

/**
 * The single collected KPI for `(companyId, period, metric)`, or `undefined`
 * when no record matches that key.
 */
export function latestKpi(
  records: readonly KpiRecord[],
  companyId: string,
  period: string,
  metric: string,
): CollectedKpi | undefined {
  return collectKpis(records).find(
    (k) => k.companyId === companyId && k.period === period && k.metric === metric,
  );
}

/** Only the collected KPIs whose sources disagree. */
export function disagreements(records: readonly KpiRecord[]): CollectedKpi[] {
  return collectKpis(records).filter((k) => k.hasDisagreement);
}
