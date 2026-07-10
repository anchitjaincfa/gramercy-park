# Deploying Gramercy Park

Two independently-deployable Next.js apps live in this monorepo:

| App        | Path             | What it is                                                                                    |
| ---------- | ---------------- | --------------------------------------------------------------------------------------------- |
| GP console | `apps/console`   | The fund-admin operator console (review queue, capital calls, NAV, reconciliation, portfolio) |
| LP portal  | `apps/lp-portal` | The investor portal (capital account, distributions, ILPA reporting)                          |

Both render figures computed by the `@gramercy/*` engine packages on **synthetic seeded data** — no
database or secrets are required to build or run them, so they deploy as fully static/prerendered
sites.

## Vercel (recommended)

This is a Turborepo with npm workspaces, which Vercel supports natively. Create **one Vercel project
per app**:

1. Import the GitHub repo `anchitjaincfa/gramercy-park` into Vercel.
2. Set **Root Directory** to `apps/console` (and a second project with `apps/lp-portal`).
3. Framework preset: **Next.js** (auto-detected). Leave build/install commands at their defaults —
   Vercel installs workspace dependencies from the repo root and builds the app.
4. No environment variables are needed for the demo apps.

Or with the Vercel CLI from the repo root:

```bash
npx vercel --cwd apps/console     # deploy the GP console
npx vercel --cwd apps/lp-portal   # deploy the LP portal
```

## Local preview

```bash
npm install
npm run -w @gramercy/console dev      # http://localhost:3000
npm run -w @gramercy/lp-portal dev    # http://localhost:3000 (run separately)
```

## The one place a key is needed

Only the **live AI agent demo** needs an Anthropic key — it is not part of the web apps:

```bash
ANTHROPIC_API_KEY=sk-ant-... npm run -w @gramercy/agents demo
```

Everything else — both apps, all tests, all builds — runs with no credentials.
