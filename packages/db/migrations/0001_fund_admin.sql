-- Gramercy Park — Phase 2a migration.
-- Fund administration: LPs, share classes, commitments, and capital calls.
-- Every table is firm-scoped and RLS-isolated; FKs carry firm_id into their
-- composite targets so a child can never reference a parent in another firm.
-- Matches migrations/0000_init.sql conventions. See docs/ARCHITECTURE.md §3, §7.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
CREATE TYPE lp_status       AS ENUM ('active', 'transferred', 'inactive');
CREATE TYPE call_status     AS ENUM ('draft', 'issued', 'posted');
CREATE TYPE call_alloc_kind AS ENUM ('contribution', 'recall', 'fee_offset');

-- ---------------------------------------------------------------------------
-- Limited partners
-- ---------------------------------------------------------------------------
CREATE TABLE lps (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id    uuid NOT NULL REFERENCES firms(id),
  name       text NOT NULL,
  type       text NOT NULL,
  status     lp_status NOT NULL DEFAULT 'active',
  contact    jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- composite target so children can firm-pin an LP
  CONSTRAINT uq_lps_id_firm UNIQUE (id, firm_id)
);
CREATE INDEX idx_lps_firm ON lps(firm_id);

-- ---------------------------------------------------------------------------
-- Share classes (per fund entity)
-- ---------------------------------------------------------------------------
CREATE TABLE share_classes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id      uuid NOT NULL REFERENCES firms(id),
  fund_id      uuid NOT NULL,
  name         text NOT NULL,
  mgmt_fee_bps int NOT NULL,
  carry_bps    int NOT NULL,
  hurdle_bps   int,
  created_at   timestamptz NOT NULL DEFAULT now(),
  -- the fund must live in the same firm as the share class
  CONSTRAINT fk_share_classes_fund_firm FOREIGN KEY (fund_id, firm_id)
    REFERENCES entities(id, firm_id),
  -- composite targets so commitments can firm-pin AND fund-pin a share class
  CONSTRAINT uq_share_classes_id_firm UNIQUE (id, firm_id),
  CONSTRAINT uq_share_classes_id_fund_firm UNIQUE (id, fund_id, firm_id)
);
CREATE INDEX idx_share_classes_firm ON share_classes(firm_id);

-- ---------------------------------------------------------------------------
-- Commitments (an LP's subscription to a fund share class)
-- ---------------------------------------------------------------------------
CREATE TABLE commitments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id               uuid NOT NULL REFERENCES firms(id),
  fund_id               uuid NOT NULL,
  lp_id                 uuid NOT NULL,
  class_id              uuid NOT NULL,
  amount_minor          bigint NOT NULL,
  currency              text NOT NULL,
  effective_date        date NOT NULL,
  recallable_used_minor bigint NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_commitments_amount_positive CHECK (amount_minor > 0),
  CONSTRAINT ck_commitments_recallable_nonneg CHECK (recallable_used_minor >= 0),
  -- fund, LP, and class must all belong to the same firm as the commitment,
  -- and the class must belong to the SAME fund as the commitment
  CONSTRAINT fk_commitments_fund_firm FOREIGN KEY (fund_id, firm_id)
    REFERENCES entities(id, firm_id),
  CONSTRAINT fk_commitments_lp_firm FOREIGN KEY (lp_id, firm_id)
    REFERENCES lps(id, firm_id),
  CONSTRAINT fk_commitments_class_fund_firm FOREIGN KEY (class_id, fund_id, firm_id)
    REFERENCES share_classes(id, fund_id, firm_id),
  CONSTRAINT uq_commitments_fund_lp_class UNIQUE (fund_id, lp_id, class_id)
);

-- ---------------------------------------------------------------------------
-- Capital calls (per fund, sequentially numbered)
-- ---------------------------------------------------------------------------
CREATE TABLE capital_calls (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id     uuid NOT NULL REFERENCES firms(id),
  fund_id     uuid NOT NULL,
  number      int NOT NULL,
  call_date   date NOT NULL,
  due_date    date NOT NULL,
  purpose     text NOT NULL,
  total_minor bigint NOT NULL,
  currency    text NOT NULL,
  status      call_status NOT NULL DEFAULT 'draft',
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_capital_calls_total_positive CHECK (total_minor > 0),
  -- the fund must live in the same firm as the call
  CONSTRAINT fk_capital_calls_fund_firm FOREIGN KEY (fund_id, firm_id)
    REFERENCES entities(id, firm_id),
  CONSTRAINT uq_capital_calls_fund_number UNIQUE (fund_id, number),
  -- composite target so allocations can firm-pin a call
  CONSTRAINT uq_capital_calls_id_firm UNIQUE (id, firm_id)
);

-- ---------------------------------------------------------------------------
-- Capital call allocations (per-LP breakdown of a call)
-- ---------------------------------------------------------------------------
CREATE TABLE capital_call_allocations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id      uuid NOT NULL REFERENCES firms(id),
  call_id      uuid NOT NULL,
  lp_id        uuid NOT NULL,
  amount_minor bigint NOT NULL,
  kind         call_alloc_kind NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_call_alloc_amount_positive CHECK (amount_minor > 0),
  -- call and LP must belong to the same firm as the allocation
  CONSTRAINT fk_call_alloc_call_firm FOREIGN KEY (call_id, firm_id)
    REFERENCES capital_calls(id, firm_id),
  CONSTRAINT fk_call_alloc_lp_firm FOREIGN KEY (lp_id, firm_id)
    REFERENCES lps(id, firm_id),
  CONSTRAINT uq_call_alloc_call_lp_kind UNIQUE (call_id, lp_id, kind)
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
    'lps','share_classes','commitments','capital_calls','capital_call_allocations'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format(
      'CREATE POLICY firm_isolation ON %I
         USING (firm_id = current_setting(''app.current_firm'', true)::uuid)
         WITH CHECK (firm_id = current_setting(''app.current_firm'', true)::uuid);', t);
  END LOOP;
END $$;
