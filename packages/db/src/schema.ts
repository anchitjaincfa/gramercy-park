import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  bigint,
  integer,
  boolean,
  jsonb,
  date,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

/**
 * Phase 1 schema — the deterministic ledger core plus foundational tenancy and
 * audit. Every table carries a denormalized `firm_id` (RLS predicate) per
 * docs/ARCHITECTURE.md §3. Immutability of posted rows and the append-only audit
 * log are enforced by triggers in the SQL migration (see migrations/0000_init.sql).
 */

export const entityType = pgEnum('entity_type', ['fund', 'feeder', 'spv', 'mgmtco', 'gp']);
export const accountType = pgEnum('account_type', [
  'asset',
  'liability',
  'equity',
  'income',
  'expense',
]);
export const lineSide = pgEnum('line_side', ['debit', 'credit']);
export const batchStatus = pgEnum('batch_status', ['draft', 'posted', 'reversed']);
export const journalStatus = pgEnum('journal_status', ['draft', 'posted', 'reversed']);
export const roleType = pgEnum('role_type', ['owner', 'accountant', 'reviewer', 'read_only', 'lp']);

// Phase 2a — fund administration
export const lpStatus = pgEnum('lp_status', ['active', 'transferred', 'inactive']);
export const callStatus = pgEnum('call_status', ['draft', 'issued', 'posted']);
export const callAllocKind = pgEnum('call_alloc_kind', ['contribution', 'recall', 'fee_offset']);

// Phase 2b — distributions and management fees
export const distributionKind = pgEnum('distribution_kind', [
  'return_of_capital',
  'gain',
  'income',
]);
export const feeBasis = pgEnum('fee_basis', ['committed', 'invested', 'nav']);
export const feeFrequency = pgEnum('fee_frequency', ['quarterly', 'semiannual', 'annual']);

// Phase 2c — accounting periods, versioned valuations, NAV snapshots
export const periodStatus = pgEnum('period_status', ['open', 'closed', 'reopened']);

// Phase 3 — reconciliation: bank transactions, source documents, matches, exceptions
export const sourceDocKind = pgEnum('source_doc_kind', [
  'invoice',
  'capital_call_notice',
  'distribution_notice',
  'mgmt_fee_invoice',
  'other',
]);
export const matchStatus = pgEnum('match_status', ['matched', 'partial', 'unmatched']);
export const reconExceptionCode = pgEnum('recon_exception_code', [
  'UNMATCHED_BANK',
  'UNMATCHED_LEDGER',
  'MISSING_DOCUMENT',
  'AMOUNT_MISMATCH',
  'CURRENCY_MISMATCH',
  'DUPLICATE_MATCH',
]);

const money = (name: string) => bigint(name, { mode: 'number' });

export const firms = pgTable('firms', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  baseCurrency: text('base_currency').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    firmId: uuid('firm_id')
      .notNull()
      .references(() => firms.id),
    userId: uuid('user_id').notNull(),
    role: roleType('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uqUserFirm: uniqueIndex('uq_membership_user_firm').on(t.firmId, t.userId),
  }),
);

export const entities = pgTable(
  'entities',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    firmId: uuid('firm_id')
      .notNull()
      .references(() => firms.id),
    type: entityType('type').notNull(),
    name: text('name').notNull(),
    baseCurrency: text('base_currency').notNull(),
    parentId: uuid('parent_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    byFirm: index('idx_entities_firm').on(t.firmId),
  }),
);

export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    firmId: uuid('firm_id')
      .notNull()
      .references(() => firms.id),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    type: accountType('type').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uqEntityCode: uniqueIndex('uq_accounts_entity_code').on(t.entityId, t.code),
    // composite target for journal_lines FKs (see migrations/0000_init.sql)
    uqIdEntityFirm: uniqueIndex('uq_accounts_id_entity_firm').on(t.id, t.entityId, t.firmId),
    // composite target so valuations can firm-pin an investment account (Phase 2c)
    uqIdFirm: uniqueIndex('uq_accounts_id_firm').on(t.id, t.firmId),
  }),
);

