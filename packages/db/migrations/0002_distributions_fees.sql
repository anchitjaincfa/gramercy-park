-- Gramercy Park — Phase 2b migration.
-- Distributions (per-fund, sequentially numbered), their per-LP allocations, and
-- management fee schedules (per fund share class).
-- Every table is firm-scoped and RLS-isolated; FKs carry firm_id (and fund_id
-- where relevant) into their composite targets so a child can never reference a
-- parent in another firm. Matches migrations/0001_fund_admin.sql conventions.
-- See docs/ARCHITECTURE.md §3, §7.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
CREATE TYPE distribution_kind AS ENUM ('return_of_capital', 'gain', 'income');
CREATE TYPE fee_basis         AS ENUM ('committed', 'invested', 'nav');
CREATE TYPE fee_frequency     AS ENUM ('quarterly', 'semiannual', 'annual');

-- ---------------------------------------------------------------------------
-- Distributions (per fund, sequentially numbered)
-- ---------------------------------------------------------------------------
CREATE TABLE distributions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id     uuid NOT NULL REFERENCES firms(id),
  fund_id     uuid NOT NULL,
  number      int NOT NULL,
  date        date NOT NULL,
  kind        distribution_kind NOT NULL,
  recallable  boolean NOT NULL DEFAULT false,
  total_minor bigint NOT NULL,
  currency    text NOT NULL,
  status      text NOT NULL DEFAULT 'draft',
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_distributions_total_positive CHECK (total_minor > 0),
  -- the fund must live in the same firm as the distribution
  CONSTRAINT fk_distributions_fund_firm FOREIGN KEY (fund_id, firm_id)
    REFERENCES entities(id, firm_id),
  CONSTRAINT uq_distributions_fund_number UNIQUE (fund_id, number),
  -- composite target so allocations can firm-pin a distribution
  CONSTRAINT uq_distributions_id_firm UNIQUE (id, firm_id)
);

-- ---------------------------------------------------------------------------
-- Distribution allocations (per-LP breakdown of a distribution)
-- ---------------------------------------------------------------------------
CREATE TABLE distribution_allocations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id         uuid NOT NULL REFERENCES firms(id),
  distribution_id uuid NOT NULL,
  lp_id           uuid NOT NULL,
  amount_minor    bigint NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_dist_alloc_amount_positive CHECK (amount_minor > 0),
  -- distribution and LP must belong to the same firm as the allocation
  CONSTRAINT fk_dist_alloc_distribution_firm FOREIGN KEY (distribution_id, firm_id)
    REFERENCES distributions(id, firm_id),
  CONSTRAINT fk_dist_alloc_lp_firm FOREIGN KEY (lp_id, firm_id)
    REFERENCES lps(id, firm_id),
  CONSTRAINT uq_dist_alloc_distribution_lp UNIQUE (distribution_id, lp_id)
);

-- ---------------------------------------------------------------------------
-- Management fee schedules (per fund share class)
-- ---------------------------------------------------------------------------
CREATE TABLE mgmt_fee_schedules (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id    uuid NOT NULL REFERENCES firms(id),
  fund_id    uuid NOT NULL,
  class_id   uuid NOT NULL,
  rate_bps   int NOT NULL,
  basis      fee_basis NOT NULL,
  frequency  fee_frequency NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_mgmt_fee_rate_nonneg CHECK (rate_bps >= 0),
  -- fund and class must belong to the same firm as the schedule, and the class
  -- must belong to the SAME fund as the schedule
  CONSTRAINT fk_mgmt_fee_fund_firm FOREIGN KEY (fund_id, firm_id)
    REFERENCES entities(id, firm_id),
  CONSTRAINT fk_mgmt_fee_class_fund_firm FOREIGN KEY (class_id, fund_id, firm_id)
    REFERENCES share_classes(id, fund_id, firm_id)
);
CREATE INDEX idx_mgmt_fee_schedules_firm ON mgmt_fee_schedules(firm_id);

-- ---------------------------------------------------------------------------
-- Row-level security: every table isolated by firm_id.
-- The app sets `SET LOCAL app.current_firm = '<uuid>'` per request/transaction.
-- current_setting(..., true) returns NULL when unset -> default deny.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'distributions','distribution_allocations','mgmt_fee_schedules'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format(
      'CREATE POLICY firm_isolation ON %I
         USING (firm_id = current_setting(''app.current_firm'', true)::uuid)
         WITH CHECK (firm_id = current_setting(''app.current_firm'', true)::uuid);', t);
  END LOOP;
END $$;
