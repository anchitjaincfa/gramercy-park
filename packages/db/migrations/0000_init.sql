-- Gramercy Park — Phase 1 initial migration.
-- Ledger core + foundational tenancy (RLS) and audit. Invariants are enforced
-- here at the DB level in addition to the pure TypeScript engine, so a bug in
-- app code cannot post an unbalanced/tampered row. See docs/ARCHITECTURE.md §9.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
CREATE TYPE entity_type   AS ENUM ('fund', 'feeder', 'spv', 'mgmtco', 'gp');
CREATE TYPE account_type  AS ENUM ('asset', 'liability', 'equity', 'income', 'expense');
CREATE TYPE line_side     AS ENUM ('debit', 'credit');
CREATE TYPE batch_status  AS ENUM ('draft', 'posted', 'reversed');
CREATE TYPE journal_status AS ENUM ('draft', 'posted', 'reversed');
CREATE TYPE role_type     AS ENUM ('owner', 'accountant', 'reviewer', 'read_only', 'lp');

-- ---------------------------------------------------------------------------
-- Tenancy root
-- ---------------------------------------------------------------------------
CREATE TABLE firms (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  base_currency text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id    uuid NOT NULL REFERENCES firms(id),
  user_id    uuid NOT NULL,
  role       role_type NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_membership_user_firm UNIQUE (firm_id, user_id)
);

CREATE TABLE entities (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id       uuid NOT NULL REFERENCES firms(id),
  type          entity_type NOT NULL,
  name          text NOT NULL,
  base_currency text NOT NULL,
  parent_id     uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- composite key target so downstream FKs can pin (id, firm) pairs
  CONSTRAINT uq_entities_id_firm UNIQUE (id, firm_id),
  -- a parent entity must belong to the same firm
  CONSTRAINT fk_entities_parent_firm FOREIGN KEY (parent_id, firm_id)
    REFERENCES entities(id, firm_id)
);
CREATE INDEX idx_entities_firm ON entities(firm_id);

CREATE TABLE accounts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id    uuid NOT NULL REFERENCES firms(id),
  entity_id  uuid NOT NULL,
  code       text NOT NULL,
  name       text NOT NULL,
  type       account_type NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_accounts_entity_code UNIQUE (entity_id, code),
  -- account's entity must live in the same firm as the account
  CONSTRAINT fk_accounts_entity_firm FOREIGN KEY (entity_id, firm_id)
    REFERENCES entities(id, firm_id),
  -- composite target so a line can prove account.(entity, firm) == line.(entity, firm)
  CONSTRAINT uq_accounts_id_entity_firm UNIQUE (id, entity_id, firm_id)
);

CREATE TABLE journal_batches (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id         uuid NOT NULL REFERENCES firms(id),
  date            date NOT NULL,
  memo            text NOT NULL,
  source_type     text NOT NULL,
  source_id       text NOT NULL,
  idempotency_key text NOT NULL,
  status          batch_status NOT NULL DEFAULT 'draft',
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_batch_firm_idempotency UNIQUE (firm_id, idempotency_key),
  CONSTRAINT uq_batches_id_firm UNIQUE (id, firm_id)
);

CREATE TABLE journals (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id     uuid NOT NULL REFERENCES firms(id),
  batch_id    uuid NOT NULL,
  entity_id   uuid NOT NULL,
  date        date NOT NULL,
  memo        text NOT NULL,
  status      journal_status NOT NULL DEFAULT 'draft',
  posted_at   timestamptz,
  reversal_of uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- a journal is reversed at most once
  CONSTRAINT uq_journals_reversal_of UNIQUE (reversal_of),
  -- batch and entity must be in the same firm as the journal
  CONSTRAINT fk_journals_batch_firm FOREIGN KEY (batch_id, firm_id)
    REFERENCES journal_batches(id, firm_id),
  CONSTRAINT fk_journals_entity_firm FOREIGN KEY (entity_id, firm_id)
    REFERENCES entities(id, firm_id),
  -- a reversing journal must reverse one in the same firm
  CONSTRAINT fk_journals_reversal_firm FOREIGN KEY (reversal_of, firm_id)
    REFERENCES journals(id, firm_id),
  -- composite targets so children can pin (id, firm) and (id, entity, firm)
  CONSTRAINT uq_journals_id_firm UNIQUE (id, firm_id),
  CONSTRAINT uq_journals_id_entity_firm UNIQUE (id, entity_id, firm_id)
);
CREATE INDEX idx_journals_entity ON journals(entity_id);

