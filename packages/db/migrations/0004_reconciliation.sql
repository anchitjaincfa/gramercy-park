-- Gramercy Park — Phase 3 migration.
-- Reconciliation: imported bank transactions and the source documents (invoices,
-- capital-call/distribution notices, fee invoices) they should correspond to, the
-- matches that tie a bank transaction back to the deterministic ledger and its
-- supporting document, and the exceptions raised when a clean three-way match
-- cannot be made. Reconciliation is a read-side overlay on the immutable ledger:
-- it never mutates journals — it records how bank activity maps onto them.
-- Every table is firm-scoped and RLS-isolated; FKs carry firm_id into their
-- composite targets so a match can never straddle two firms. Matches
-- migrations/0003_valuation_nav.sql conventions. See docs/ARCHITECTURE.md §3.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
CREATE TYPE source_doc_kind AS ENUM (
  'invoice', 'capital_call_notice', 'distribution_notice', 'mgmt_fee_invoice', 'other'
);
CREATE TYPE match_status AS ENUM ('matched', 'partial', 'unmatched');
CREATE TYPE recon_exception_code AS ENUM (
  'UNMATCHED_BANK', 'UNMATCHED_LEDGER', 'MISSING_DOCUMENT',
  'AMOUNT_MISMATCH', 'CURRENCY_MISMATCH', 'DUPLICATE_MATCH'
);

-- ---------------------------------------------------------------------------
-- Bank transactions (imported bank activity, per entity). amount_minor is
-- signed: positive = inflow, negative = outflow.
-- ---------------------------------------------------------------------------
CREATE TABLE bank_transactions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id      uuid NOT NULL REFERENCES firms(id),
  entity_id    uuid NOT NULL,
  date         date NOT NULL,
  amount_minor bigint NOT NULL, -- signed
  currency     text NOT NULL,
  description  text NOT NULL,
  counterparty text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  -- the entity must live in the same firm as the transaction
  CONSTRAINT fk_bank_transactions_entity_firm FOREIGN KEY (entity_id, firm_id)
    REFERENCES entities(id, firm_id),
  -- composite target so matches can firm-pin a bank transaction
  CONSTRAINT uq_bank_transactions_id_firm UNIQUE (id, firm_id)
);
CREATE INDEX idx_bank_transactions_firm_entity_date
  ON bank_transactions(firm_id, entity_id, date);

-- ---------------------------------------------------------------------------
-- Source documents (invoices / notices expected to match bank activity).
-- amount_minor is the document face amount and is always positive.
-- ---------------------------------------------------------------------------
CREATE TABLE source_documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id      uuid NOT NULL REFERENCES firms(id),
  entity_id    uuid NOT NULL,
  kind         source_doc_kind NOT NULL,
  date         date NOT NULL,
  amount_minor bigint NOT NULL,
  currency     text NOT NULL,
  reference    text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_source_documents_amount_positive CHECK (amount_minor > 0),
  -- the entity must live in the same firm as the document
  CONSTRAINT fk_source_documents_entity_firm FOREIGN KEY (entity_id, firm_id)
    REFERENCES entities(id, firm_id),
  -- composite target so matches can firm-pin a source document
  CONSTRAINT uq_source_documents_id_firm UNIQUE (id, firm_id)
);

-- ---------------------------------------------------------------------------
-- Reconciliation matches (one per bank transaction; ties it to the ledger
-- journal and/or supporting document, with a confidence score and reasons).
-- ---------------------------------------------------------------------------
CREATE TABLE reconciliation_matches (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id             uuid NOT NULL REFERENCES firms(id),
  bank_transaction_id uuid NOT NULL,
  ledger_journal_id   uuid,
  document_id         uuid,
  status              match_status NOT NULL,
  confidence          int NOT NULL, -- 0..100
  reasons             text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_reconciliation_matches_confidence_range CHECK (confidence BETWEEN 0 AND 100),
  -- the bank transaction must live in the same firm as the match
  CONSTRAINT fk_reconciliation_matches_bank_txn_firm FOREIGN KEY (bank_transaction_id, firm_id)
    REFERENCES bank_transactions(id, firm_id),
  -- the supporting document must live in the same firm as the match
  CONSTRAINT fk_reconciliation_matches_document_firm FOREIGN KEY (document_id, firm_id)
    REFERENCES source_documents(id, firm_id),
  -- the ledger journal must live in the same firm as the match (no cross-firm lineage)
  CONSTRAINT fk_reconciliation_matches_journal_firm FOREIGN KEY (ledger_journal_id, firm_id)
    REFERENCES journals(id, firm_id),
  -- one match per bank transaction
  CONSTRAINT uq_reconciliation_matches_bank_transaction UNIQUE (bank_transaction_id)
);

-- ---------------------------------------------------------------------------
-- Reconciliation exceptions (issues surfaced by the matcher). The nullable
-- refs are firm-scoped via firm_id only; no hard FKs so a partially-resolved
-- exception can still point at whatever context it was raised with.
-- ---------------------------------------------------------------------------
CREATE TABLE recon_exceptions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id             uuid NOT NULL REFERENCES firms(id),
  code                recon_exception_code NOT NULL,
  message             text NOT NULL,
  bank_transaction_id uuid,
  ledger_journal_id   uuid,
  document_id         uuid,
  resolved            boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_recon_exceptions_firm ON recon_exceptions(firm_id);

-- ---------------------------------------------------------------------------
-- Row-level security: every table isolated by firm_id.
-- The app sets `SET LOCAL app.current_firm = '<uuid>'` per request/transaction.
-- current_setting(..., true) returns NULL when unset -> default deny.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'bank_transactions','source_documents','reconciliation_matches','recon_exceptions'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format(
      'CREATE POLICY firm_isolation ON %I
         USING (firm_id = current_setting(''app.current_firm'', true)::uuid)
         WITH CHECK (firm_id = current_setting(''app.current_firm'', true)::uuid);', t);
  END LOOP;
END $$;
