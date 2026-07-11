/**
 * Synthetic-but-realistic fund data for the GP console.
 *
 * Every number that can be derived is derived by the REAL deterministic engine
 * in the workspace packages — not hand-typed — so the console demonstrates the
 * actual accounting core rather than a mock of it:
 *
 *   - allocateCapitalCall  (@gramercy/fund-admin)  — pro-rata capital call
 *   - runChecks / ALL_CHECKS (@gramercy/fund-admin) — the 36 pre-post checks
 *   - buildCapitalAccounts (@gramercy/fund-admin)   — LP capital accounts
 *   - computeNav / computeNavPerLp (@gramercy/fund-admin) — NAV from posted GL
 *   - rollupPortfolio (@gramercy/portfolio)         — equity-pickup rollup
 *   - accountsById (@gramercy/ledger)               — chart-of-accounts lookup
 *   - money (@gramercy/core)                         — branded minor-unit money
 *
 * All money is integer minor units (cents). This is synthetic data for an
 * educational study — see the footer.
 */

import { money, allocate, applyBps } from '@gramercy/core';
import {
  allocateCapitalCall,
  buildCapitalAccounts,
  computeNav,
  computeNavPerLp,
  runChecks,
  type CapitalCall,
  type CapitalCallContext,
  type CapitalAccountEvent,
  type Commitment,
  type Lp,
  type CheckResult,
  type CapitalAccountBalance,
  type NavSnapshotLpShare,
} from '@gramercy/fund-admin';
import {
  rollupPortfolio,
  type Investment,
  type CompanyValuation,
  type PortfolioCompany,
} from '@gramercy/portfolio';
import { accountsById, type Account, type JournalLineInput } from '@gramercy/ledger';
import type {
  JournalEntryProposal,
  ReconciliationMatchProposal,
  KpiProposal,
  Proposal,
  ProposalKind,
} from '@gramercy/agents';

const CURRENCY = 'USD';
const FIRM_ID = 'firm-hanover';
const FUND_ID = 'fund-gv2';
const AS_OF = '2026-07-09';

// Cents helper for authoring commitment sizes: $25M -> 25 * 1_000_000 * 100.
const usdMillions = (m: number): number => Math.round(m * 1_000_000 * 100);

// ---------------------------------------------------------------------------
// Firm & fund
// ---------------------------------------------------------------------------

export const firm = {
  id: FIRM_ID,
  name: 'Hanover Park Capital',
};

export const fund = {
  id: FUND_ID,
  entityId: FUND_ID,
  name: 'Gramercy Ventures Fund II, L.P.',
  vintage: 2024,
  strategy: 'Early-growth venture',
  currency: CURRENCY,
  asOf: AS_OF,
};

// ---------------------------------------------------------------------------
// LPs & commitments
// ---------------------------------------------------------------------------

export const lps: Lp[] = [
  { id: 'lp-redwood', firmId: FIRM_ID, name: 'Redwood University Endowment', status: 'active' },
  { id: 'lp-atlas', firmId: FIRM_ID, name: 'Atlas Pension Trust', status: 'active' },
  { id: 'lp-meridian', firmId: FIRM_ID, name: 'Meridian Family Office', status: 'active' },
  { id: 'lp-cascade', firmId: FIRM_ID, name: 'Cascade Fund-of-Funds', status: 'active' },
];

export const lpsById: Record<string, Lp> = Object.fromEntries(lps.map((l) => [l.id, l]));

// Commitment sizes ($M): Redwood 25, Atlas 40, Meridian 15, Cascade 20 = $100M.
const commitmentM: Record<string, number> = {
  'lp-redwood': 25,
  'lp-atlas': 40,
  'lp-meridian': 15,
  'lp-cascade': 20,
};

export const commitments: Commitment[] = lps.map((lp) => ({
  id: `commit-${lp.id}`,
  firmId: FIRM_ID,
  fundId: FUND_ID,
  lpId: lp.id,
  classId: 'class-a',
  amountMinor: usdMillions(commitmentM[lp.id] ?? 0),
  currency: CURRENCY,
  effectiveDate: '2024-03-01',
  recallableUsedMinor: 0,
}));

