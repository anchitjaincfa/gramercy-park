# Gramercy Park — AI-Native Build Plan

This document is the master plan for building Gramercy Park. It describes **what** we are
building, and — just as importantly — **how** we build it: with parallel AI agent teams
orchestrated in phases, and an independent Codex reviewer gating every phase.

Author's stance (channeling the "AI-native" thesis): treat AI agents as a *fleet of engineers*,
not an autocomplete. The human (and the orchestrator agent) act as a **staff engineer + eng
manager**: decompose the work into independently-verifiable units, fan them out to specialized
agents, and impose a hard quality gate (Codex review + tests + typecheck) before anything
merges. The AI writes most of the code; the *system design and the verification bar* are what
make it trustworthy.

---

## 1. The core design tension (and how we resolve it)

Fund administration is a domain where **correctness is adversarial to hype**. The ledger must
balance to the cent; a NAV that is "probably right" is worthless. Yet the product's entire value
proposition is AI automation over messy, unstructured inputs (emails, PDFs, cap tables).

We resolve this with a strict architectural rule that pervades the whole codebase:

> **The deterministic core owns the truth. AI only ever produces _proposals_ against it.**

- The **ledger engine** (`packages/ledger`) is pure, deterministic, and has zero AI in it. It
  enforces double-entry invariants (debits == credits, per-entity balance, immutable posted
  journals). It is tested like a bank ledger: property tests, golden trial balances.
- The **agent layer** (`packages/agents`) reads context and emits typed *proposals*
  (`ProposedJournalEntry`, `ProposedMatch`, `ProposedLpReply`). A proposal carries citations to
  its source evidence and a confidence signal. It **cannot post**.
- A **human-in-the-loop review queue** is the only bridge. An approval turns a proposal into a
  real, deterministic ledger transaction. Every approval is audit-logged with who/when/source.

This is the "AI prepares, expert accountants review" principle, encoded as a type system and a
data-flow constraint rather than a slogan.

---

## 2. The AI-native construction method

### 2.1 Roles

- **Orchestrator (Claude, main loop):** owns the plan, decomposes phases into workstreams,
  spawns agent teams, integrates their output, runs the review gates, and commits.
- **Builder agents (Claude subagents / Workflow fan-out):** each owns one independently-testable
  unit (a package, a schema module, a UI surface, a test suite). They return structured results.
- **Codex reviewer (Codex CLI, `codex exec` / `codex exec review`):** an *independent* model
  reviews each phase's diff for correctness, security, and design before merge. Using a
  different model family for review is deliberate — it reduces correlated blind spots.
- **Verifier agents:** adversarial checkers that try to *break* the accounting invariants and the
  AI proposals (e.g., "find inputs where the NAV engine double-counts").

### 2.2 The per-phase loop

Every phase runs the same disciplined loop:

```
PLAN → (Codex reviews the plan) → FAN-OUT build → INTEGRATE →
  typecheck + tests → (Codex reviews the diff) → fix findings → COMMIT → push
```

1. **Plan the phase.** Orchestrator writes a short phase spec (goals, package boundaries,
   interfaces, test criteria).
2. **Codex reviews the plan.** `codex exec` reads the spec and flags gaps/risks *before* code is
   written. Cheaper to fix a design flaw here than after 20 files exist.
3. **Fan out.** Independent workstreams run in parallel (Workflow tool / parallel subagents).
   Boundaries are chosen so agents don't touch the same files — schema, engine, UI, and tests
   are natural seams.
4. **Integrate & self-verify.** Orchestrator wires the pieces, runs `turbo typecheck test lint`.
5. **Codex reviews the diff.** `codex exec review` audits the actual change set. Findings are
   triaged: correctness/security findings block; style findings are batched.
6. **Fix & commit.** Address blocking findings, then commit to local + push to GitHub. Every
   phase is at least one clean, green, reviewed commit.

### 2.3 Why parallel agent teams (not one big agent)

- **Context economy:** each builder holds only its slice, so it reasons deeply about a small
  surface instead of shallowly about everything.
- **Wall-clock:** independent workstreams finish concurrently.
- **Verification diversity:** finders and refuters with different prompts catch different bugs;
  Codex-as-reviewer adds a cross-model check.

### 2.4 Commit discipline

- Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`).
- Every commit mirrors to **both** the local machine and the public GitHub repo.
- No red commits on `main` at a phase boundary: typecheck + tests must pass.
- Each phase boundary is tagged (`phase-0`, `phase-1`, …) so the build history is legible.

---

## 3. Technical stack

| Concern | Choice | Rationale |
|---|---|---|
| Language | TypeScript (strict) | One language across engine, agents, and both apps |
| Monorepo | Turborepo + npm workspaces | Cached builds, clean package boundaries |
| Web | Next.js (App Router) | Two apps: GP console + LP portal |
| UI | Tailwind + shadcn/ui | Fast, consistent, enterprise-clean design system |
| DB | Postgres (Supabase) | RLS for multi-tenant/LP isolation; matches house stack |
| ORM | Drizzle | Typed schema, SQL-first migrations, no magic |
| Money | integer minor units + `decimal.js` for ratios | Never float for money |
| AI | Anthropic Claude (via `@anthropic-ai/sdk`) | Product agents; structured tool outputs |
| Reviewer | Codex CLI | Independent cross-model review gate |
| Deploy | Vercel | Matches house stack |
| Tests | Vitest + property tests (fast-check) | Ledger invariants demand property testing |

---

## 4. Domain model (the spine)

Core entities the whole system revolves around (detailed in `docs/ARCHITECTURE.md`):

- **Firm** → the management company (tenant root).
- **Entity** → any bookkeeping entity: Fund, Feeder, SPV, Management Company, GP. Every entity
  has its own general ledger.
- **Account** → chart-of-accounts node (asset/liability/equity/income/expense), per entity.
- **Journal** → an atomic, balanced set of **JournalLines** (debits == credits). Immutable once
  posted; corrections are reversing entries.
- **LP (Limited Partner)** → an investor; has one **CapitalAccount** per fund it commits to.
- **Commitment** → an LP's committed capital to a fund.
- **CapitalCall / Distribution** → capital events allocated across LPs pro-rata to commitments.
- **Investment** → a fund's position in a portfolio company (cost, ownership %, valuation).
- **Valuation** → periodic marks that drive NAV.
- **Proposal** → an AI-generated, un-posted suggestion (journal entry, match, reply) awaiting
  review.
- **AuditEvent** → append-only log of every state change.

---

## 5. Phase roadmap

Each phase is a shippable, reviewed increment. Later phases depend on earlier ones.

### Phase 0 — Foundation *(in progress)*
Monorepo scaffold, tooling (TS, ESLint, Prettier, Vitest, Turbo), CI (typecheck+test on PR),
design-system base, seed-data framework, and these planning docs. **Gate:** Codex reviews the
plan + scaffold.

### Phase 1 — Double-entry ledger core *(+ foundational tenancy/audit)*
`packages/db` schema (firms, entities, accounts, **journal batches** for intercompany, journals,
lines) + `packages/ledger` pure deterministic engine: post balanced journals, reject unbalanced
ones, per-entity trial balance, chart-of-accounts helpers. **Ships the foundations Codex flagged
as non-negotiable from day one:** denormalized `firm_id` + RLS on every table, append-only
`audit_events` with a domain-service write wrapper, DB-level immutability/constraint triggers, and
a minimal role model. Property tests for every invariant. **Gate.**

> Phase 2 is split into three smaller gates (Codex: calls + distributions + NAV + fees + 30
> checks is too much for one review).

### Phase 2a — Commitments & capital calls
Share classes, commitments, capital calls with **30+ automated health checks** (commitment
limits, allocation math, recallable capital, LPA constraints, prior-call reconciliation),
largest-remainder allocation. **Gate.**

### Phase 2b — Distributions, fees & capital accounts
Distributions (return of capital / gain / income, recallable), management-fee calc per class, and
the **deterministic capital-account allocation model** reconciling to partners'-capital GL. **Gate.**

### Phase 2c — Valuation, periods & NAV
Accounting periods (open/close/reopen/restate), versioned valuations with mark-to-market
journals, and reproducible **NAV snapshots** with per-LP shares. (Full carry waterfall is a later
gate.) **Gate.**

### Phase 3 — Reconciliation engine
Mock bank-feed ingestion, **three-way matching** (bank ↔ source document ↔ GL), auto-
categorization, and an exception queue with full context. **Gate.**

### Phase 4 — AI agent layer
Claude-powered, propose-only product agents with structured tool outputs and evidence citations:
journal-entry agent (from a bill/email), reconciliation agent, KPI-collection agent, LP-response
agent. The human review queue UI. **Gate.**

### Phase 5 — Portfolio intelligence
Deal-document & cap-table ingestion, KPI collection reconciled across sources, equity-pickup /
ownership tracking, investment-update schedules, portfolio dashboard. **Gate.**

### Phase 6 — LP experience
LP portal: capital-account statements, capital-call/distribution history, **ILPA-style
reporting**, document vault, and an LP Q&A agent grounded in that LP's data (RLS-enforced). **Gate.**

### Phase 7 — Enterprise hardening
**Broadens** the foundations that already shipped in Phase 1 (RLS, audit, role model): full RBAC
with approval thresholds and segregation of duties, multi-entity **consolidation & eliminations**
(a query over journal batches, per the intercompany model), observability, broadened test
coverage, and Vercel deployment. **Gate.**

---

## 6. Definition of done (per phase)

- [ ] Types compile under `strict` (`turbo typecheck`).
- [ ] Unit + property tests pass (`turbo test`); ledger invariants have property coverage.
- [ ] Lint clean (`turbo lint`).
- [ ] Codex review has no unaddressed **blocking** (correctness/security) findings.
- [ ] Seed data exercises the new surface end to end.
- [ ] Docs updated; phase tagged; committed to local **and** pushed to GitHub.

---

## 7. Non-goals (for now)

- Real bank/custodian integrations, real KYC/AML, or real money movement.
- Regulatory certification (SOC 2, audit sign-off). We *model* audit-readiness; we don't claim it.
- Multi-currency FX beyond a single reporting currency (revisit post-Phase 7).
