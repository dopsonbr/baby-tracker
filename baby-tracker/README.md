# Beckett

A single, private family app: Today, Growth, History, and Settings. Today combines a feeding-goal bottle, completed and planned moments, quick entry, natural-language review, browser dictation, and whiteboard camera/upload scanning. Share view is a separate illustrated day sheet with an activity table, caregiver notes, and pastel tips. Tips default on; the toggle hides the outside panels while preserving activity notes and totals. Save picture creates a complete high-resolution PNG locally, including long days; compatible phones can then share that file through the native share sheet. No public link is published.

## Local setup

Use Node 24 and pnpm 10.33.4. Run commands from this directory (`baby-tracker/` inside the GitHub repository).

```sh
pnpm install
pnpm dev:demo
```

Sample mode is clearly labeled and stores only synthetic data in this browser. It is available only with Vite’s development build and `VITE_DEMO_MODE=true`; a production build cannot use it. It does not call the API or simulate a live AI service. Clearing browser storage clears the sample.

For the real application:

1. Copy `.env.example` to `.env.local`, and `apps/web/.env.example` to `apps/web/.env.local`.
2. Configure a separate Neon Postgres database/branch, and set `DATABASE_URL`.
3. Create a Clerk application, enable **Google only**, disable password and email-code sign-in, and enable Clerk’s email allowlist for sign-up and sign-in. Add your approved family addresses without sending invitations. The API separately checks the exact verified Google-linked email against `ALLOWED_EMAILS` on every request.
4. Set the server Clerk keys and the matching `VITE_CLERK_PUBLISHABLE_KEY` in the web environment. `CLERK_AUTHORIZED_PARTIES` is a comma-separated list of permitted origins, including `http://127.0.0.1:5173` locally. Never expose secret keys in a `VITE_` variable.
5. AI requests go through Vercel AI Gateway. On Vercel, use OIDC; locally pull a fresh OIDC token with the Vercel CLI or set `AI_GATEWAY_API_KEY`. The default `AI_MODEL=openai/gpt-5.6-luna` was verified against the live Gateway model catalog on September 16, 2026. No direct OpenAI API key is required.
6. Run the migrations, then start both services:

```sh
pnpm db:migrate
pnpm dev
```

Vite runs on `http://127.0.0.1:5173`, proxying `/api` to the API development server on port 3001. Sign in with an approved Google account. Configure the birthday, reference sex, timezone and feeding goal in Settings before using age-based growth percentiles. Blank records stay blank; no real health history is fabricated.

## Workspaces

- `apps/web`: React/Vite UI, Clerk client, API client, isolated sample adapter and replaceable browser speech adapter.
- `apps/api`: authentication, AI interpretation, application validation, transactional repository and SQL migrations. The local server uses the same request handler as Vercel.
- `api/[...path].ts`: a thin Vercel Function entry point, with no UI logic.
- `packages/domain`: shared Zod contracts, event transformations, timezone dates and totals.
- `packages/ui`: the generated shadcn preset, Geist font and shared components.

All family data is tied to a single child profile. Today and future days follow goal edits; past days retain their snapshots. Effective-date goal history supplies the right value when opening an older day for the first time. Feeds, sleep and notes are explicit rows, not one JSON day blob. Completed feeds count toward totals; planned feeds never do. Sleep belongs to its start day, and an end clock earlier than the start represents the next day. An open sleep has no invented end time. Times are wall-clock values in the configured family timezone; changing timezone does not reinterpret historical clocks. DST elapsed-time handling is a future extension.

Natural-language input produces a validated proposal, never a database mutation. Ambiguous input returns a short clarification, and the user reviews concrete events before saving. Application schemas and event-ID validation run again before persistence. Event mutations use UUID request receipts and a day version, so retries cannot duplicate a feed and stale corrections return a conflict. Manual entry remains available when AI is unavailable. Dictation requires browser support, microphone permission and a secure origin; speech recognition may be processed by the browser vendor. Dictated text uses the same Luna interpretation and review path as typed text.

## Checks

```sh
pnpm format
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm exec playwright install chromium  # first run only
pnpm test:e2e
pnpm build
```

Tests run locally. There is deliberately no GitHub CI workflow. Backend tests exercise the real SQL schema against embedded Postgres, along with auth, validation, corrections, goal snapshots, idempotency and API error behavior. Browser tests cover mobile entry, persistence, history and the screenshot surface using explicit sample data. The sample adapter is not evidence of authenticated production persistence; live database and Gateway verification are documented separately in `VERIFICATION.md`.

## Vercel deployment