export const totalCommittedMinor = commitments.reduce((s, c) => s + c.amountMinor, 0);

// Prior capital call #1 drew down $10M pro-rata to commitment. Track how much
// each LP has already been called so uncalled headroom is exact.
const PRIOR_CALL_TOTAL = usdMillions(10);
// Allocate the prior call exactly (largest-remainder), not with float rounding —
// money never touches floating point, even in seed data.
const priorCalledParts = allocate(
  money(PRIOR_CALL_TOTAL, 'USD'),
  commitments.map((c) => c.amountMinor),
);
export const priorCalledByLp: Record<string, number> = Object.fromEntries(
  commitments.map((c, i) => [c.lpId, priorCalledParts[i]!.amount]),
);

// ---------------------------------------------------------------------------
// Capital call #2 — built by the real allocator
// ---------------------------------------------------------------------------

const CALL_TOTAL = usdMillions(20);

const uncalledPerLp = commitments.map((c) => ({
  lpId: c.lpId,
  uncalledMinor: c.amountMinor - (priorCalledByLp[c.lpId] ?? 0),
}));

const callAllocations = allocateCapitalCall(CALL_TOTAL, CURRENCY, uncalledPerLp);

export const capitalCall: CapitalCall = {
  id: 'call-2',
  firmId: FIRM_ID,
  fundId: FUND_ID,
  number: 2,
  callDate: '2026-06-15',
  dueDate: '2026-07-05',
  purpose: 'Follow-on investments in Vela Health and Cobalt Systems; Q3 fund expenses.',
  totalMinor: CALL_TOTAL,
  currency: CURRENCY,
  allocations: callAllocations,
};

// Aggregate uncalled after this call, for the dashboard.
export const totalCalledToDateMinor =
  Object.values(priorCalledByLp).reduce((s, v) => s + v, 0) + CALL_TOTAL;
export const uncalledCommitmentMinor = totalCommittedMinor - totalCalledToDateMinor;

// The 36 health checks, run against a fully-built context.
const callContext: CapitalCallContext = {
  call: capitalCall,
  commitments,
  lpsById,
  priorCalledByLp,
  priorCallNumbers: [1],
  noticeDays: 10,
  asOfDate: AS_OF,
};

export const checkResults: CheckResult[] = runChecks(callContext);
export const checkSummary = {
  pass: checkResults.filter((r) => r.status === 'pass').length,
  warn: checkResults.filter((r) => r.status === 'warn').length,
  fail: checkResults.filter((r) => r.status === 'fail').length,
  total: checkResults.length,
};
/** Postable iff nothing failed (warnings are advisory). */
export const callPostable = checkSummary.fail === 0;

// ---------------------------------------------------------------------------
// Capital accounts — rebuilt from an event stream by the real folder
// ---------------------------------------------------------------------------

const capitalEvents: CapitalAccountEvent[] = [];
for (const c of commitments) {
  const prior = priorCalledByLp[c.lpId] ?? 0;
  const thisCall = callAllocations.find((a) => a.lpId === c.lpId)?.amountMinor ?? 0;
  const contributed = prior + thisCall;
  // Contributions (call #1, then call #2).
  capitalEvents.push({
    lpId: c.lpId,
    date: '2025-09-20',
    kind: 'contribution',
    amountMinor: prior,
  });
  capitalEvents.push({
    lpId: c.lpId,
    date: '2026-07-05',
    kind: 'contribution',
    amountMinor: thisCall,
  });
  // Management fee accrued (approx 2% annual on committed, one quarter).
  capitalEvents.push({
    lpId: c.lpId,
    date: '2026-06-30',
    kind: 'mgmt_fee',
    amountMinor: applyBps(money(c.amountMinor, 'USD'), 50).amount,
  });
  // Unrealized P&L allocated pro-rata to contributions (portfolio is up).
  capitalEvents.push({
    lpId: c.lpId,
    date: '2026-06-30',
    kind: 'pnl_allocation',
    amountMinor: applyBps(money(contributed, 'USD'), 1400).amount,
  });
}

