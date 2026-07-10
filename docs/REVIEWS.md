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

---

## Gate 2a.1 — Phase 2a (commitments & capital calls)

**Built by 3 parallel builder agents** (db schema ∥ fund-admin core ∥ 34 health checks), integrated by
the orchestrator. **Reviewer:** `codex exec` (read-only) on the integrated diff.

**7 confirmed bugs → resolution:**

1. `NUMBER_SEQUENTIAL` allowed gaps (only checked `> maxPrior`). → **Fixed:** requires `maxPrior + 1`.
2. `commitments.class_id` firm-pinned but not **fund**-pinned (a commitment could reference a
   share class from another fund in the same firm). → **Fixed:** composite FK
   `(class_id, fund_id, firm_id) → share_classes(id, fund_id, firm_id)`.
3. `buildCapitalCallBatch` could emit an empty journal for a recall-only call (ledger rejects it).
   → **Fixed:** throws if there are no contribution lines to post.
4. Checks and ledger builder disagreed on `totalMinor` for mixed-kind calls. → **Fixed:** defined
   `totalMinor` = total **contributions**; `ALLOC_SUM_EQUALS_TOTAL` now sums contributions, matching
   what the builder posts.
5. `NO_OVERCALL_CUMULATIVE` missed LPs already over-called but omitted from this call. → **Fixed:**
   iterates every committed LP, not just current contributors.
6. `ALLOC_PROPORTIONS_TRACK_COMMITMENT` ignored omitted LPs. → **Fixed:** denominator spans all
   active committed LPs, so an omitted pro-rata LP surfaces as a deviation warning.
7. Allocation tie-break was input-order, not canonical. → **Fixed:** allocate in ascending `lpId`
   order so the leftover cent deterministically goes to the lowest `lpId` (regression test added).

**Suggestions adopted:** positive/non-negative guards in `allocateCapitalCall`; `NOT NULL` on
`call_date`/`due_date`/`purpose`/`effective_date`; schema mirrors the new composite uniques.

**Verdict:** 45/45 tests pass, typecheck clean. Merged; Phase 2a complete.

---

## Gate 2b.1 — Phase 2b (distributions, fees & capital accounts)

**Built by 4 parallel builder agents** (db schema ∥ distributions ∥ management fees ∥
capital-account model), integrated by the orchestrator. **Reviewer:** `codex exec` (read-only).

**4 confirmed bugs → resolution:**

1. `computeMgmtFee` returned bucket 0 every call, so billing N periods overcharged by the
   crumb (annual 1¢ quarterly → 1¢ × 4). → **Fixed:** added `periodMgmtFees` (full schedule) and a
   `periodIndex` param; billing all periods now sums to the exact annual fee.
2. `buildDistributionBatch` could under-post — it posted the allocations regardless of
   `dist.totalMinor`. → **Fixed:** requires positive allocations summing exactly to `totalMinor`.
3. Capital-account arithmetic used plain `number` add and only `isInteger`, so values past
   `MAX_SAFE_INTEGER` silently lost cents. → **Fixed:** `isSafeInteger` validation + `checkedAdd`
   that throws on overflow.
4. Capital-account output `Map` order depended on input event order. → **Fixed:** lpIds sorted
   ascending for canonical iteration order.

**Suggestions adopted:** reject duplicate `lpId`s in `allocateDistribution` / `computeMgmtFeePerLp`;
guard `cashAccountId !== capitalAccountId` in both the distribution **and** capital-call builders.

**Verdict:** 91/91 tests pass, typecheck clean. Merged; Phase 2b complete.

---

## Gate 2c.1 — Phase 2c (valuation, periods & NAV)

**Built by 4 parallel builder agents** (db schema ∥ valuation MTM ∥ NAV ∥ accounting periods).
**Reviewer:** `codex exec` (read-only).

**4 confirmed bugs → resolution:**