export const journalBatches = pgTable(
  'journal_batches',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    firmId: uuid('firm_id')
      .notNull()
      .references(() => firms.id),
    date: date('date').notNull(),
    memo: text('memo').notNull(),
    sourceType: text('source_type').notNull(),
    sourceId: text('source_id').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    status: batchStatus('status').notNull().default('draft'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uqIdem: uniqueIndex('uq_batch_firm_idempotency').on(t.firmId, t.idempotencyKey),
    uqIdFirm: uniqueIndex('uq_batches_id_firm').on(t.id, t.firmId),
  }),
);

export const journals = pgTable(
  'journals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    firmId: uuid('firm_id')
      .notNull()
      .references(() => firms.id),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => journalBatches.id),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id),
    date: date('date').notNull(),
    memo: text('memo').notNull(),
    status: journalStatus('status').notNull().default('draft'),
    postedAt: timestamp('posted_at', { withTimezone: true }),
    reversalOf: uuid('reversal_of'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    byEntity: index('idx_journals_entity').on(t.entityId),
    uqReversalOf: uniqueIndex('uq_journals_reversal_of').on(t.reversalOf),
    uqIdEntityFirm: uniqueIndex('uq_journals_id_entity_firm').on(t.id, t.entityId, t.firmId),
  }),
);

export const journalLines = pgTable(
  'journal_lines',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    firmId: uuid('firm_id')
      .notNull()
      .references(() => firms.id),
    journalId: uuid('journal_id')
      .notNull()
      .references(() => journals.id),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    side: lineSide('side').notNull(),
    amountMinor: money('amount_minor').notNull(),
    currency: text('currency').notNull(),
  },
  (t) => ({
    byJournal: index('idx_lines_journal').on(t.journalId),
    byAccount: index('idx_lines_account').on(t.accountId),
  }),
);

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    firmId: uuid('firm_id')
      .notNull()
      .references(() => firms.id),
    actor: text('actor').notNull(),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    at: timestamp('at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    byFirm: index('idx_audit_firm').on(t.firmId),
  }),
);

// ---------------------------------------------------------------------------
// Phase 2a — fund administration: LPs, share classes, commitments, capital calls.
// FKs pin firm_id via composite (id, firm_id) targets so a child can never point
// at a parent in another firm. See migrations/0001_fund_admin.sql.
// ---------------------------------------------------------------------------

export const lps = pgTable(
  'lps',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    firmId: uuid('firm_id')
      .notNull()
      .references(() => firms.id),
    name: text('name').notNull(),
    type: text('type').notNull(),
    status: lpStatus('status').notNull().default('active'),
    contact: jsonb('contact'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    byFirm: index('idx_lps_firm').on(t.firmId),
    // composite target so children can firm-pin an LP
    uqIdFirm: uniqueIndex('uq_lps_id_firm').on(t.id, t.firmId),
  }),
);

export const shareClasses = pgTable(
  'share_classes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    firmId: uuid('firm_id')
      .notNull()
      .references(() => firms.id),
    fundId: uuid('fund_id').notNull(),
    name: text('name').notNull(),
    mgmtFeeBps: integer('mgmt_fee_bps').notNull(),
    carryBps: integer('carry_bps').notNull(),
    hurdleBps: integer('hurdle_bps'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    byFirm: index('idx_share_classes_firm').on(t.firmId),
    // composite targets so commitments can firm-pin AND fund-pin a share class
    uqIdFirm: uniqueIndex('uq_share_classes_id_firm').on(t.id, t.firmId),
    uqIdFundFirm: uniqueIndex('uq_share_classes_id_fund_firm').on(t.id, t.fundId, t.firmId),
  }),
);

export const commitments = pgTable(
  'commitments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    firmId: uuid('firm_id')
      .notNull()
      .references(() => firms.id),
    fundId: uuid('fund_id').notNull(),
    lpId: uuid('lp_id').notNull(),
    classId: uuid('class_id').notNull(),
    amountMinor: money('amount_minor').notNull(),
    currency: text('currency').notNull(),
    effectiveDate: date('effective_date').notNull(),
    recallableUsedMinor: money('recallable_used_minor').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uqFundLpClass: uniqueIndex('uq_commitments_fund_lp_class').on(t.fundId, t.lpId, t.classId),
  }),
);