Import `dopsonbr/baby-tracker` into Vercel. Set **Root Directory = `baby-tracker`** and Node.js 24. `vercel.json` defines the build, output directory, function entry points, security headers and SPA rewrite. `main` should be the production branch; other branches and pull requests get native Vercel previews. Keep the pnpm lockfile committed. No custom deployment service or CI pipeline is needed.

Set environment variables independently for Development, Preview and Production:

| Variable                     | Where  | Purpose                                                                             |
| ---------------------------- | ------ | ----------------------------------------------------------------------------------- |
| `DATABASE_URL`               | Server | Neon connection; use an isolated branch for preview                                 |
| `CLERK_SECRET_KEY`           | Server | Clerk backend key for the matching instance                                         |
| `CLERK_PUBLISHABLE_KEY`      | Server | Matching Clerk publishable key                                                      |
| `VITE_CLERK_PUBLISHABLE_KEY` | Build  | Public key embedded in the frontend bundle                                          |
| `ALLOWED_EMAILS`             | Server | Exact comma-separated approved Google emails; empty fails closed                    |
| `CLERK_AUTHORIZED_PARTIES`   | Server | Exact approved origins; deployment origins are also derived from trusted Vercel env |
| `AI_MODEL`                   | Server | Optional model override; default is verified Luna                                   |
| `AI_GATEWAY_API_KEY`         | Server | Optional alternative to Vercel OIDC                                                 |

The shared domain package compiles to JavaScript during installation and before builds so Vercel Functions can resolve it at runtime.

Run migrations explicitly against the intended Neon branch before releasing; builds do not mutate databases. Never point preview at the production database. Clerk’s production instance requires a custom domain and production Google OAuth configuration; development keys can verify a preview but do not constitute completed production authentication. After changing a frontend key, rebuild the deployment.

The repository has a manifest and scalable app icon as groundwork for an installable mobile app. It does **not** cache family records offline, queue offline writes, or implement native iOS. A service worker is intentionally deferred until private cache and conflict behavior can be designed properly.

## Growth references and old apps

Growth retains measurement history, percentile trends, velocity and exploratory scenarios. Bundled WHO/CDC reference tables and calculation notes are documented beside the data in `apps/web/src/lib/`. Scenarios are illustrations, not individual medical predictions.

The original Beckett Day and Growth Tracker sites remain unchanged. On September 16, their owner records were imported into the separate development and production databases: five days, 47 activities and six measurements. Import preserves feeding goals, completed/planned status, caregiver notes, measurement sources and the head-circumference review flag. Other viewers' duplicate records were excluded. The September 15 schedule is the saved reference-derived schedule, with its original statuses retained. Original photo files remain on the old site. Raw records and import receipts are private local files excluded from Git and deployments; there is no automatic synchronization.

### Whiteboard photos

Take a photo opens the device camera where supported; Upload a photo accepts JPEG, PNG or WebP. The browser strips metadata and resizes the image before sending at most 2 MiB to the authenticated Luna endpoint. Photos are processed temporarily, not stored. The reader uses the selected day, detects conflicting visible dates, avoids double-counting B/F/N breakdowns, and asks about unmeasured nursing or unclear text. Scan board returns a proposal; only Confirm & save writes records. Photo scanning is unavailable in the synthetic local demo. Real camera hardware and the native OS share sheet still need device verification.

### Importing an existing private tracker

The legacy importer accepts a private normalized JSON payload with `source`, `profile`, dated `days` (including original goals, caregiver notes and events with `legacyKey`), and `measurements` (including source, notes, review flags and `legacyKey`). Keep this payload and raw backups outside tracked source. Use a distinct database environment file for the intended target, and apply migrations first.

From `baby-tracker/apps/api`, review a dry-run (the default), using absolute paths for the environment and private payload files:

```sh
pnpm exec tsx --env-file=/absolute/path/to/.env.test.local src/import-legacy-cli.ts --file /absolute/private/import.json --target development
```

Run the identical command with `--apply` only after reviewing its counts, target label and payload hash. For the production database, select its environment file and use `--target production`. The label records intent; the loaded `DATABASE_URL` determines the actual database. Neither credentials nor personal record contents are printed.

Imports run in one transaction with deterministic UUIDs and per-source receipts/provenance. Conflicting populated days, measurements or profile values cause the entire import to fail. Only a missing birthday and untouched empty days with matching goals may be filled. Historical daily goals and caregiver notes are retained. A repeated source and identical normalized payload skips all writes, including records edited or deleted after import; reusing that source with changed contents is rejected. The database's existing numeric precision is retained (weight to 0.001 kg, length/head to 0.01 cm, feed amounts to 0.01 oz); retain the private raw-source backup for original units and precision.
