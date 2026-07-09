# AGENTS.md

Conventions for AI agents (Claude builders, Codex reviewer) and humans working in this repo.

## Golden rules

1. **The ledger is the source of truth and is deterministic.** No AI, no I/O, no randomness in
   `packages/ledger`. It only computes.
2. **AI produces proposals, never posts.** Anything AI-generated is a `Proposal` row awaiting
   human review. Approval — through a domain service — is the only path to a posted journal.
3. **Never use floats for money.** Integer minor units via the `Money` type in `packages/core`.
   Ratios use `decimal.js`; allocations use the largest-remainder method (parts sum to the whole).
4. **Every mutation writes an `audit_event`.**
5. **Respect package boundaries.** Dependencies point downward (see `docs/ARCHITECTURE.md`).
   `ledger` never imports `agents`; apps never import raw db, only domain services.

## Build & verify

```bash
npm install
npm run typecheck   # tsc --strict across the monorepo
npm run test        # vitest (unit + property tests)
npm run lint
npm run format:check
```

A change is not done until typecheck + tests pass and Codex review has no unaddressed blocking
findings. See `docs/PLAN.md` §2 for the per-phase loop and §6 for the definition of done.

## Codex review gate

Codex is the independent reviewer at every phase boundary:

```bash
codex exec review            # review the working diff
codex exec "review docs/PLAN.md for design risks before we build"
```

Correctness and security findings block a merge; style findings are batched.

## Commit conventions

- Conventional Commits: `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`.
- Green `main` at every phase boundary; phases are tagged `phase-N`.
- Commits mirror to local + GitHub.
