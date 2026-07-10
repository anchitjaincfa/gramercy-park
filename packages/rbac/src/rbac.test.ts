import { describe, it, expect } from 'vitest';
import {
  PERMISSIONS,
  can,
  canApproveAmount,
  enforceSegregation,
  isSegregationOk,
  type ApprovalPolicy,
  type Role,
  type Action,
} from './index';

describe('permission matrix', () => {
  it('owner can do everything', () => {
    const allActions: Action[] = [
      'view_ledger',
      'create_journal',
      'post_journal',
      'approve_proposal',
      'issue_capital_call',
      'approve_capital_call',
      'run_reconciliation',
      'manage_users',
      'view_lp_portal',
    ];
    for (const action of allActions) {
      expect(can('owner', action)).toBe(true);
    }
  });

  it('accountant can post_journal but cannot approve_proposal (SoD)', () => {
    expect(can('accountant', 'post_journal')).toBe(true);
    expect(can('accountant', 'create_journal')).toBe(true);
    expect(can('accountant', 'issue_capital_call')).toBe(true);
    expect(can('accountant', 'run_reconciliation')).toBe(true);
    expect(can('accountant', 'approve_proposal')).toBe(false);
    expect(can('accountant', 'approve_capital_call')).toBe(false);
    expect(can('accountant', 'manage_users')).toBe(false);
  });

  it('reviewer can approve_proposal but cannot post_journal (SoD)', () => {
    expect(can('reviewer', 'approve_proposal')).toBe(true);
    expect(can('reviewer', 'approve_capital_call')).toBe(true);
    expect(can('reviewer', 'view_ledger')).toBe(true);
    expect(can('reviewer', 'post_journal')).toBe(false);
    expect(can('reviewer', 'create_journal')).toBe(false);
    expect(can('reviewer', 'issue_capital_call')).toBe(false);
  });

  it('read_only can only view the ledger', () => {
    expect(can('read_only', 'view_ledger')).toBe(true);
    expect(PERMISSIONS.read_only).toEqual(['view_ledger']);
    expect(can('read_only', 'post_journal')).toBe(false);
    expect(can('read_only', 'approve_proposal')).toBe(false);
    expect(can('read_only', 'view_lp_portal')).toBe(false);
  });

  it('lp can only see the LP portal', () => {
    expect(can('lp', 'view_lp_portal')).toBe(true);
    expect(PERMISSIONS.lp).toEqual(['view_lp_portal']);
    expect(can('lp', 'view_ledger')).toBe(false);
    expect(can('lp', 'approve_capital_call')).toBe(false);
  });

  it('preparer and approver permission sets are disjoint (accountant vs reviewer)', () => {
    const accountant = new Set<Action>(PERMISSIONS.accountant);
    const reviewer = new Set<Action>(PERMISSIONS.reviewer);
    const overlap = [...accountant].filter((a) => reviewer.has(a) && a !== 'view_ledger');
    expect(overlap).toEqual([]);
  });
});

describe('canApproveAmount — approval thresholds', () => {
  const policies: readonly ApprovalPolicy[] = [
    { role: 'reviewer', maxAmountMinor: 100_000_000 }, // $1M cap (cents)
    { role: 'owner', maxAmountMinor: null }, // unlimited
    { role: 'accountant', maxAmountMinor: 100_000_000 }, // has a policy but no approve perm
  ];

  it('reviewer with a $1M cap can approve $500k but not $2M', () => {
    expect(canApproveAmount('reviewer', 50_000_000, policies)).toBe(true);
    expect(canApproveAmount('reviewer', 200_000_000, policies)).toBe(false);
  });

  it('exactly-at-the-cap is allowed (inclusive)', () => {
    expect(canApproveAmount('reviewer', 100_000_000, policies)).toBe(true);
  });

  it('null cap means unlimited', () => {
    expect(canApproveAmount('owner', 999_999_999, policies)).toBe(true);
    expect(canApproveAmount('owner', 0, policies)).toBe(true);
  });

  it('a role without approve permission is always false, even with a policy', () => {
    expect(canApproveAmount('accountant', 1, policies)).toBe(false);
    expect(canApproveAmount('read_only', 1, policies)).toBe(false);
    expect(canApproveAmount('lp', 1, policies)).toBe(false);
  });

  it('an approver with no matching policy is false', () => {
    expect(canApproveAmount('reviewer', 1, [])).toBe(false);
  });

  it('rejects negative and non-integer amounts (non-negative safe integer guard)', () => {
    expect(() => canApproveAmount('reviewer', -1, policies)).toThrow(RangeError);
    expect(() => canApproveAmount('reviewer', 1.5, policies)).toThrow(RangeError);
    expect(() => canApproveAmount('reviewer', Number.NaN, policies)).toThrow(RangeError);
    expect(() => canApproveAmount('reviewer', Number.MAX_SAFE_INTEGER + 1, policies)).toThrow(
      RangeError,
    );
  });

  it('accepts zero as a valid amount', () => {
    expect(canApproveAmount('reviewer', 0, policies)).toBe(true);
  });
});

describe('segregation of duties', () => {
  it('enforceSegregation throws when preparer === approver', () => {
    expect(() => enforceSegregation('user-1', 'user-1')).toThrow(/Segregation of duties/);
  });

  it('enforceSegregation passes when preparer !== approver', () => {
    expect(() => enforceSegregation('user-1', 'user-2')).not.toThrow();
  });

  it('isSegregationOk mirrors enforceSegregation without throwing', () => {
    expect(isSegregationOk('user-1', 'user-1')).toBe(false);
    expect(isSegregationOk('user-1', 'user-2')).toBe(true);
  });
});

describe('type coverage', () => {
  it('every role has a permission entry', () => {
    const roles: Role[] = ['owner', 'accountant', 'reviewer', 'read_only', 'lp'];
    for (const role of roles) {
      expect(Array.isArray(PERMISSIONS[role])).toBe(true);
    }
  });
});