CREATE TABLE journal_lines (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id      uuid NOT NULL REFERENCES firms(id),
  journal_id   uuid NOT NULL,
  entity_id    uuid NOT NULL,
  account_id   uuid NOT NULL,
  side         line_side NOT NULL,
  amount_minor bigint NOT NULL,
  currency     text NOT NULL,
  CONSTRAINT ck_amount_positive CHECK (amount_minor > 0),
  -- line.(entity, firm) must equal the journal's AND the account's (entity, firm),
  -- which transitively forces line.firm == journal.firm == account.firm == entity.firm
  CONSTRAINT fk_line_journal FOREIGN KEY (journal_id, entity_id, firm_id)
    REFERENCES journals(id, entity_id, firm_id),
  CONSTRAINT fk_line_account FOREIGN KEY (account_id, entity_id, firm_id)
    REFERENCES accounts(id, entity_id, firm_id)
);
CREATE INDEX idx_lines_journal ON journal_lines(journal_id);
CREATE INDEX idx_lines_account ON journal_lines(account_id);

CREATE TABLE audit_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id     uuid NOT NULL REFERENCES firms(id),
  actor       text NOT NULL,
  action      text NOT NULL,
  target_type text NOT NULL,
  target_id   text NOT NULL,
  before      jsonb,
  after       jsonb,
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_firm ON audit_events(firm_id);

-- ---------------------------------------------------------------------------
-- Immutability: posted journals & lines cannot change; audit is append-only.
-- (Trigger names are chosen so the immutability check fires before the
--  post-time validation, since Postgres fires per-row BEFORE triggers in
--  alphabetical order.)
-- ---------------------------------------------------------------------------
CREATE FUNCTION block_posted_journal_mutation() RETURNS trigger AS $$
BEGIN
  IF (TG_OP = 'DELETE') THEN
    IF OLD.status = 'posted' THEN
      RAISE EXCEPTION 'posted journals are immutable (delete blocked)';
    END IF;
    RETURN OLD;
  ELSE
    IF OLD.status = 'posted' THEN
      RAISE EXCEPTION 'posted journals are immutable (update blocked)';
    END IF;
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_journals_a_immutable
  BEFORE UPDATE OR DELETE ON journals
  FOR EACH ROW EXECUTE FUNCTION block_posted_journal_mutation();

-- Enforce the double-entry balance AT THE DB LEVEL when a journal is posted, so a
-- bug in app code can never post an empty, mixed-currency, or unbalanced journal.
CREATE FUNCTION validate_journal_on_post() RETURNS trigger AS $$
DECLARE
  n_lines int; n_cur int; n_debit int; n_credit int; deb bigint; cred bigint;
BEGIN
  IF NEW.status = 'posted' AND OLD.status <> 'posted' THEN
    SELECT
      count(*),
      count(DISTINCT currency),
      count(*) FILTER (WHERE side = 'debit'),
      count(*) FILTER (WHERE side = 'credit'),
      COALESCE(sum(amount_minor) FILTER (WHERE side = 'debit'), 0),
      COALESCE(sum(amount_minor) FILTER (WHERE side = 'credit'), 0)
      INTO n_lines, n_cur, n_debit, n_credit, deb, cred
      FROM journal_lines WHERE journal_id = NEW.id;

    IF n_lines = 0 THEN
      RAISE EXCEPTION 'cannot post empty journal %', NEW.id;
    END IF;
    IF n_cur <> 1 THEN
      RAISE EXCEPTION 'journal % must be a single currency to post (found % currencies)', NEW.id, n_cur;
    END IF;
    IF n_debit = 0 OR n_credit = 0 THEN
      RAISE EXCEPTION 'journal % must have at least one debit and one credit', NEW.id;
    END IF;
    IF deb <> cred THEN
      RAISE EXCEPTION 'journal % is unbalanced: debits % != credits %', NEW.id, deb, cred;
    END IF;
    -- DB-level parity with the TS engine: reject an economic no-op where every
    -- account nets to zero (e.g. debit Cash / credit Cash).
    IF (SELECT bool_and(net = 0) FROM (
          SELECT sum(CASE WHEN side = 'debit' THEN amount_minor ELSE -amount_minor END) AS net
          FROM journal_lines WHERE journal_id = NEW.id GROUP BY account_id) s) THEN
      RAISE EXCEPTION 'journal % has no net effect (every account nets to zero)', NEW.id;
    END IF;

    NEW.posted_at := COALESCE(NEW.posted_at, now());
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_journals_b_validate_post
  BEFORE UPDATE ON journals
  FOR EACH ROW EXECUTE FUNCTION validate_journal_on_post();

