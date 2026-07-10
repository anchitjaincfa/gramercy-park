/**
 * Synthetic seed data for the LP portal — ONE authenticated limited partner
 * ("Apollo Family Office") in ONE fund.
 *
 * Everything the portal displays about the LP's capital account is a REAL
 * computed number: we assemble the LP's `CapitalAccountEvent` stream
 * (contributions from capital calls, quarterly management fees, P&L allocations,
 * and distributions) and fold it with the actual `@gramercy/fund-admin` engine
 * (`buildCapitalAccounts` / `capitalAccountBalance`). Management-fee line items
 * are produced by `computeMgmtFee`. Money is integer minor units (cents).
 */

import {
  buildCapitalAccounts,
  capitalAccountBalance,
  computeMgmtFee,
  type CapitalAccountEvent,
  type CapitalAccountBalance,
  type MgmtFeeSchedule,
} from '@gramercy/fund-admin';

export const CURRENCY = 'USD';

// ---------------------------------------------------------------------------
// Identities
// ---------------------------------------------------------------------------

export const firm = {
  id: 'firm_gramercy',
  name: 'Gramercy Park Capital',
} as const;

export const fund = {
  id: 'fund_gpcp_ii',
  name: 'Gramercy Park Capital Partners II, L.P.',
  shortName: 'GPCP II',
  strategy: 'Lower Middle-Market Buyout',
  vintage: 2023,
  domicile: 'Delaware, USA',
  currency: CURRENCY,
} as const;

export const lp = {
  id: 'lp_apollo',
  name: 'Apollo Family Office',
  status: 'active' as const,
  investorType: 'Family Office',
  classId: 'class_a',
  className: 'Class A — Limited Partner',
  joinedDate: '2023-02-01',
} as const;

/** Total commitment: $10,000,000.00 → 1,000,000,000 minor units. */
export const commitmentMinor: number = 1_000_000_000;

export const feeSchedule: MgmtFeeSchedule = {
  id: 'fee_gpcp_ii_classA',
  firmId: firm.id,
  fundId: fund.id,
  classId: lp.classId,
  rateBps: 200, // 2.00% per annum
  basis: 'committed',
  frequency: 'quarterly',
};

export const carryBps = 2000; // 20% carried interest
export const hurdleBps = 800; // 8% preferred return

// ---------------------------------------------------------------------------
// Capital-call history (drawdowns against the commitment)
// ---------------------------------------------------------------------------

export type CallStatus = 'funded' | 'due';

export interface CapitalCallNotice {
  id: string;
  number: number;
  callDate: string;
  dueDate: string;
  /** Fraction of commitment called, for display. */
  pctOfCommitment: number;
  amountMinor: number;
  purpose: string;
  status: CallStatus;
}

export const capitalCalls: CapitalCallNotice[] = [
  {
    id: 'call_1',
    number: 1,
    callDate: '2023-03-15',
    dueDate: '2023-03-30',
    pctOfCommitment: 0.25,
    amountMinor: 250_000_000, // $2,500,000
    purpose: 'Initial portfolio investments & organizational expenses',
    status: 'funded',
  },
  {
    id: 'call_2',
    number: 2,
    callDate: '2023-09-15',
    dueDate: '2023-09-29',
    pctOfCommitment: 0.15,
    amountMinor: 150_000_000, // $1,500,000
    purpose: 'Acquisition of Meridian Logistics (platform)',
    status: 'funded',
  },
  {
    id: 'call_3',
    number: 3,
    callDate: '2024-03-15',
    dueDate: '2024-03-29',
    pctOfCommitment: 0.2,
    amountMinor: 200_000_000, // $2,000,000
    purpose: 'Acquisition of Halcyon Diagnostics (platform)',
    status: 'funded',
  },
  {
    id: 'call_4',
    number: 4,
    callDate: '2024-09-16',
    dueDate: '2024-09-30',
    pctOfCommitment: 0.15,
    amountMinor: 150_000_000, // $1,500,000
    purpose: 'Follow-on investments & management fees',
    status: 'funded',
  },
  {
    id: 'call_5',
    number: 5,
    callDate: '2025-03-17',
    dueDate: '2025-03-31',
    pctOfCommitment: 0.1,
    amountMinor: 100_000_000, // $1,000,000
    purpose: 'Add-on acquisition & fee reserve',
    status: 'funded',
  },
];

