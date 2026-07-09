# Gramercy Park — Architecture

This document describes the technical design: the layering, the data model, the money-handling
rules, and the AI proposal/review flow. It is the contract that keeps a probabilistic AI layer
from ever corrupting a deterministic accounting core.

## 1. Layering

```
┌─────────────────────────────────────────────────────────────┐
│  apps/console (GP)          apps/lp-portal (LP)              │  Presentation (Next.js)
├─────────────────────────────────────────────────────────────┤
│  fund-admin   recon   portfolio   lp-reporting              │  Domain services
├─────────────────────────────────────────────────────────────┤
│  agents  ──(proposals only)──►  review queue ──(approve)──┐ │  AI layer (Claude, HITL)
│                                                            │ │
├────────────────────────────────────────────────────────── ▼─┤
│  ledger  (pure, deterministic, no AI, no I/O)               │  Source of truth
├─────────────────────────────────────────────────────────────┤
│  db (Drizzle schema + migrations)   core (types, money)     │  Foundation
└─────────────────────────────────────────────────────────────┘
```

**Dependency rule:** arrows point down. `ledger` never imports `agents`. `agents` never writes
to the ledger; it writes `Proposal` rows. Only an approved proposal, replayed through a domain
service, calls `ledger.post()`.

## 2. The money rule

- **All monetary amounts are stored as integer minor units** (e.g., cents) in a branded
  `Money` type — never JavaScript floats. `core` exposes `Money` helpers (`add`, `sub`,
  `allocate`) that are exact and total-preserving.
- **Ratios and ownership percentages** use `decimal.js`. Pro-rata allocations use the
  *largest-remainder* method so the parts always sum back to the whole (no lost/created cents).
- Every `Money` value carries a currency tag; mixing currencies is a type error.

## 3. Data model

Tenancy root is **Firm**. **Every table carries a denormalized `firm_id`** and is protected by
Postgres RLS from Phase 1 — we never rely on multi-hop joins to enforce isolation. Audit and
immutability constraints also ship in Phase 1, not as later "hardening" (see §7, §9).

### 3.1 Ledger tables (Phase 1)

- `firms(id, name, base_currency, created_at)`
- `entities(id, firm_id, type[fund|feeder|spv|mgmtco|gp], name, base_currency, parent_id?)`
- `accounts(id, firm_id, entity_id, code, name, type[asset|liability|equity|income|expense], normal_side)`
  — unique `(entity_id, code)`.
- `journal_batches(id, firm_id, date, memo, source_type, source_id, status, idempotency_key)` —
  groups one or more **entity-balanced** journals into an atomic, possibly *intercompany*
  transaction. Unique `(firm_id, idempotency_key)`.
- `journals(id, firm_id, batch_id, entity_id, date, memo, status[draft|posted|reversed], posted_at, reversal_of?)`
- `journal_lines(id, firm_id, journal_id, entity_id, account_id, side[debit|credit], amount_minor, currency)`
  — `amount_minor > 0`; `account.entity_id == journal.entity_id`; currency consistent within a line set.

**Intercompany:** a batch may contain journals for different entities (e.g. a management-company
expense paid on behalf of a fund) linked by **due-to/due-from** lines. Each journal is
independently balanced *per entity*; the batch is balanced *per counterparty pair*. This makes
consolidation and eliminations (Phase 7) a query over batches, not a schema migration.

**Invariants** (enforced in the pure `ledger` engine **and** by DB constraints — see §9):
1. For every posted journal, Σ debits == Σ credits **per entity, per currency**.
2. For every intercompany batch, due-to == due-from **per counterparty pair, per currency**.
3. Posted journals/lines are immutable (DB triggers block `UPDATE`/`DELETE`); a correction is a
   new *reversing* journal with `reversal_of` set (unique — a journal is reversed at most once).
4. An account's balance == signed sum of its lines across posted journals.
5. Trial balance for an entity nets to zero.

### 3.2 Fund-admin tables (Phase 2)

- `lps(id, firm_id, name, type, status[active|transferred|inactive], contact)`
- `share_classes(id, firm_id, fund_id, name, mgmt_fee_bps, carry_bps, hurdle_bps?)` — LPs commit
  into a class; allocation rules key off class.
