# Review Log

An append-only record of the independent **Codex** review gate at each planning/build step.
Every phase is reviewed by Codex (a different model family from the Claude builders) before it
merges — see `docs/PLAN.md` §2.

---

## Gate 0.1 — Plan & architecture review (pre-build)

**Reviewer:** `codex exec` (Codex CLI 0.143.0), read-only sandbox.
**Scope:** `README.md`, `docs/PLAN.md`, `docs/ARCHITECTURE.md`, `docs/PRODUCT.md`, `AGENTS.md`.

**Blocking findings raised → resolution:**

1. **NAV double-counting** (fair value + GL assets counted the same position twice) → **Fixed.**
   Redesigned so an investment's value lives only in the GL; valuation marks post a
   mark-to-market journal. NAV is now read purely from the posted GL. (ARCH §4.1)
2. **Per-LP NAV allocation underspecified** → **Fixed.** Added an explicit capital-account
   allocation model (share classes, ordered event stream, largest-remainder with deterministic
   tie-break, inactive/transferred LP handling, reconciles to GL). (ARCH §3.2, §4.2)
3. **Single-entity journals can't do intercompany/consolidation** → **Fixed.** Added
   `journal_batches` (multiple entity-balanced journals, due-to/due-from) in Phase 1, not 7.
   (ARCH §3.1)
4. **Tenancy/RLS inconsistent** (join-based isolation) → **Fixed.** Denormalized `firm_id` on
   every table + RLS from Phase 1. (ARCH §3, §7)
5. **Audit deferred to Phase 4/7 contradicts the golden rule** → **Fixed.** `audit_events`
   (append-only) + domain-service write wrapper ship in Phase 1. (ARCH §3.5, §7)
6. **`proposals.payload_jsonb` too loose for the safety boundary** → **Fixed.** Hardened schema:
   schema_version, source hashes, model/prompt/tool metadata, proposal_hash, idempotency_key,
   reviewer edits, approval-time re-validation. (ARCH §3.5)
7. **No accounting periods / close / valuation versioning / NAV snapshots** → **Fixed.** Added
   periods (open/close/reopen/restate), versioned valuations, immutable NAV snapshots. (ARCH §3.3)
8. **Phase 7 contained foundational concerns (RBAC/RLS/audit/consolidation)** → **Fixed.** Pulled
   minimum-viable RLS/audit/roles into Phase 1; Phase 7 now _broadens_ them. (PLAN §5)

**Suggestions adopted:** split Phase 2 into 2a/2b/2c; DB-level constraints alongside TS
invariants (ARCH §9); pure `ledger` engine vs. transactional service layer (ARCH §8); explicit
allocation semantics; document-filing treated as a proposal (ARCH §5); adversarial
tenant-leak/prompt-injection tests (ARCH §10).

**Verdict:** all blocking findings resolved in docs. Cleared to scaffold and begin Phase 1.

---

## Gate 1.1 — `packages/core` money foundation

**Reviewer:** `codex exec` (read-only). **Scope:** `packages/core` (money.ts, result.ts, index.ts, tests).

**Confirmed correctness bugs → resolution:**

1. **Unsafe integers accepted** — `Number.isInteger(2**53)` is `true`, but arithmetic past
   `MAX_SAFE_INTEGER` silently loses cents, which could make `allocate()` fail to preserve a
   total. → **Fixed.** `money()` now requires `Number.isSafeInteger`; since every operation funnels
   through `money()`, any overflowing result is rejected (throws) rather than silently corrupting.
   Regression tests added.
2. **Structural `Money` bypassed the constructor** — an object literal `{ amount: 1.5, currency }`
   satisfied the interface. → **Fixed.** `Money` is now a phantom-branded type; only `money()` can
   mint one.

**Suggestions adopted:** `allocate`/`applyBps` accept `Decimal.Value` (number|string|Decimal) so
callers can pass exact weights and avoid float precision affecting tie-breaks; `applyBps` validates
finite bps; added boundary tests around `MAX_SAFE_INTEGER`, overflow rejection, and exact weights.

**Verdict:** 15/15 tests pass (incl. fast-check property tests), typecheck clean. Merged.

---

## Gate 1.2 — `packages/ledger` engine + `packages/db` schema/migration

**Reviewer:** `codex exec` (read-only), two passes (review + adversarial re-verify).

**Pass 1 — 7 confirmed findings → resolution:**

1. DB accepted posting an unbalanced/empty/mixed-currency journal on `draft→posted` (no check). →
   **Fixed.** Added `validate_journal_on_post` trigger enforcing non-empty, single-currency,
   ≥1 debit & ≥1 credit, and debits==credits at the DB level.
2. Posted journals accepted **new** lines (trigger only on UPDATE/DELETE). → **Fixed.** Line
   trigger now also fires `BEFORE INSERT`.
3. A line could be moved **into** a posted journal (UPDATE checked OLD only). → **Fixed.** UPDATE
   now checks both OLD and NEW parent journal status.
4. Composite FKs didn't pin `firm_id` → cross-firm linking possible. → **Fixed.** FKs across
   `entities → accounts → journals → journal_lines` now include `firm_id`.
5. Batch check was tautological, not the true intercompany invariant. → **Fixed (honestly).**
   Reworded code + docs; counterparty-pair netting deferred to Phase 7 (needs counterparty tags).
6. Self-canceling no-op journals accepted by the engine. → **Fixed.** `NO_OP_JOURNAL` check +
   runtime `INVALID_SIDE` guard for untyped input.
7. `audit_events` (and posted tables) not protected against `TRUNCATE`. → **Fixed.** Statement-level
   `BEFORE TRUNCATE` guards added.

**Pass 2 (adversarial re-verify) — 3 further findings → resolution:**

1. **Concurrency race:** a concurrent line write during posting could yield a posted-unbalanced
   journal (Read Committed visibility). → **Fixed.** Line trigger takes `FOR NO KEY UPDATE` on the
   parent journal, serializing against the post.
2. Self-references (`entities.parent_id`, `journals.reversal_of`) weren't firm-scoped. → **Fixed.**
   Composite FKs added (+ `uq_journals_id_firm`).
3. No-op rejection was TS-only. → **Fixed.** DB post trigger now also rejects economic no-ops.

**Not yet done:** the migration is reviewed for PG15 syntax but **not yet executed against a live
Postgres** (no local PG/Docker in the build env). It will be validated on Supabase in Phase 2c.

**Verdict:** 27/27 tests pass, typecheck clean. Merged; Phase 1 complete.
