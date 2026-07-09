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
};