export const capitalAccounts: Map<string, CapitalAccountBalance> =
  buildCapitalAccounts(capitalEvents);

// ---------------------------------------------------------------------------
// Chart of accounts + posted GL, feeding the real NAV computation
// ---------------------------------------------------------------------------

export const accounts: Account[] = [
  {
    id: 'acct-cash',
    entityId: FUND_ID,
    code: '1000',
    name: 'Cash & cash equivalents',
    type: 'asset',
  },
  {
    id: 'acct-investments',
    entityId: FUND_ID,
    code: '1200',
    name: 'Investments at fair value',
    type: 'asset',
  },
  {
    id: 'acct-payable',
    entityId: FUND_ID,
    code: '2000',
    name: 'Accrued expenses payable',
    type: 'liability',
  },
  {
    id: 'acct-capital',
    entityId: FUND_ID,
    code: '3000',
    name: "Partners' capital",
    type: 'equity',
  },
  {
    id: 'acct-unrealized',
    entityId: FUND_ID,
    code: '4000',
    name: 'Unrealized gain on investments',
    type: 'income',
  },
  {
    id: 'acct-expense',
    entityId: FUND_ID,
    code: '5000',
    name: 'Fund operating expenses',
    type: 'expense',
  },
];

export const accountsMap = accountsById(accounts);

type PostedLine = JournalLineInput & { readonly entityId: string };
const line = (accountId: string, side: 'debit' | 'credit', minor: number): PostedLine => ({
  accountId,
  side,
  amount: money(minor, CURRENCY),
  entityId: FUND_ID,
});

// A small, balanced set of posted journal lines (each entry debits == credits):
//  1. Capital called (#2): cash in, partners' capital up  ($20M)
//  2. Capital deployed into portfolio at cost              ($16M)
//  3. Mark-to-market uplift on the portfolio               (+$4.2M)
//  4. Accrued fund operating expenses                      ($0.18M)
export const postedLines: PostedLine[] = [
  line('acct-cash', 'debit', usdMillions(20)),
  line('acct-capital', 'credit', usdMillions(20)),

  line('acct-investments', 'debit', usdMillions(16)),
  line('acct-cash', 'credit', usdMillions(16)),

  line('acct-investments', 'debit', 4_200_000_00),
  line('acct-unrealized', 'credit', 4_200_000_00),

  line('acct-expense', 'debit', 180_000_00),
  line('acct-payable', 'credit', 180_000_00),
];

export const navTotalMinor = computeNav(postedLines, accountsMap, CURRENCY);
export const navPerLp: NavSnapshotLpShare[] = computeNavPerLp(
  navTotalMinor,
  capitalAccounts,
  CURRENCY,
);

// NAV = assets − liabilities; expose the components for the NAV breakdown page.
export const navComponents = (() => {
  let assets = 0;
  let liabilities = 0;
  const byAccount: { account: Account; normalMinor: number }[] = [];
  const net = new Map<string, number>();
  for (const l of postedLines) {
    const prev = net.get(l.accountId) ?? 0;
    net.set(l.accountId, l.side === 'debit' ? prev + l.amount.amount : prev - l.amount.amount);
  }
  for (const acct of accounts) {
    const netDb = net.get(acct.id) ?? 0;
    if (acct.type === 'asset') {
      assets += netDb;
      byAccount.push({ account: acct, normalMinor: netDb });
    } else if (acct.type === 'liability') {
      liabilities += -netDb;
      byAccount.push({ account: acct, normalMinor: -netDb });
    }
  }
  return { assets, liabilities, byAccount };
})();

// ---------------------------------------------------------------------------
// Portfolio — rolled up by the real equity-pickup engine
// ---------------------------------------------------------------------------

export const companies: PortfolioCompany[] = [
  {
    id: 'co-northwind',
    firmId: FIRM_ID,
    name: 'Northwind Robotics',
    sector: 'Industrial robotics',
  },
  { id: 'co-vela', firmId: FIRM_ID, name: 'Vela Health', sector: 'Healthcare AI' },
  { id: 'co-lumen', firmId: FIRM_ID, name: 'Lumen Grid', sector: 'Energy / grid software' },
  { id: 'co-cobalt', firmId: FIRM_ID, name: 'Cobalt Systems', sector: 'Infrastructure software' },
];