// ---------------------------------------------------------------------------
// Distribution history
// ---------------------------------------------------------------------------

export type DistKind = 'return_of_capital' | 'gain';

export interface DistributionNotice {
  id: string;
  number: number;
  date: string;
  kind: DistKind;
  recallable: boolean;
  amountMinor: number;
  source: string;
}

export const distributions: DistributionNotice[] = [
  {
    id: 'dist_1',
    number: 1,
    date: '2024-06-30',
    kind: 'return_of_capital',
    recallable: true,
    amountMinor: 50_000_000, // $500,000
    source: 'Recapitalization dividend — Meridian Logistics',
  },
  {
    id: 'dist_2',
    number: 2,
    date: '2024-12-31',
    kind: 'gain',
    recallable: false,
    amountMinor: 75_000_000, // $750,000
    source: 'Partial realization — Meridian Logistics secondary sale',
  },
  {
    id: 'dist_3',
    number: 3,
    date: '2025-06-30',
    kind: 'gain',
    recallable: false,
    amountMinor: 40_000_000, // $400,000
    source: 'Dividend recap — Halcyon Diagnostics',
  },
];

// ---------------------------------------------------------------------------
// P&L allocations (unrealized + realized marks allocated to this LP)
// ---------------------------------------------------------------------------

interface PnlAllocation {
  date: string;
  amountMinor: number; // may be negative (a loss allocation)
  note: string;
}

const pnlAllocations: PnlAllocation[] = [
  { date: '2023-06-30', amountMinor: -10_000_000, note: 'Organizational drag & early markdown' },
  {
    date: '2023-12-31',
    amountMinor: 30_000_000,
    note: 'Unrealized appreciation — Meridian Logistics',
  },
  { date: '2024-06-30', amountMinor: 45_000_000, note: 'Unrealized appreciation — portfolio' },
  { date: '2024-12-31', amountMinor: 60_000_000, note: 'Realized & unrealized gains — portfolio' },
  {
    date: '2025-06-30',
    amountMinor: 40_000_000,
    note: 'Unrealized appreciation — Halcyon Diagnostics',
  },
];

// ---------------------------------------------------------------------------
// Quarterly management-fee line items (computed with the real engine)
// ---------------------------------------------------------------------------

export interface FeeLineItem {
  periodLabel: string;
  date: string; // charged at period end
  /** Index within the fee year (0..3) passed to computeMgmtFee. */
  periodIndex: number;
  basisMinor: number;
  amountMinor: number;
}

/** The quarter-ends we bill across, most-recent last. */
const feeQuarters: { label: string; date: string; periodIndex: number }[] = [
  { label: 'Q1 2023', date: '2023-03-31', periodIndex: 0 },
  { label: 'Q2 2023', date: '2023-06-30', periodIndex: 1 },
  { label: 'Q3 2023', date: '2023-09-30', periodIndex: 2 },
  { label: 'Q4 2023', date: '2023-12-31', periodIndex: 3 },
  { label: 'Q1 2024', date: '2024-03-31', periodIndex: 0 },
  { label: 'Q2 2024', date: '2024-06-30', periodIndex: 1 },
  { label: 'Q3 2024', date: '2024-09-30', periodIndex: 2 },
  { label: 'Q4 2024', date: '2024-12-31', periodIndex: 3 },
  { label: 'Q1 2025', date: '2025-03-31', periodIndex: 0 },
  { label: 'Q2 2025', date: '2025-06-30', periodIndex: 1 },
];

