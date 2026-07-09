import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  bigint,
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

export const schema = {
  firms,
  memberships,
  entities,
  accounts,
  journalBatches,
  journals,
  journalLines,
  auditEvents,
};
