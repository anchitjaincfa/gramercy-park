# Gramercy Park

**An open-source, AI-native fund administration platform.**

Gramercy Park is an AI-native operating system for private-markets fund administration — the
back office for venture capital, private equity, and private credit funds. It unifies three
things that legacy fund admins keep in separate silos:

1. **Fund Administration** — a real double-entry general ledger, multi-entity consolidation,
   capital calls, distributions, management fees, and NAV calculation.
2. **Portfolio Intelligence** — AI ingestion of deal documents, cap tables, and KPI updates;
   equity pickup and ownership tracking.
3. **LP Experience** — investor portal, capital-account statements, ILPA-style reporting, and
   an LP Q&A agent.

Its operating principle, borrowed from the category it targets:

> **AI prepares. Expert accountants review.**

Every AI action (a proposed journal entry, a reconciliation match, an LP response) is a
_proposal_ that lands in a human review queue with full source traceability. Nothing posts to
the ledger without an approval and an audit trail.

> ⚠️ **This is an educational open-source clone** built to study the architecture of the
> AI-native fund-admin category (inspired by [Hanover Park](https://www.hanoverpark.com/)). It
> is **not** production accounting software and is **not** affiliated with any company. It runs
> on synthetic, seeded data. Do not use it to administer real funds.

## Why it exists

Two reasons, and this repo is an experiment in both:

- **A serious reference architecture** for what "AI-native" means in a domain where correctness
  is non-negotiable (money must balance to the cent) — showing how you bolt probabilistic AI
  onto a deterministic accounting core without letting the AI touch the source of truth.
- **A demonstration of AI-native _construction_** — the entire codebase is built by parallel
  Claude agent teams orchestrated in phases, with the Codex CLI acting as an independent
  reviewer at every gate. See [`docs/PLAN.md`](docs/PLAN.md).

## Architecture at a glance

Turborepo monorepo, TypeScript end to end.

```
apps/
  console/     GP-facing fund-admin console (Next.js)
  lp-portal/   LP-facing investor portal (Next.js)
packages/
  db/          Drizzle schema + migrations (Postgres/Supabase)
  ledger/      Deterministic double-entry accounting engine + NAV
  fund-admin/  Capital calls, distributions, fees, allocations
  recon/       Three-way reconciliation & matching engine
  agents/      Claude-powered product agents (propose-only, HITL)
  core/        Shared domain types, money math, result types
  ui/          Shared design system (shadcn/ui + Tailwind)
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full design and
[`docs/PRODUCT.md`](docs/PRODUCT.md) for the product spec.

## Status

Built in public, phase by phase. Track progress in [`docs/PLAN.md`](docs/PLAN.md).

| Phase | Scope                                          | Status  |
| ----: | ---------------------------------------------- | ------- |
|     0 | Foundation, monorepo, docs, CI                 | ✅ done |
|     1 | Double-entry ledger core (+ tenancy/RLS/audit) | ✅ done |
|    2a | Commitments & capital calls                    | ✅ done |
|    2b | Distributions, fees & capital accounts         | ✅ done |
|    2c | Valuation, periods & NAV                       | ✅ done |
|     3 | Reconciliation engine                          | ⏳      |
|     4 | AI agent layer                                 | ⏳      |
|     5 | Portfolio intelligence                         | ⏳      |
|     6 | LP experience                                  | ⏳      |
|     7 | Enterprise hardening & deploy                  | ⏳      |

## License

MIT — see [`LICENSE`](LICENSE).