export const companiesById: Record<string, PortfolioCompany> = Object.fromEntries(
  companies.map((c) => [c.id, c]),
);

export const investments: Investment[] = [
  {
    id: 'inv-northwind',
    firmId: FIRM_ID,
    fundId: FUND_ID,
    companyId: 'co-northwind',
    instrument: 'Series B Preferred',
    costMinor: usdMillions(5),
    ownershipBps: 1300,
    round: 'Series B',
    date: '2024-06-01',
    currency: CURRENCY,
  },
  {
    id: 'inv-vela',
    firmId: FIRM_ID,
    fundId: FUND_ID,
    companyId: 'co-vela',
    instrument: 'Series A Preferred',
    costMinor: usdMillions(4),
    ownershipBps: 900,
    round: 'Series A',
    date: '2024-09-15',
    currency: CURRENCY,
  },
  {
    id: 'inv-lumen',
    firmId: FIRM_ID,
    fundId: FUND_ID,
    companyId: 'co-lumen',
    instrument: 'Series B Preferred',
    costMinor: usdMillions(4),
    ownershipBps: 1000,
    round: 'Series B',
    date: '2025-01-20',
    currency: CURRENCY,
  },
  {
    id: 'inv-cobalt',
    firmId: FIRM_ID,
    fundId: FUND_ID,
    companyId: 'co-cobalt',
    instrument: 'Series A Preferred',
    costMinor: usdMillions(3),
    ownershipBps: 700,
    round: 'Series A',
    date: '2025-04-10',
    currency: CURRENCY,
  },
];

// Company-level fair values (whole-company equity value). Fund stake =
// ownershipBps × fair value, computed inside rollupPortfolio.
const companyValuations: CompanyValuation[] = [
  { firmId: FIRM_ID, companyId: 'co-northwind', asOf: AS_OF, fairValueMinor: usdMillions(50), currency: CURRENCY }, // prettier-ignore
  {
    firmId: FIRM_ID,
    companyId: 'co-vela',
    asOf: AS_OF,
    fairValueMinor: usdMillions(80),
    currency: CURRENCY,
  },
  {
    firmId: FIRM_ID,
    companyId: 'co-lumen',
    asOf: AS_OF,
    fairValueMinor: usdMillions(30),
    currency: CURRENCY,
  },
  { firmId: FIRM_ID, companyId: 'co-cobalt', asOf: AS_OF, fairValueMinor: usdMillions(50), currency: CURRENCY }, // prettier-ignore
];

export const valuationsByCompany = new Map(companyValuations.map((v) => [v.companyId, v]));

export const portfolio = rollupPortfolio(investments, valuationsByCompany, CURRENCY);

// ---------------------------------------------------------------------------
// AI proposals for the review queue — propose-only, awaiting human review
// ---------------------------------------------------------------------------

const journalProposal: JournalEntryProposal = {
  kind: 'journal_entry',
  schemaVersion: 1,
  confidence: 0.94,
  model: 'claude-opus-4',
  promptVersion: 'journal-entry@2026-05',
  createdByAgent: 'journal-entry-agent',
  evidence: [
    {
      field: 'lines.0.amountMinor',
      sourceRef: 'invoice:APEX-FUNDADMIN-2026-Q2',
      quote: 'Total amount due: $42,500.00 for Q2 2026 fund administration services',
    },
    {
      field: 'lines.1.accountCode',
      sourceRef: 'invoice:APEX-FUNDADMIN-2026-Q2',
      quote: 'Remit to: Apex Fund Administration LLC — Net 30',
    },
  ],
  payload: {
    entityId: FUND_ID,
    date: '2026-06-30',
    memo: 'Q2 2026 fund administration fee — Apex Fund Administration LLC',
    currency: CURRENCY,
    lines: [
      {
        accountCode: '5000',
        side: 'debit',
        amountMinor: 42_500_00,
        rationale: 'Fund administration is a fund operating expense.',
      },
      {
        accountCode: '2000',
        side: 'credit',
        amountMinor: 42_500_00,
        rationale: 'Unpaid invoice → accrued expense payable (Net 30).',
      },
    ],
  },
};

