import { describe, it, expect } from 'vitest';
import { getTableName } from 'drizzle-orm';
import { schema } from './schema';

describe('schema', () => {
  it('defines all Phase 1 tables', () => {
    const names = Object.values(schema).map((t) => getTableName(t));
    expect(new Set(names)).toEqual(
      new Set([
        'firms',
        'memberships',
        'entities',
        'accounts',
        'journal_batches',
        'journals',
        'journal_lines',
        'audit_events',
      ]),
    );
  });
});
