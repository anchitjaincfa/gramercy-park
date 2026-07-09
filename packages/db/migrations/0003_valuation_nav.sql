-- Gramercy Park — Phase 2c migration.
-- Accounting periods (per entity, per YYYY-MM), versioned valuations (fair-value
-- marks retained across restatements), and NAV snapshots with their per-LP share
-- breakdown. Historical NAV and LP statements must stay reproducible even after a
-- backdated journal or a valuation restatement, so valuations are versioned and
-- NAV is snapshotted, never silently recomputed.
-- Every table is firm-scoped and RLS-isolated; FKs carry firm_id (and fund_id
-- where relevant) into their composite targets so a child can never reference a
-- parent in another firm. Matches migrations/0002_distributions_fees.sql
-- conventions. See docs/ARCHITECTURE.md §3.3, §4.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
CREATE TYPE period_status AS ENUM ('open', 'closed', 'reopened');

-- ---------------------------------------------------------------------------
-- Prerequisite composite target on accounts so valuations can firm-pin an
-- investment account. accounts already has UNIQUE (id, entity_id, firm_id) but
-- not (id, firm_id); add it here to mirror the schema.ts uniqueIndex.
-- ---------------------------------------------------------------------------
ALTER TABLE accounts ADD CONSTRAINT uq_accounts_id_firm UNIQUE (id, firm_id);

-- ---------------------------------------------------------------------------
-- Accounting periods (per entity, per YYYY-MM)
-- ---------------------------------------------------------------------------
CREATE TABLE accounting_periods (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id    uuid NOT NULL REFERENCES firms(id),
  entity_id  uuid NOT NULL,
  period     text NOT NULL, -- YYYY-MM
  status     period_status NOT NULL DEFAULT 'open',
  closed_at  timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_accounting_periods_format CHECK (period ~ '^[0-9]{4}-[0-9]{2}$'),
  -- the entity must live in the same firm as the period
  CONSTRAINT fk_accounting_periods_entity_firm FOREIGN KEY (entity_id, firm_id)
    REFERENCES entities(id, firm_id),
  CONSTRAINT uq_accounting_periods_entity_period UNIQUE (entity_id, period)
);

-- ---------------------------------------------------------------------------
-- Valuations (versioned fair-value marks per investment account)
-- ---------------------------------------------------------------------------
CREATE TABLE valuations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id               uuid NOT NULL REFERENCES firms(id),
  investment_account_id uuid NOT NULL,
  as_of                 date NOT NULL,
  version               int NOT NULL,
  fair_value_minor      bigint NOT NULL,
  currency              text NOT NULL,
  method                text NOT NULL,
  superseded_by         uuid,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_valuations_version_positive CHECK (version > 0),
  CONSTRAINT ck_valuations_fair_value_nonneg CHECK (fair_value_minor >= 0),
  -- the investment account must live in the same firm as the valuation
  CONSTRAINT fk_valuations_account_firm FOREIGN KEY (investment_account_id, firm_id)
    REFERENCES accounts(id, firm_id),
  -- composite target so a valuation can firm-pin the one it supersedes
  CONSTRAINT uq_valuations_id_firm UNIQUE (id, firm_id),
  -- superseded_by must reference a valuation in the SAME firm (no cross-firm lineage)
  CONSTRAINT fk_valuations_superseded_firm FOREIGN KEY (superseded_by, firm_id)
    REFERENCES valuations(id, firm_id),
  CONSTRAINT uq_valuations_account_asof_version UNIQUE (investment_account_id, as_of, version)
);

-- ---------------------------------------------------------------------------
-- NAV snapshots (immutable record of a NAV close per fund, per as-of date)
-- ---------------------------------------------------------------------------
CREATE TABLE nav_snapshots (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id                    uuid NOT NULL REFERENCES firms(id),
  fund_id                    uuid NOT NULL,
  as_of                      date NOT NULL,
  total_nav_minor            bigint NOT NULL,
  currency                   text NOT NULL,
  valuation_version_set_hash text,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  -- the fund must live in the same firm as the snapshot
  CONSTRAINT fk_nav_snapshots_fund_firm FOREIGN KEY (fund_id, firm_id)
    REFERENCES entities(id, firm_id),
  CONSTRAINT uq_nav_snapshots_fund_asof UNIQUE (fund_id, as_of),
  -- composite target so LP shares can firm-pin a snapshot
  CONSTRAINT uq_nav_snapshots_id_firm UNIQUE (id, firm_id)
);

-- ---------------------------------------------------------------------------
-- NAV snapshot LP shares (per-LP breakdown of a NAV snapshot)
-- ---------------------------------------------------------------------------
CREATE TABLE nav_snapshot_lp_shares (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id         uuid NOT NULL REFERENCES firms(id),
  snapshot_id     uuid NOT NULL,
  lp_id           uuid NOT NULL,
  nav_share_minor bigint NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- snapshot and LP must belong to the same firm as the share row
  CONSTRAINT fk_nav_snap_lp_snapshot_firm FOREIGN KEY (snapshot_id, firm_id)
    REFERENCES nav_snapshots(id, firm_id),
  CONSTRAINT fk_nav_snap_lp_lp_firm FOREIGN KEY (lp_id, firm_id)
    REFERENCES lps(id, firm_id),
  CONSTRAINT uq_nav_snapshot_lp_shares_snapshot_lp UNIQUE (snapshot_id, lp_id)
);

-- ---------------------------------------------------------------------------
-- Row-level security: every table isolated by firm_id.
-- The app sets `SET LOCAL app.current_firm = '<uuid>'` per request/transaction.
-- current_setting(..., true) returns NULL when unset -> default deny.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'accounting_periods','valuations','nav_snapshots','nav_snapshot_lp_shares'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format(
      'CREATE POLICY firm_isolation ON %I
         USING (firm_id = current_setting(''app.current_firm'', true)::uuid)
         WITH CHECK (firm_id = current_setting(''app.current_firm'', true)::uuid);', t);
  END LOOP;
END $$;