const reconProposal: ReconciliationMatchProposal = {
  kind: 'reconciliation_match',
  schemaVersion: 1,
  confidence: 0.98,
  model: 'claude-opus-4',
  promptVersion: 'recon-match@2026-05',
  createdByAgent: 'reconciliation-agent',
  evidence: [
    {
      field: 'ledgerEntryId',
      sourceRef: 'bank:SVB-2026-07-05-INBOUND',
      quote: 'ACH credit $20,000,000.00 ref "GV2 CALL #2" on 2026-07-05',
    },
    {
      field: 'status',
      sourceRef: 'ledger:je-call-2',
      quote: 'Journal je-call-2: DR Cash 20,000,000.00 / CR Partners’ Capital 20,000,000.00',
    },
  ],
  payload: {
    bankTransactionId: 'SVB-2026-07-05-INBOUND',
    ledgerEntryId: 'je-call-2',
    status: 'matched',
    rationale: 'Amount, date and reference "CALL #2" match the capital-call journal exactly.',
  },
};

const kpiProposal: KpiProposal = {
  kind: 'kpi',
  schemaVersion: 1,
  confidence: 0.71,
  model: 'claude-opus-4',
  promptVersion: 'kpi-reconcile@2026-05',
  createdByAgent: 'kpi-agent',
  evidence: [
    {
      field: 'sources.0.value',
      sourceRef: 'doc:vela-board-deck-2026Q2',
      quote: 'ARR reached $18.4M at end of Q2 (up 22% QoQ)',
    },
    {
      field: 'sources.1.value',
      sourceRef: 'email:vela-cfo-2026-07-02',
      quote: 'We are now at roughly $18.2M ARR run-rate as of quarter close',
    },
  ],
  payload: {
    companyId: 'co-vela',
    period: '2026-Q2',
    metric: 'ARR',
    reconciledValue: '$18.4M',
    sources: [
      { source: 'Board deck (2026 Q2)', value: '$18.4M' },
      { source: 'CFO email (2026-07-02)', value: '$18.2M' },
    ],
    rationale:
      'Two sources disagree by $0.2M; the board deck is the more authoritative close figure. Flagged for review.',
  },
};

const feeAccrualProposal: JournalEntryProposal = {
  kind: 'journal_entry',
  schemaVersion: 1,
  confidence: 0.89,
  model: 'claude-opus-4',
  promptVersion: 'journal-entry@2026-05',
  createdByAgent: 'journal-entry-agent',
  evidence: [
    {
      field: 'lines.0.amountMinor',
      sourceRef: 'lpa:gv2-section-6.1',
      quote:
        'Management fee: 2.00% per annum of aggregate commitments, payable quarterly in advance',
    },
    {
      field: 'payload.memo',
      sourceRef: 'schedule:mgmt-fee-2026Q3',
      quote: 'Q3 2026 accrual: 2.00% × $100,000,000 × 0.25 = $500,000.00',
    },
  ],
  payload: {
    entityId: FUND_ID,
    date: '2026-07-01',
    memo: 'Q3 2026 management fee accrual (2.00% p.a. on $100M commitments)',
    currency: CURRENCY,
    lines: [
      {
        accountCode: '5000',
        side: 'debit',
        amountMinor: 500_000_00,
        rationale: 'Management fee expense for the quarter.',
      },
      {
        accountCode: '2000',
        side: 'credit',
        amountMinor: 500_000_00,
        rationale: 'Fee payable to the GP / management company.',
      },
    ],
  },
};

export const proposals: Proposal<ProposalKind, unknown>[] = [
  reconProposal,
  journalProposal,
  feeAccrualProposal,
  kpiProposal,
];

// ---------------------------------------------------------------------------
// Reconciliation — three-way match rows (bank / ledger / document)
// ---------------------------------------------------------------------------