export const capitalCalls = pgTable(
  'capital_calls',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    firmId: uuid('firm_id')
      .notNull()
      .references(() => firms.id),
    fundId: uuid('fund_id').notNull(),
    number: integer('number').notNull(),
    callDate: date('call_date').notNull(),
    dueDate: date('due_date').notNull(),
    purpose: text('purpose').notNull(),
    totalMinor: money('total_minor').notNull(),
    currency: text('currency').notNull(),
    status: callStatus('status').notNull().default('draft'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uqFundNumber: uniqueIndex('uq_capital_calls_fund_number').on(t.fundId, t.number),
    // composite target so allocations can firm-pin a call
    uqIdFirm: uniqueIndex('uq_capital_calls_id_firm').on(t.id, t.firmId),
  }),
);

export const capitalCallAllocations = pgTable(
  'capital_call_allocations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    firmId: uuid('firm_id')
      .notNull()
      .references(() => firms.id),
    callId: uuid('call_id').notNull(),
    lpId: uuid('lp_id').notNull(),
    amountMinor: money('amount_minor').notNull(),
    kind: callAllocKind('kind').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uqCallLpKind: uniqueIndex('uq_call_alloc_call_lp_kind').on(t.callId, t.lpId, t.kind),
  }),
);

// ---------------------------------------------------------------------------
// Phase 2b — distributions and management fees. Same firm-pinned composite FK
// discipline as Phase 2a: children carry firm_id (and fund_id where relevant)
// into composite (id, firm_id) targets. See migrations/0002_distributions_fees.sql.
// ---------------------------------------------------------------------------

export const distributions = pgTable(
  'distributions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    firmId: uuid('firm_id')
      .notNull()
      .references(() => firms.id),
    fundId: uuid('fund_id').notNull(),
    number: integer('number').notNull(),
    date: date('date').notNull(),
    kind: distributionKind('kind').notNull(),
    recallable: boolean('recallable').notNull().default(false),
    totalMinor: money('total_minor').notNull(),
    currency: text('currency').notNull(),
    status: text('status').notNull().default('draft'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uqFundNumber: uniqueIndex('uq_distributions_fund_number').on(t.fundId, t.number),
    // composite target so allocations can firm-pin a distribution
    uqIdFirm: uniqueIndex('uq_distributions_id_firm').on(t.id, t.firmId),
  }),
);

export const distributionAllocations = pgTable(
  'distribution_allocations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    firmId: uuid('firm_id')
      .notNull()
      .references(() => firms.id),
    distributionId: uuid('distribution_id').notNull(),
    lpId: uuid('lp_id').notNull(),
    amountMinor: money('amount_minor').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uqDistributionLp: uniqueIndex('uq_dist_alloc_distribution_lp').on(t.distributionId, t.lpId),
  }),
);

export const mgmtFeeSchedules = pgTable(
  'mgmt_fee_schedules',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    firmId: uuid('firm_id')
      .notNull()
      .references(() => firms.id),
    fundId: uuid('fund_id').notNull(),
    classId: uuid('class_id').notNull(),
    rateBps: integer('rate_bps').notNull(),
    basis: feeBasis('basis').notNull(),
    frequency: feeFrequency('frequency').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    byFirm: index('idx_mgmt_fee_schedules_firm').on(t.firmId),
  }),
);

// ---------------------------------------------------------------------------
// Phase 2c — accounting periods, versioned valuations, NAV snapshots. Same
// firm-pinned composite FK discipline: children carry firm_id (and fund_id
// where relevant) into composite (id, firm_id) targets. Historical NAV/LP
// statements stay reproducible — valuations are versioned and NAV is
// snapshotted, never silently recomputed. See migrations/0003_valuation_nav.sql
// and docs/ARCHITECTURE.md §3.3.
// ---------------------------------------------------------------------------

export const accountingPeriods = pgTable(
  'accounting_periods',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    firmId: uuid('firm_id')
      .notNull()
      .references(() => firms.id),
    entityId: uuid('entity_id').notNull(),
    period: text('period').notNull(), // YYYY-MM
    status: periodStatus('status').notNull().default('open'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    // the entity must live in the same firm as the period
    uqEntityPeriod: uniqueIndex('uq_accounting_periods_entity_period').on(t.entityId, t.period),
  }),
);