- `commitments(id, firm_id, fund_id, lp_id, class_id, amount_minor, currency, effective_date, recallable_used_minor)`
- `capital_calls(id, firm_id, fund_id, number, call_date, due_date, purpose, total_minor, status)`
- `capital_call_allocations(id, call_id, lp_id, amount_minor, kind[contribution|recall|fee_offset])`
- `distributions(id, firm_id, fund_id, number, date, kind[return_of_capital|gain|income], recallable, total_minor, status)`
- `distribution_allocations(id, distribution_id, lp_id, amount_minor)`
- `mgmt_fee_schedules(id, firm_id, fund_id, class_id, rate_bps, basis[committed|invested|nav], frequency)`

**Capital accounts are an explicit allocation model, not a view (§4.1).** They are rebuilt
deterministically from an ordered event stream (commitment → calls → allocated P&L → fees →
carry → distributions), producing per-LP, per-period balances that always reconcile to the
fund's partners'-capital GL.

### 3.3 Periods, valuation & NAV snapshots (Phase 2)

Historical NAV and LP statements must be **reproducible** even after a backdated journal or a
valuation restatement — so valuations are versioned and NAV is snapshotted, never recomputed
silently.

- `accounting_periods(id, firm_id, entity_id, period[YYYY-MM], status[open|closed|reopened], closed_at)`
  — posting into a closed period is rejected; a restatement reopens, adjusts, and re-closes with
  an audit trail.
- `valuations(id, firm_id, investment_id, as_of, version, fair_value_minor, method, superseded_by?)`
  — new marks create a new version; old versions are retained.
- `nav_snapshots(id, firm_id, fund_id, as_of, valuation_version_set_hash, total_nav_minor, created_at)`
  and `nav_snapshot_lp_shares(snapshot_id, lp_id, nav_share_minor)` — an immutable record of a NAV
  close, tied to the exact valuation versions and posted-journal set that produced it.

### 3.4 Portfolio (Phase 5)

- `portfolio_companies(id, firm_id, name, sector)`
- `investments(id, firm_id, fund_id, company_id, instrument, cost_minor, ownership_bps, round, date)`
  — carrying value lives in the GL; `valuations` (§3.3) supply fair-value marks.
- `kpis(id, firm_id, company_id, period, metric, value, source, confidence)`

### 3.5 Audit (Phase 1) & AI proposals (Phase 4)

- `audit_events(id, firm_id, actor, action, target_type, target_id, before_jsonb, after_jsonb, at)`
  — **append-only** (DB triggers block update/delete). Ships in **Phase 1** so every mutation is
  logged from day one; the golden rule "every mutation writes an audit_event" is enforced by the
  domain-service layer wrapping all writes.
- `proposals` — the AI↔truth safety boundary, so its schema is strict, not a loose blob:
  `id, firm_id, kind, schema_version, payload_jsonb, evidence_jsonb (field→source citations),
   source_hashes[], model, prompt_version, tool_version, proposal_hash, idempotency_key,
   confidence, status[pending|approved|rejected|superseded], created_by_agent, created_at,
   reviewed_by?, reviewer_edits_jsonb?, revalidated_at?, reviewed_at?`.
  On approval the domain service **re-validates** the (possibly reviewer-edited) payload against
  current state and recomputes `proposal_hash` — a stale or tampered proposal cannot post. Unique
  `(firm_id, idempotency_key)` makes approval idempotent.

## 4. NAV & capital-account allocation (Phase 2)

### 4.1 NAV — no double counting

An investment's **carrying value lives in a GL asset account**. A valuation mark does **not** get
added on top of the GL; instead, approving a new `valuations` version posts a **mark-to-market
journal** that adjusts the investment's carrying account to fair value against an unrealized
gain/loss equity account. Therefore:

> **NAV = net assets read purely from the posted GL** (assets − liabilities), *after* the
> mark-to-market journals for the chosen valuation-version set are posted.

There is exactly one source of the investment's value (the GL), so the earlier "fair value +
GL assets" double-count is designed out. `nav_snapshots` records which valuation versions and
posted-journal set produced a given NAV, so it is reproducible.

### 4.2 Per-LP allocation model

The capital account is rebuilt from an **ordered, deterministic event stream** per LP:

```
opening + contributions − return-of-capital
  + allocated P&L (pro-rata to class ownership of the period)
  − mgmt fees (per class schedule)  − carry (per class, hurdle-aware; full waterfall = later gate)
  − income/gain distributions
= closing capital-account balance;  Σ over LPs == fund partners'-capital GL
```