-- Lines are immutable once their journal is posted — for INSERT, UPDATE, and
-- DELETE. UPDATE checks BOTH the old and the new journal, so a line cannot be
-- moved into (or out of) a posted journal.
-- The `FOR NO KEY UPDATE` locks below serialize against a concurrent post: if
-- Tx A is posting journal J (its UPDATE holds a row lock on J), a concurrent
-- Tx B mutating J's lines blocks here until A commits, then re-reads J as
-- 'posted' and is rejected — closing the "post an unbalanced journal via a
-- concurrent line write" race.
CREATE FUNCTION block_posted_line_mutation() RETURNS trigger AS $$
DECLARE st_old journal_status; st_new journal_status;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT status INTO st_new FROM journals WHERE id = NEW.journal_id FOR NO KEY UPDATE;
    IF st_new = 'posted' THEN
      RAISE EXCEPTION 'cannot add lines to a posted journal %', NEW.journal_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT status INTO st_old FROM journals WHERE id = OLD.journal_id FOR NO KEY UPDATE;
    IF st_old = 'posted' THEN
      RAISE EXCEPTION 'lines of a posted journal are immutable (delete blocked)';
    END IF;
    RETURN OLD;
  ELSE
    SELECT status INTO st_old FROM journals WHERE id = OLD.journal_id FOR NO KEY UPDATE;
    SELECT status INTO st_new FROM journals WHERE id = NEW.journal_id FOR NO KEY UPDATE;
    IF st_old = 'posted' OR st_new = 'posted' THEN
      RAISE EXCEPTION 'lines of a posted journal are immutable (update blocked)';
    END IF;
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_lines_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION block_posted_line_mutation();

CREATE FUNCTION block_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_append_only
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION block_audit_mutation();

-- TRUNCATE bypasses row-level triggers, so guard the immutable tables at the
-- statement level too.
CREATE FUNCTION block_truncate() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'TRUNCATE is not allowed on %', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_no_truncate    BEFORE TRUNCATE ON audit_events  FOR EACH STATEMENT EXECUTE FUNCTION block_truncate();
CREATE TRIGGER trg_journals_no_truncate BEFORE TRUNCATE ON journals      FOR EACH STATEMENT EXECUTE FUNCTION block_truncate();
CREATE TRIGGER trg_lines_no_truncate    BEFORE TRUNCATE ON journal_lines FOR EACH STATEMENT EXECUTE FUNCTION block_truncate();

-- ---------------------------------------------------------------------------
-- Row-level security: every table isolated by firm_id.
-- The app sets `SET LOCAL app.current_firm = '<uuid>'` per request/transaction.
-- current_setting(..., true) returns NULL when unset -> default deny.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'firms','memberships','entities','accounts','journal_batches',
    'journals','journal_lines','audit_events'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
  END LOOP;
END $$;

-- firms keys on id (it has no firm_id column); all others key on firm_id.
CREATE POLICY firm_isolation ON firms
  USING (id = current_setting('app.current_firm', true)::uuid)
  WITH CHECK (id = current_setting('app.current_firm', true)::uuid);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'memberships','entities','accounts','journal_batches',
    'journals','journal_lines','audit_events'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY firm_isolation ON %I
         USING (firm_id = current_setting(''app.current_firm'', true)::uuid)
         WITH CHECK (firm_id = current_setting(''app.current_firm'', true)::uuid);', t);
  END LOOP;
END $$;