1. `computeNavPerLp` returned `[]` when NAV > 0 but every LP balance ≤ 0 → an unreconciled
   snapshot (shares sum to 0, not NAV). → **Fixed:** throws in that case (0 NAV still returns `[]`).
2. `valuations.superseded_by` was an unconstrained UUID — could point cross-firm or at nothing.
   → **Fixed:** composite FK `(superseded_by, firm_id) → valuations(id, firm_id)` (+ `uq` target).
3. `periodKeyOf` validated only the substring before `T`, so `2026-03-15Tgarbage` passed. →
   **Fixed:** validates the whole string (date + well-formed optional time suffix).
4. Valuation MTM used `isInteger`, not `isSafeInteger`. → **Fixed:** safe-integer guard +
   non-negative fair-value guard.

**Suggestions adopted:** DB `CHECK`s for `period` format, `version > 0`, non-negative fair value;
documented the deficit-LP forfeiture policy in NAV allocation.

**Verdict:** 132/132 tests pass, typecheck clean. Merged; **Phase 2 complete**.

---

## Gate 3.1 — Phase 3 (reconciliation engine)

**Built by 3 parallel builder agents** (three-way matching ∥ auto-categorization ∥ recon db schema).
**Reviewer:** `codex exec` (read-only).

**5 confirmed bugs → resolution:**

1. `reconcile` ignored `firmId`/`entityId` when picking candidates → cross-firm/entity false
   matches. → **Fixed:** candidates scoped to the bank txn's firm + entity.
2. Greedy closest-date matching isn't a guaranteed _maximum_ matching. → **Documented** as a
   deliberate heuristic (unmatched items surface as human-reviewed exceptions); optimal bipartite
   assignment noted as future work.
3. A same-amount document in the wrong currency was reported as `MISSING_DOCUMENT`. → **Fixed:**
   now surfaced as `CURRENCY_MISMATCH`.
4. `autoCategorizationRate` counted `uncategorized` rows when threshold ≤ 0.1. → **Fixed:** only
   rule-matched rows count.
5. Keyword matching used raw substring search ("wholesale rebate" → `investment_sale`). → **Fixed:**
   word-boundary matching.

**Verdict:** 167/167 tests pass, typecheck clean. Merged; Phase 3 complete.

---

## Gate 4.1 — Phase 4 part 1 (journal-entry agent + review-queue boundary)

**Reviewer:** `codex exec` (read-only). The AI↔ledger safety boundary, reviewed hardest.

**Codex confirmed the core property:** there is **no propose-to-ledger bypass** — an agent only
returns a `Proposal`; only `approveJournalEntry` produces a `BatchInput`, and it re-validates via
the ledger's `validateBatch`, so an unbalanced/tampered proposal can't become a valid batch.

**3 confirmed hardening bugs → resolution:**

1. Audit model metadata could drift (stamped a default, not the model actually used). → **Fixed:**
   the proposer returns the real model; the agent stamps that.
2. Approval lacked a runtime kind/schema gate (trusted the TS type). → **Fixed:** rejects a
   wrong `kind` or unknown `schemaVersion` with `INVALID_PROPOSAL`.
3. A malformed/reviewer-edited payload could throw (missing lines, blank currency). → **Fixed:**
   payload shape guarded → typed `MALFORMED_PAYLOAD` rejection.

**Suggestions adopted:** reject duplicate account codes; `disable_parallel_tool_use: true` + assert
exactly one tool call. Model id `claude-opus-4-8`, forced strict `tool_choice`, and stamped-by-us
trust metadata all verified sound.

**Verdict:** 8/8 tests pass (fixture-replay, no live API), typecheck clean. Merged. The live path
runs against the real Claude API via `npm run -w @gramercy/agents demo` (needs `ANTHROPIC_API_KEY`).
Three more agents (reconciliation, KPI, LP-response) remain for Phase 4.

---

## Gate 4.2 — Phase 4 remainder (reconciliation, KPI, LP-response agents)

**Built by 3 parallel builder agents**, integrated by the orchestrator. **Reviewer:** `codex exec`.