export const valuations = pgTable(
  'valuations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    firmId: uuid('firm_id')
      .notNull()
      .references(() => firms.id),
    investmentAccountId: uuid('investment_account_id').notNull(),
    asOf: date('as_of').notNull(),
    version: integer('version').notNull(),
    fairValueMinor: money('fair_value_minor').notNull(),
    currency: text('currency').notNull(),
    method: text('method').notNull(),
    supersededBy: uuid('superseded_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uqAccountAsOfVersion: uniqueIndex('uq_valuations_account_asof_version').on(
      t.investmentAccountId,
      t.asOf,
      t.version,
    ),
    // composite target so a valuation can firm-pin the one it supersedes
    uqIdFirm: uniqueIndex('uq_valuations_id_firm').on(t.id, t.firmId),
  }),
);

export const navSnapshots = pgTable(
  'nav_snapshots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    firmId: uuid('firm_id')
      .notNull()
      .references(() => firms.id),
    fundId: uuid('fund_id').notNull(),
    asOf: date('as_of').notNull(),
    totalNavMinor: money('total_nav_minor').notNull(),
    currency: text('currency').notNull(),
    valuationVersionSetHash: text('valuation_version_set_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uqFundAsOf: uniqueIndex('uq_nav_snapshots_fund_asof').on(t.fundId, t.asOf),
    // composite target so LP shares can firm-pin a snapshot
    uqIdFirm: uniqueIndex('uq_nav_snapshots_id_firm').on(t.id, t.firmId),
  }),
);

export const navSnapshotLpShares = pgTable(
  'nav_snapshot_lp_shares',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    firmId: uuid('firm_id')
      .notNull()
      .references(() => firms.id),
    snapshotId: uuid('snapshot_id').notNull(),
    lpId: uuid('lp_id').notNull(),
    navShareMinor: money('nav_share_minor').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uqSnapshotLp: uniqueIndex('uq_nav_snapshot_lp_shares_snapshot_lp').on(t.snapshotId, t.lpId),
  }),
);

// ---------------------------------------------------------------------------
// Phase 3 — reconciliation: imported bank transactions and source documents,
// the matches that tie them back to the deterministic ledger, and the
// exceptions raised when a clean three-way match cannot be made. Same
// firm-pinned composite FK discipline: children carry firm_id into composite
// (id, firm_id) targets so a match can never straddle two firms. See
// migrations/0004_reconciliation.sql and docs/ARCHITECTURE.md §3.
// ---------------------------------------------------------------------------

export const bankTransactions = pgTable(
  'bank_transactions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    firmId: uuid('firm_id')
      .notNull()
      .references(() => firms.id),
    entityId: uuid('entity_id').notNull(),
    date: date('date').notNull(),
    amountMinor: money('amount_minor').notNull(), // signed
    currency: text('currency').notNull(),
    description: text('description').notNull(),
    counterparty: text('counterparty'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    byFirmEntityDate: index('idx_bank_transactions_firm_entity_date').on(
      t.firmId,
      t.entityId,
      t.date,
    ),
    // composite target so matches can firm-pin a bank transaction
    uqIdFirm: uniqueIndex('uq_bank_transactions_id_firm').on(t.id, t.firmId),
  }),
);

export const sourceDocuments = pgTable(
  'source_documents',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    firmId: uuid('firm_id')
      .notNull()
      .references(() => firms.id),
    entityId: uuid('entity_id').notNull(),
    kind: sourceDocKind('kind').notNull(),
    date: date('date').notNull(),
    amountMinor: money('amount_minor').notNull(),
    currency: text('currency').notNull(),
    reference: text('reference').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    // composite target so matches can firm-pin a source document
    uqIdFirm: uniqueIndex('uq_source_documents_id_firm').on(t.id, t.firmId),
  }),
);

export const reconciliationMatches = pgTable(
  'reconciliation_matches',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    firmId: uuid('firm_id')
      .notNull()
      .references(() => firms.id),
    bankTransactionId: uuid('bank_transaction_id').notNull(),
    ledgerJournalId: uuid('ledger_journal_id'),
    documentId: uuid('document_id'),
    status: matchStatus('status').notNull(),
    confidence: integer('confidence').notNull(), // 0..100
    reasons: text('reasons'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    // one match per bank transaction
    uqBankTransaction: uniqueIndex('uq_reconciliation_matches_bank_transaction').on(
      t.bankTransactionId,
    ),
  }),
);