export type ReconStatus = 'matched' | 'exception' | 'unmatched';

export interface ReconRow {
  id: string;
  date: string;
  description: string;
  bankMinor: number;
  ledgerMinor: number | null;
  documentRef: string | null;
  status: ReconStatus;
  note: string;
}

export const reconRows: ReconRow[] = [
  {
    id: 'SVB-2026-07-05-INBOUND',
    date: '2026-07-05',
    description: 'Capital call #2 — LP wires (aggregate)',
    bankMinor: usdMillions(20),
    ledgerMinor: usdMillions(20),
    documentRef: 'je-call-2',
    status: 'exception',
    note: 'AI has proposed a match to journal je-call-2 — awaiting expert review in the queue.',
  },
  {
    id: 'SVB-2026-06-18-OUT',
    date: '2026-06-18',
    description: 'Wire to Cobalt Systems — Series A follow-on',
    bankMinor: -usdMillions(3),
    ledgerMinor: -usdMillions(3),
    documentRef: 'saf:cobalt-2026-06',
    status: 'matched',
    note: 'Investment funding matches the executed SAFE / share purchase.',
  },
  {
    id: 'SVB-2026-06-30-FEE',
    date: '2026-06-30',
    description: 'Apex Fund Administration — Q2 invoice',
    bankMinor: -42_500_00,
    ledgerMinor: null,
    documentRef: 'invoice:APEX-FUNDADMIN-2026-Q2',
    status: 'exception',
    note: 'Bank debit + invoice present, but no posted journal yet — see proposed entry in the review queue.',
  },
  {
    id: 'SVB-2026-06-22-BANKFEE',
    date: '2026-06-22',
    description: 'Wire / banking fees',
    bankMinor: -45_00,
    ledgerMinor: null,
    documentRef: null,
    status: 'unmatched',
    note: 'Small bank fee with no supporting document; awaiting classification.',
  },
];

export const reconSummary = {
  matched: reconRows.filter((r) => r.status === 'matched').length,
  exception: reconRows.filter((r) => r.status === 'exception').length,
  unmatched: reconRows.filter((r) => r.status === 'unmatched').length,
  total: reconRows.length,
};

// ---------------------------------------------------------------------------
// Dashboard: recent activity feed
// ---------------------------------------------------------------------------

export interface ActivityItem {
  date: string;
  title: string;
  detail: string;
  tag: 'call' | 'nav' | 'proposal' | 'portfolio' | 'recon';
}

export const recentActivity: ActivityItem[] = [
  {
    date: '2026-07-05',
    title: 'Capital call #2 funded',
    // Consistent with reconRows[SVB-2026-07-05-INBOUND], which is an OPEN
    // exception (AI proposed the match; a human has not yet approved it) — so we
    // must not claim it is already "matched".
    detail: `${lps.length} LP wires totaling $${(CALL_TOTAL / 100_000_000).toFixed(1)}M received; AI proposed a match — awaiting expert review.`,
    tag: 'call',
  },
  {
    date: '2026-07-02',
    title: 'KPI reconciliation prepared',
    detail: 'Vela Health Q2 ARR reconciled across two sources — awaiting review.',
    tag: 'proposal',
  },
  {
    date: '2026-06-30',
    title: 'NAV snapshot computed',
    // Derived from the posted GL (computeNav), never hardcoded — so this line can
    // never drift from the number the NAV page actually renders.
    detail: `Fund NAV of $${(navTotalMinor / 100_000_000).toFixed(2)}M as of quarter close from the posted GL.`,
    tag: 'nav',
  },
  {
    date: '2026-06-30',
    title: 'Portfolio marks updated',
    detail: `${portfolio.positions.length} positions re-valued; unrealized gain of $${(portfolio.totalUnrealizedGainMinor / 100_000_000).toFixed(1)}M recognized.`,
    tag: 'portfolio',
  },
  {
    date: '2026-06-18',
    title: 'Follow-on funded',
    detail: 'Cobalt Systems Series A follow-on wired and reconciled.',
    tag: 'recon',
  },
];
