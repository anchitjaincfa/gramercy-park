# Gramercy Park — Product Spec

Derived from research into the AI-native fund-admin category (notably
[Hanover Park](https://www.hanoverpark.com/)). This is the product surface we are cloning,
re-expressed as our own build. Gramercy Park is not affiliated with any company; it runs on
synthetic data.

## The pitch

The back office for private-markets funds, rebuilt AI-native. One platform for the general
partner's fund accounting, portfolio intelligence, and the limited partner's experience — where
AI does the preparation and human experts approve every output.

**Operating principle:** *AI prepares. Expert accountants review.*

## Users

- **GP / Fund CFO / Controller** — runs the fund's books, approves AI proposals, issues capital
  calls, closes NAV.
- **Fund accountant / reviewer** — works the review queue and exception queue.
- **Limited Partner (LP)** — sees their capital account, statements, and reporting; asks
  questions.

## Pillar 1 — Fund Administration (GP console)

- **Unified general ledger** across funds, feeders, SPVs, management companies, and GP entities,
  each with its own books and multi-entity consolidation.
- **Same-day capital activity:** prepare a capital call from a natural-language purpose; the
  system allocates pro-rata, runs **30+ automated health checks**, routes for review, and posts.
- **Distributions** (return of capital, gains, income) with allocation and basic waterfall.
- **Management fees** computed on committed / invested / NAV basis at a set frequency.
- **NAV calculation** from the posted ledger + latest valuations; per-LP NAV share.
- **Reconciliation:** ~90%-target auto-categorization with continuous **three-way matching**
  (bank feed ↔ documents ↔ GL) and an exception queue with full context.
- **Audit-ready by default:** every posted entry traces to its source and its approver.

## Pillar 2 — Portfolio Intelligence

- **Deal & cap-table ingestion:** AI reads deal docs and cap tables to build the position record
  (instrument, ownership %, liquidation prefs).
- **KPI collection:** AI reconciles portfolio KPIs across board decks, forms, and email, flagging
  disagreements between sources.
- **Investment-update schedules** proposed automatically from inbound updates.
- **Equity pickup / ownership tracking** and a portfolio dashboard.

## Pillar 3 — LP Experience (LP portal)

- **Capital-account statements** per LP per fund (commitments, contributions, distributions,
  unfunded, NAV share).
- **Capital-call & distribution history** with notices and documents.
- **ILPA-style reporting** (fees & expenses, PCAP templates).
- **Document vault** scoped to the LP.
- **LP Q&A agent** that answers investor questions grounded strictly in that LP's own data
  (RLS-enforced), returning proposed answers for GP approval where policy requires.

## The five AI agents (propose-only, human-reviewed)

Mirrors the category's agent workflows; all outputs are proposals in the review queue.

1. **Bill / journal-entry agent** — from an uploaded bill or email, proposes the intercompany
   journal entry with account coding and evidence citations.
2. **Evidence-collection agent** — extracts invoices/documents from email and auto-files them
   against the right entity/period.
3. **Investment-update agent** — proposes investment-update schedule entries from inbound updates.
4. **LP-response agent** — drafts responses/actions (contact update, statement request) for LP
   messages.
5. **KPI-reconciliation agent** — compares portfolio KPI values collected across multiple sources
   and proposes the reconciled figure.

Category signal we design toward (from public materials): ~90% of cash auto-categorized, ~80% of
email-agent actions approved without edits, same-day capital-activity visibility. These are
*targets that shape the UX* (fast prepare, tight review), not guarantees.

## What makes it "AI-native" (not "AI-added")

- The **review queue is the primary work surface**, not a settings page. The accountant's day is
  triaging AI proposals, not typing journal entries from scratch.
- **Every AI output is evidence-linked and editable** before it becomes truth.
- The **deterministic ledger is the source of truth**; AI accelerates the path to a posted,
  reconciled, audit-ready book — it never *is* the book.