export const reconExceptions = pgTable(
  'recon_exceptions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    firmId: uuid('firm_id')
      .notNull()
      .references(() => firms.id),
    code: reconExceptionCode('code').notNull(),
    message: text('message').notNull(),
    bankTransactionId: uuid('bank_transaction_id'),
    ledgerJournalId: uuid('ledger_journal_id'),
    documentId: uuid('document_id'),
    resolved: boolean('resolved').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    byFirm: index('idx_recon_exceptions_firm').on(t.firmId),
  }),
);

// ---------------------------------------------------------------------------
// Phase 5 — portfolio intelligence: the portfolio companies a fund invests in,
// the investments (positions) held against them, operating KPIs reported per
// company/period, and periodic fair-value marks per company. Same firm-pinned
// composite FK discipline as prior phases: children carry firm_id (and fund_id
// where relevant) into composite (id, firm_id) targets so a position, KPI, or
// valuation can never straddle two firms. See migrations/0005_portfolio.sql and
// docs/ARCHITECTURE.md §3.
// ---------------------------------------------------------------------------

export const portfolioCompanies = pgTable(
  'portfolio_companies',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    firmId: uuid('firm_id')
      .notNull()
      .references(() => firms.id),
    name: text('name').notNull(),
    sector: text('sector').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    byFirm: index('idx_portfolio_companies_firm').on(t.firmId),
    // composite target so investments/KPIs/valuations can firm-pin a company
    uqIdFirm: uniqueIndex('uq_portfolio_companies_id_firm').on(t.id, t.firmId),
  }),
);

export const investments = pgTable(
  'investments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    firmId: uuid('firm_id')
      .notNull()
      .references(() => firms.id),
    fundId: uuid('fund_id').notNull(),
    companyId: uuid('company_id').notNull(),
    instrument: text('instrument').notNull(),
    costMinor: money('cost_minor').notNull(),
    ownershipBps: integer('ownership_bps').notNull(),
    round: text('round').notNull(),
    date: date('date').notNull(),
    currency: text('currency').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    // composite target so downstream rows can firm-pin an investment
    uqIdFirm: uniqueIndex('uq_investments_id_firm').on(t.id, t.firmId),
  }),
);

export const kpis = pgTable(
  'kpis',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    firmId: uuid('firm_id')
      .notNull()
      .references(() => firms.id),
    companyId: uuid('company_id').notNull(),
    period: text('period').notNull(),
    metric: text('metric').notNull(),
    value: text('value').notNull(),
    source: text('source').notNull(),
    asOf: date('as_of').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    byFirmCompanyPeriod: index('idx_kpis_firm_company_period').on(
      t.firmId,
      t.companyId,
      t.period,
    ),
    uqCompanyPeriodMetricSource: uniqueIndex('uq_kpis_company_period_metric_source').on(
      t.companyId,
      t.period,
      t.metric,
      t.source,
    ),
  }),
);

export const companyValuations = pgTable(
  'company_valuations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    firmId: uuid('firm_id')
      .notNull()
      .references(() => firms.id),
    companyId: uuid('company_id').notNull(),
    asOf: date('as_of').notNull(),
    fairValueMinor: money('fair_value_minor').notNull(),
    currency: text('currency').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uqCompanyAsOf: uniqueIndex('uq_company_valuations_company_asof').on(t.companyId, t.asOf),
  }),
);

export const schema = {
  firms,
  memberships,
  entities,
  accounts,
  journalBatches,
  journals,
  journalLines,
  auditEvents,
  lps,
  shareClasses,
  commitments,
  capitalCalls,
  capitalCallAllocations,
  distributions,
  distributionAllocations,
  mgmtFeeSchedules,
  accountingPeriods,
  valuations,
  navSnapshots,
  navSnapshotLpShares,
  bankTransactions,
  sourceDocuments,
  reconciliationMatches,
  reconExceptions,
  portfolioCompanies,
  investments,
  kpis,
  companyValuations,
};