/**
 * Each quarter's management fee, produced by `computeMgmtFee` against the LP's
 * committed capital basis (2.00% p.a., quarterly → $50,000 / quarter).
 */
export const feeLineItems: FeeLineItem[] = feeQuarters.map((q) => ({
  periodLabel: q.label,
  date: q.date,
  periodIndex: q.periodIndex,
  basisMinor: commitmentMinor,
  amountMinor: computeMgmtFee(feeSchedule, commitmentMinor, CURRENCY, q.periodIndex),
}));

// ---------------------------------------------------------------------------
// The LP's full capital-account event stream
// ---------------------------------------------------------------------------

/**
 * The flat event stream for this LP. `buildCapitalAccounts` folds it into the
 * authoritative balance; the statement view (lib/statement.ts) re-reads the same
 * stream period-by-period, so every figure reconciles to the engine.
 */
export const events: CapitalAccountEvent[] = [
  ...capitalCalls.map((c): CapitalAccountEvent => ({
    lpId: lp.id,
    date: c.callDate,
    kind: 'contribution',
    amountMinor: c.amountMinor,
  })),
  ...feeLineItems.map((f): CapitalAccountEvent => ({
    lpId: lp.id,
    date: f.date,
    kind: 'mgmt_fee',
    amountMinor: f.amountMinor,
  })),
  ...pnlAllocations.map((p): CapitalAccountEvent => ({
    lpId: lp.id,
    date: p.date,
    kind: 'pnl_allocation',
    amountMinor: p.amountMinor,
  })),
  ...distributions.map((d): CapitalAccountEvent => ({
    lpId: lp.id,
    date: d.date,
    kind: 'distribution',
    amountMinor: d.amountMinor,
  })),
];

// ---------------------------------------------------------------------------
// Engine-computed balance & derived performance metrics
// ---------------------------------------------------------------------------

/** Authoritative balance for the LP, folded by the real engine. */
export const balance: CapitalAccountBalance = capitalAccountBalance(events, lp.id);

/** Whole-fund reconciliation map (single LP here). */
export const capitalAccounts = buildCapitalAccounts(events);

export interface Metrics {
  commitmentMinor: number;
  contributedMinor: number;
  distributedMinor: number;
  feesMinor: number;
  allocatedPnlMinor: number;
  /** Current capital-account balance == current NAV share. */
  navMinor: number;
  unfundedMinor: number;
  /** Distributions ÷ paid-in. */
  dpi: number;
  /** (Distributions + NAV) ÷ paid-in. */
  tvpi: number;
  /** NAV ÷ paid-in (residual value). */
  rvpi: number;
  /** Fraction of commitment drawn. */
  calledPct: number;
}

export const metrics: Metrics = (() => {
  const contributedMinor = balance.contributedMinor;
  const distributedMinor = balance.distributedMinor;
  const navMinor = balance.balanceMinor;
  const unfundedMinor = commitmentMinor - contributedMinor;
  return {
    commitmentMinor,
    contributedMinor,
    distributedMinor,
    feesMinor: balance.feesMinor,
    allocatedPnlMinor: balance.allocatedPnlMinor,
    navMinor,
    unfundedMinor,
    dpi: contributedMinor === 0 ? 0 : distributedMinor / contributedMinor,
    tvpi: contributedMinor === 0 ? 0 : (distributedMinor + navMinor) / contributedMinor,
    rvpi: contributedMinor === 0 ? 0 : navMinor / contributedMinor,
    calledPct: commitmentMinor === 0 ? 0 : contributedMinor / commitmentMinor,
  };
})();

/** "As of" reporting date — the latest event in the stream. */
export const asOfDate: string = events
  .map((e) => e.date)
  .reduce((latest, d) => (d > latest ? d : latest), events[0]?.date ?? '2025-06-30');
