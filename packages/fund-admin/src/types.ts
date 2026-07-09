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

// ---------------------------------------------------------------------------
// Phase 2b — distributions, fees & capital accounts
// ---------------------------------------------------------------------------

export type DistributionKind = 'return_of_capital' | 'gain' | 'income';

export interface DistributionAllocation {
  lpId: string;
  amountMinor: number;
}

export interface Distribution {
  id: string;
  firmId: string;
  fundId: string;
  number: number;
  date: string;
  kind: DistributionKind;
  /** Whether the returned capital is recallable by the fund. */
  recallable: boolean;
  totalMinor: number;
  currency: string;
  allocations: DistributionAllocation[];
}

export type FeeBasis = 'committed' | 'invested' | 'nav';
export type FeeFrequency = 'quarterly' | 'semiannual' | 'annual';

export interface MgmtFeeSchedule {
  id: string;
  firmId: string;
  fundId: string;
  classId: string;
  rateBps: number;
  basis: FeeBasis;
  frequency: FeeFrequency;
}

/**
 * A single event in an LP's capital-account history. The capital account is
 * rebuilt deterministically by folding these in date order (see
 * docs/ARCHITECTURE.md §4.2). `pnl_allocation` amounts may be negative (losses);
 * all others are non-negative magnitudes whose sign is implied by `kind`.
 */
export type CapitalAccountEventKind =
  'contribution' | 'distribution' | 'mgmt_fee' | 'pnl_allocation';

export interface CapitalAccountEvent {
  lpId: string;
  date: string;
  kind: CapitalAccountEventKind;
  /** Minor units. Non-negative except for `pnl_allocation`, which may be negative. */
  amountMinor: number;
}

export interface CapitalAccountBalance {
  lpId: string;
  contributedMinor: number;
  distributedMinor: number;
  feesMinor: number;
  allocatedPnlMinor: number;
  /** contributed − distributed − fees + allocatedPnl. */
  balanceMinor: number;
}
