/**
 * Canonical fund-admin domain types (Phase 2a).
 *
 * These names are depended on by sibling modules (allocation, capital-call,
 * checks); keep them stable. Monetary fields are stored as integer minor units
 * (`amountMinor`) alongside an explicit `currency`, mirroring the `Money`
 * convention in `@gramercy/core` — never floats.
 */

export type LpStatus = 'active' | 'transferred' | 'inactive';

export interface Lp {
  id: string;
  firmId: string;
  name: string;
  status: LpStatus;
}

export interface ShareClass {
  id: string;
  firmId: string;
  fundId: string;
  name: string;
  mgmtFeeBps: number;
  carryBps: number;
  hurdleBps?: number;
}

export interface Commitment {
  id: string;
  firmId: string;
  fundId: string;
  lpId: string;
  classId: string;
  amountMinor: number;
  currency: string;
  effectiveDate: string;
  recallableUsedMinor: number;
}

export type CallAllocationKind = 'contribution' | 'recall' | 'fee_offset';

export interface CapitalCallAllocation {
  lpId: string;
  amountMinor: number;
  kind: CallAllocationKind;
}

export interface CapitalCall {
  id: string;
  firmId: string;
  fundId: string;
  number: number;
  callDate: string;
  dueDate: string;
  purpose: string;
  totalMinor: number;
  currency: string;
  allocations: CapitalCallAllocation[];
}
