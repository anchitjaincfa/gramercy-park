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
   minimum-viable RLS/audit/roles into Phase 1; Phase 7 now *broadens* them. (PLAN §5)

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