Allocation rules are explicit and total-preserving: pro-rata **by class** ownership; the
**largest-remainder** method with a deterministic tie-break (lowest `lp_id` first) so cents never
appear or vanish; zero/negative allocations and `inactive`/`transferred` LPs handled explicitly;
property tests prove Σ parts == whole for every event. AI never supplies a NAV or an allocation —
only proposed *inputs* (e.g., a valuation mark) that a human approves.

## 5. AI proposal flow (Phase 4)

```
source (email/PDF/cap table)
   │  ingest + parse (structured extraction, Claude tool-use)
   ▼
Agent produces Proposal{ kind, payload, evidence[citations], confidence }
   │  written to `proposals` (status=pending). CANNOT post to ledger.
   ▼
Review queue UI  ── expert edits/approves/rejects ──►
   │  on approve: domain service RE-VALIDATES payload vs current state,
   │  recomputes proposal_hash, then calls ledger.post()
   ▼
posted journal (immutable)  +  audit_event(approved)
```

**Document filing is a proposal too.** The evidence-collection agent does not silently "auto-file"
documents — a mis-classification would poison later reviews. Filing a document against an
entity/period is itself a `proposal` (kind=`document_filing`) that a human confirms.

Agents are defined declaratively (`packages/agents`): each has a name, an input schema, a
Claude tool/output schema, and a pure `toProposal()` mapper. This keeps them testable with
recorded fixtures and swappable models.

## 6. Health checks (Phase 2)

Capital calls run a pipeline of composable `Check` functions (target: 30+), each returning
pass/warn/fail with a message and references. Examples: call ≤ uncalled commitment per LP;
allocations sum to call total; recycle/recall within LPA limits; due date ≥ notice period;
prior call fully reconciled; no negative capital account; management-fee offset applied. The set
is data-driven so checks are unit-tested in isolation.

## 7. Security & tenancy (from Phase 1)

RLS, a minimal role model, and audit are **foundational, not Phase-7 hardening** — they shape the
schema and service APIs, so their minimum-viable form ships with the first schema.

- Postgres **RLS** on the denormalized `firm_id` of every table (Phase 1); LP portal adds a
  second predicate restricting to the authenticated LP's rows (Phase 6).
- Role model `owner | accountant | reviewer | read_only | lp` exists from Phase 1; richer RBAC
  (approval thresholds, segregation of duties) is broadened in Phase 7.
- All mutations go through **domain services** (§9) that write an `audit_event` in the same DB
  transaction as the change.

## 8. Engine vs. service split (§ referenced throughout)

Two distinct layers, deliberately separated:

- **`packages/ledger` — pure engine.** No DB, no I/O, no time, no randomness. Validates and
  computes (balancing, trial balance, allocation math). Trivially property-testable.
- **domain services (in `fund-admin`, `recon`, …) — transactional layer.** Own DB
  transactionality, `audit_event` writes, authorization, idempotency keys, and proposal
  re-validation. Only this layer persists; it calls the pure engine to compute what to persist.

## 9. Invariants enforced at two levels

Every money/ledger invariant is enforced **both** in TypeScript (the pure engine) **and** by the
database, so a bad write can't slip through a bug in app code:

- `CHECK amount_minor > 0`; currency consistency within a journal.
- `account.entity_id == journal.entity_id` (trigger/constraint).
- Unique `(entity_id, account.code)`; unique `(firm_id, idempotency_key)`.
- Unique `reversal_of` (a journal is reversed at most once).
- Triggers block `UPDATE`/`DELETE` on posted journals/lines and on `audit_events` (append-only).
- Posting into a `closed` accounting period is rejected.

## 10. Testing strategy

- **`core`/`ledger`:** property tests (fast-check) for money math and double-entry invariants;
  golden trial balances; "Σ allocated parts == whole" for every allocator.
- **`fund-admin`:** scenario tests (seed a fund, call capital, mark, distribute; assert capital
  accounts, NAV snapshot reproducibility across a valuation restatement).
- **`agents`:** fixture-replay tests (recorded model outputs → deterministic proposal mapping);
  no live API calls in CI.
- **Security:** adversarial tests proving **cross-LP and cross-firm data cannot be retrieved**
  (RLS + LP Q&A grounding) and **prompt-injection** in ingested documents cannot escalate an
  agent beyond producing a reviewable proposal.
- **apps:** smoke/e2e on critical flows.