**Codex confirmed** all three are cleanly propose-only (no DB/ledger/send/post imports), strict tool
schemas are well-formed, exactly-one-tool-use is enforced, and `disable_parallel_tool_use` is set.

**2 confirmed issues → resolution:**

1. Correctness relied on `strict:true`, which the pinned SDK type doesn't formally carry. → **Fixed:**
   added runtime payload-shape guards in every agent wrapper, so a malformed model output throws
   instead of producing a junk proposal — correctness no longer depends on `strict`.
2. LP tenant grounding was prompt-only, not enforced. → **Fixed:** `proposeLpReply` now **enforces**
   `payload.lpId === ctx.lpId` and throws on a cross-LP mismatch (regression test added).

**Suggestions adopted:** stamp `response.model` (the resolved id) rather than the requested param,
across all four proposers.

**Verdict:** 20/20 agent tests pass (187 total), typecheck clean. Merged; **Phase 4 complete** —
four Claude-powered, propose-only product agents behind a human-review boundary.

---

## Gate 5.1 — Phase 5 (portfolio intelligence)

**Built by 3 parallel builder agents** (portfolio db ∥ equity-pickup math ∥ KPI collection).
**Reviewer:** `codex exec` (read-only).

**4 confirmed bugs → resolution:**

1. `moicBpsExact` lost precision converting a large `BigInt` back to `number`. → **Fixed:** guards
   the result is a safe integer, throws otherwise.
2. `rollupPortfolio` totals could silently lose minor units past `MAX_SAFE_INTEGER`. → **Fixed:**
   `checkedAdd` throws on overflow.
3. Investments without a valuation were silently skipped (totals looked complete) and skipped
   before the currency check. → **Fixed:** currency validated for every investment first; skipped
   ids surfaced in `missingValuations`.
4. KPI `latestValue` was order-dependent on duplicate (source, asOf) records, and `toEpochDay`
   accepted garbage time suffixes. → **Fixed:** complete tie-break (asOf → source → value);
   full-string date validation.

**Suggestion adopted (important):** the group key used **NUL-byte** delimiters, which made git treat
`kpi-store.ts` as **binary** — replaced with a JSON-encoded tuple key.

**Verdict:** 26/26 portfolio tests pass, 213 total, typecheck clean. Merged; Phase 5 complete.

---

## Gate 6.1 — Phase 6 (GP console + LP portal Next.js apps)

**Built by 2 parallel builder agents** (one per app). Both `next build` clean (console 9 routes, LP
portal 9 routes), rendering figures computed by the real engine. **Reviewer:** `codex exec`.

**Codex confirmed:** engine calls are genuine (console: `allocateCapitalCall`, `runChecks`,
`buildCapitalAccounts`, `computeNav`/`computeNavPerLp`, `rollupPortfolio`; LP portal:
`computeMgmtFee`, `capitalAccountBalance`, `buildCapitalAccounts`); review-queue is presented as
propose-only/human-reviewed with no posting handler; money formatters divide minor units correctly;
LP portal shows a single LP's data.

**Confirmed issues → resolution:**

1. NAV inconsistency from a cents-literal bug (`420_000_00` = $420k, not $4.2M), making computed NAV
   disagree with the portfolio rollup. → **Fixed:** `4_200_000_00`; computed NAV now reconciles.
2. A pending reconciliation proposal was also shown already `matched` — undermining the propose-only
   boundary. → **Fixed:** that row is now an `exception` "AI-proposed match awaiting review".
3. Seed money derived with float `Math.round` (violates the no-floats golden rule). → **Fixed:**
   uses the engine's `allocate` / `applyBps` instead.

**Deferred (low-risk):** the review-queue page casts `unknown` proposal payloads by `kind` — the seed
constants are typed, so no runtime risk; a discriminated-union render is a future cleanup.

**Verdict:** both apps `tsc` + `next build` clean; 213 tests + 2 app typechecks green. Merged;
Phase 6 complete — the platform now has a visible, deployable UI.
