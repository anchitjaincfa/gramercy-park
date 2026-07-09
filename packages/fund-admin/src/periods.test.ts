import { describe, it, expect } from 'vitest';
import type { AccountingPeriod, PeriodStatus } from './types';
import {
  periodKeyOf,
  isPostable,
  findPeriod,
  assertPostable,
  closePeriod,
  reopenPeriod,
} from './periods';

const FIRM = 'firm-1';
const ENTITY = 'fund-1';

function period(entityId: string, key: string, status: PeriodStatus): AccountingPeriod {
  return { id: `${entityId}:${key}`, firmId: FIRM, entityId, period: key, status };
}

describe('periodKeyOf', () => {
  it('extracts YYYY-MM from a plain ISO date', () => {
    expect(periodKeyOf('2026-03-15')).toBe('2026-03');
  });

  it('extracts YYYY-MM from an ISO date with a time suffix', () => {
    expect(periodKeyOf('2026-11-01T12:34:56Z')).toBe('2026-11');
    expect(periodKeyOf('2026-11-01T00:00:00')).toBe('2026-11');
  });

  it('accepts a valid leap day', () => {
    expect(periodKeyOf('2024-02-29')).toBe('2024-02');
  });

  it('throws on a malformed date string', () => {
    expect(() => periodKeyOf('2026-3-5')).toThrow();
    expect(() => periodKeyOf('not-a-date')).toThrow();
    expect(() => periodKeyOf('2026/03/05')).toThrow();
    expect(() => periodKeyOf('')).toThrow();
  });

  it('throws on a malformed TIME suffix, not just the date (Codex Gate 2c.1)', () => {
    // A naive split-on-'T' would accept these; the full-string validation rejects them.
    expect(() => periodKeyOf('2026-03-15Tnonsense')).toThrow();
    expect(() => periodKeyOf('2026-03-15Tgarbage-after')).toThrow();
    expect(() => periodKeyOf('2026-03-15 extra')).toThrow();
  });

  it('throws on a non-calendar month', () => {
    expect(() => periodKeyOf('2026-13-01')).toThrow();
    expect(() => periodKeyOf('2026-00-01')).toThrow();
  });

  it('throws on a non-calendar day', () => {
    expect(() => periodKeyOf('2026-01-32')).toThrow();
    expect(() => periodKeyOf('2026-02-30')).toThrow();
    expect(() => periodKeyOf('2026-04-31')).toThrow();
    expect(() => periodKeyOf('2025-02-29')).toThrow();
  });
});

describe('isPostable', () => {
  it('is true for an open period', () => {
    expect(isPostable(period(ENTITY, '2026-03', 'open'))).toBe(true);
  });

  it('is true for a reopened period', () => {
    expect(isPostable(period(ENTITY, '2026-03', 'reopened'))).toBe(true);
  });

  it('is false for a closed period', () => {
    expect(isPostable(period(ENTITY, '2026-03', 'closed'))).toBe(false);
  });
});

describe('findPeriod', () => {
  const periods: AccountingPeriod[] = [
    period(ENTITY, '2026-01', 'closed'),
    period(ENTITY, '2026-02', 'open'),
    period('fund-2', '2026-02', 'closed'),
  ];

  it('finds the record matching entity and month', () => {
    expect(findPeriod(periods, ENTITY, '2026-02-14')?.id).toBe('fund-1:2026-02');
  });

  it('scopes the match by entity', () => {
    expect(findPeriod(periods, 'fund-2', '2026-02-14')?.id).toBe('fund-2:2026-02');
  });

  it('returns undefined when no month matches', () => {
    expect(findPeriod(periods, ENTITY, '2026-06-01')).toBeUndefined();
  });

  it('returns undefined when no entity matches', () => {
    expect(findPeriod(periods, 'fund-3', '2026-02-14')).toBeUndefined();
  });

  it('throws on an invalid date', () => {
    expect(() => findPeriod(periods, ENTITY, '2026-13-01')).toThrow();
  });
});

describe('assertPostable', () => {
  const periods: AccountingPeriod[] = [
    period(ENTITY, '2026-01', 'closed'),
    period(ENTITY, '2026-02', 'open'),
    period(ENTITY, '2026-03', 'reopened'),
  ];

  it('throws for a closed period, naming entity and period', () => {
    expect(() => assertPostable(periods, ENTITY, '2026-01-15')).toThrow(/2026-01/);
    expect(() => assertPostable(periods, ENTITY, '2026-01-15')).toThrow(new RegExp(ENTITY));
  });

  it('allows an open period', () => {
    expect(() => assertPostable(periods, ENTITY, '2026-02-15')).not.toThrow();
  });

  it('allows a reopened period', () => {
    expect(() => assertPostable(periods, ENTITY, '2026-03-15')).not.toThrow();
  });

  it('allows posting when no matching period record exists', () => {
    expect(() => assertPostable(periods, ENTITY, '2026-09-15')).not.toThrow();
    expect(() => assertPostable(periods, 'fund-2', '2026-01-15')).not.toThrow();
  });

  it('throws on an invalid date', () => {
    expect(() => assertPostable(periods, ENTITY, '2026-02-31')).toThrow();
  });
});

describe('closePeriod', () => {
  it('returns a new object with status closed', () => {
    const open = period(ENTITY, '2026-04', 'open');
    const closed = closePeriod(open);
    expect(closed.status).toBe('closed');
    expect(closed).not.toBe(open);
    expect({ ...closed, status: open.status }).toEqual(open);
  });

  it('does not mutate the input', () => {
    const open = period(ENTITY, '2026-04', 'open');
    closePeriod(open);
    expect(open.status).toBe('open');
  });

  it('closes a reopened period', () => {
    expect(closePeriod(period(ENTITY, '2026-04', 'reopened')).status).toBe('closed');
  });
});

describe('reopenPeriod', () => {
  it('returns a new object with status reopened', () => {
    const closed = period(ENTITY, '2026-05', 'closed');
    const reopened = reopenPeriod(closed);
    expect(reopened.status).toBe('reopened');
    expect(reopened).not.toBe(closed);
    expect({ ...reopened, status: closed.status }).toEqual(closed);
  });

  it('does not mutate the input', () => {
    const closed = period(ENTITY, '2026-05', 'closed');
    reopenPeriod(closed);
    expect(closed.status).toBe('closed');
  });
});
