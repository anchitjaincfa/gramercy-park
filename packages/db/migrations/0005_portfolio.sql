-- Gramercy Park — Phase 5 migration.
-- Portfolio intelligence: the portfolio companies a fund invests in, the
-- investments (positions) held against them, the operating KPIs reported per
-- company/period, and the periodic fair-value marks per company. Portfolio
-- intelligence is a read-side overlay on the deterministic ledger: it records
-- what the fund owns and how those holdings are performing and valued — it
-- never mutates journals. Every table is firm-scoped and RLS-isolated; FKs
-- carry firm_id into their composite targets so a position, KPI, or valuation
-- can never straddle two firms. Matches migrations/0004_reconciliation.sql
-- conventions. See docs/ARCHITECTURE.md §3.

-- ---------------------------------------------------------------------------
-- Portfolio companies (the operating companies a fund holds positions in).
-- ---------------------------------------------------------------------------
CREATE TABLE portfolio_companies (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id    uuid NOT NULL REFERENCES firms(id),
  name       text NOT NULL,
  sector     text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- composite target so investments/KPIs/valuations can firm-pin a company
  CONSTRAINT uq_portfolio_companies_id_firm UNIQUE (id, firm_id)
);
CREATE INDEX idx_portfolio_companies_firm ON portfolio_companies(firm_id);

-- ---------------------------------------------------------------------------
-- Investments (positions held by a fund against a portfolio company).
-- cost_minor is the acquisition cost and is always non-negative; ownership_bps
-- is fractional ownership in basis points (0..10000).
-- ---------------------------------------------------------------------------
CREATE TABLE investments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id       uuid NOT NULL REFERENCES firms(id),
  fund_id       uuid NOT NULL,
  company_id    uuid NOT NULL,
  instrument    text NOT NULL,
  cost_minor    bigint NOT NULL,
  ownership_bps int NOT NULL,
  round         text NOT NULL,
  date          date NOT NULL,
  currency      text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_investments_cost_non_negative CHECK (cost_minor >= 0),
  CONSTRAINT ck_investments_ownership_bps_range CHECK (ownership_bps BETWEEN 0 AND 10000),
  -- the fund must live in the same firm as the investment
  CONSTRAINT fk_investments_fund_firm FOREIGN KEY (fund_id, firm_id)
    REFERENCES entities(id, firm_id),
  -- the company must live in the same firm as the investment
  CONSTRAINT fk_investments_company_firm FOREIGN KEY (company_id, firm_id)
    REFERENCES portfolio_companies(id, firm_id),
  -- composite target so downstream rows can firm-pin an investment
  CONSTRAINT uq_investments_id_firm UNIQUE (id, firm_id)
);

-- ---------------------------------------------------------------------------
-- KPIs (operating metrics reported per company/period, from a named source).
-- value is stored as text so heterogeneous metrics (currency, counts, ratios)
-- can share one table without lossy coercion.
-- ---------------------------------------------------------------------------
CREATE TABLE kpis (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id    uuid NOT NULL REFERENCES firms(id),
  company_id uuid NOT NULL,
  period     text NOT NULL,
  metric     text NOT NULL,
  value      text NOT NULL,
  source     text NOT NULL,
  as_of      date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- the company must live in the same firm as the KPI
  CONSTRAINT fk_kpis_company_firm FOREIGN KEY (company_id, firm_id)
    REFERENCES portfolio_companies(id, firm_id),
  -- one value per company/period/metric from a given source
  CONSTRAINT uq_kpis_company_period_metric_source UNIQUE (company_id, period, metric, source)
);
CREATE INDEX idx_kpis_firm_company_period ON kpis(firm_id, company_id, period);

-- ---------------------------------------------------------------------------
-- Company valuations (periodic fair-value marks per portfolio company).
-- fair_value_minor is the fair value and is always non-negative.
-- ---------------------------------------------------------------------------
CREATE TABLE company_valuations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id          uuid NOT NULL REFERENCES firms(id),
  company_id       uuid NOT NULL,
  as_of            date NOT NULL,
  fair_value_minor bigint NOT NULL,
  currency         text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_company_valuations_fair_value_non_negative CHECK (fair_value_minor >= 0),
  -- the company must live in the same firm as the valuation
  CONSTRAINT fk_company_valuations_company_firm FOREIGN KEY (company_id, firm_id)
    REFERENCES portfolio_companies(id, firm_id),
  -- one mark per company/as-of
  CONSTRAINT uq_company_valuations_company_asof UNIQUE (company_id, as_of)
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
    'portfolio_companies','investments','kpis','company_valuations'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format(
      'CREATE POLICY firm_isolation ON %I
         USING (firm_id = current_setting(''app.current_firm'', true)::uuid)
         WITH CHECK (firm_id = current_setting(''app.current_firm'', true)::uuid);', t);
  END LOOP;
END $$;
