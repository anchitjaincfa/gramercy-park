/**
 * Role-based access control (Phase 7).
 *
 * Pure, deterministic authorization primitives: a permission matrix, approval
 * thresholds, and segregation-of-duties enforcement. No I/O, no runtime deps.
 *
 * See docs/ARCHITECTURE.md §7 — the `owner | accountant | reviewer | read_only |
 * lp` role model exists from Phase 1; this module broadens it with approval
 * thresholds and segregation of duties.
 */

/** Firm-level roles. Mirrors the `role_type` pg enum in @gramercy/db. */
export type Role = 'owner' | 'accountant' | 'reviewer' | 'read_only' | 'lp';

/** Discrete, permission-gated operations across the fund-admin domain. */
export type Action =
  | 'view_ledger'
  | 'create_journal'
  | 'post_journal'
  | 'approve_proposal'
  | 'issue_capital_call'
  | 'approve_capital_call'
  | 'run_reconciliation'
  | 'manage_users'
  | 'view_lp_portal';

/**
 * Static permission matrix. The single source of truth for what each role may
 * do. Preparer roles (accountant) and approver roles (reviewer) are kept
 * deliberately disjoint on the post/approve axis to support segregation of
 * duties — an accountant posts journals and issues capital calls; a reviewer
 * approves proposals and capital calls; neither can do the other's step.
 */
export const PERMISSIONS: Record<Role, readonly Action[]> = {
  owner: [
    'view_ledger',
    'create_journal',
    'post_journal',
    'approve_proposal',
    'issue_capital_call',
    'approve_capital_call',
    'run_reconciliation',
    'manage_users',
    'view_lp_portal',
  ],
  accountant: [
    'view_ledger',
    'create_journal',
    'post_journal',
    'issue_capital_call',
    'run_reconciliation',
  ],
  reviewer: ['view_ledger', 'approve_proposal', 'approve_capital_call'],
  read_only: ['view_ledger'],
  lp: ['view_lp_portal'],
} as const;

/** True iff `role` is permitted to perform `action` per the permission matrix. */
export function can(role: Role, action: Action): boolean {
  return PERMISSIONS[role].includes(action);
}

/**
 * Per-role approval limit, expressed in minor currency units (e.g. cents).
 * `maxAmountMinor === null` means unlimited approval authority.
 */
export interface ApprovalPolicy {
  role: Role;
  maxAmountMinor: number | null;
}

/**
 * True iff `role` may approve an amount of `amountMinor` minor units:
 *   1. the role holds an approve permission (approve_proposal or
 *      approve_capital_call), and
 *   2. a matching policy exists whose `maxAmountMinor` is null (unlimited) or
 *      `>= amountMinor`.
 *
 * `amountMinor` must be a non-negative safe integer (minor units are integral).
 */
export function canApproveAmount(
  role: Role,
  amountMinor: number,
  policies: readonly ApprovalPolicy[],
): boolean {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    throw new RangeError(`amountMinor must be a non-negative safe integer, got: ${amountMinor}`);
  }
  const hasApprovePermission = can(role, 'approve_proposal') || can(role, 'approve_capital_call');
  if (!hasApprovePermission) return false;

  const policy = policies.find((p) => p.role === role);
  if (policy === undefined) return false;

  return policy.maxAmountMinor === null || amountMinor <= policy.maxAmountMinor;
}

/**
 * Segregation of duties: the person who prepares a transaction may not also
 * approve it. Throws if `preparerUserId === approverUserId`.
 */
export function enforceSegregation(preparerUserId: string, approverUserId: string): void {
  if (preparerUserId === approverUserId) {
    throw new Error(
      `Segregation of duties violation: user ${preparerUserId} cannot both prepare and approve`,
    );
  }
}

/** Non-throwing counterpart to {@link enforceSegregation}. */
export function isSegregationOk(preparerUserId: string, approverUserId: string): boolean {
  return preparerUserId !== approverUserId;
}
