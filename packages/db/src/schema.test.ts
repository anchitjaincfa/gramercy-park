import { describe, it, expect } from 'vitest';
import { getTableName } from 'drizzle-orm';
import { schema } from './schema';

describe('schema', () => {
  it('defines all Phase 1 + Phase 2a + Phase 2b tables', () => {
    const names = Object.values(schema).map((t) => getTableName(t));
    expect(new Set(names)).toEqual(
      new Set([
        // Phase 1 — ledger core + tenancy/audit
        'firms',
        'memberships',
        'entities',
        'accounts',
        'journal_batches',
        'journals',
        'journal_lines',
        'audit_events',
        // Phase 2a — commitments & capital calls
        'lps',
        'share_classes',
        'commitments',
        'capital_calls',
        'capital_call_allocations',
        // Phase 2b — distributions & management fees
        'distributions',
        'distribution_allocations',
        'mgmt_fee_schedules',
        // Phase 2c — valuation, periods & NAV
        'accounting_periods',
        'valuations',
        'nav_snapshots',
        'nav_snapshot_lp_shares',
      ]),
    );
  });
});
