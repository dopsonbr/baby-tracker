# Verification and release status

Verified locally on September 16, 2026.

## Implementation checks

- Formatting, ESLint across all workspaces, TypeScript, and production build pass.
- Fourteen backend tests run against the actual migrations in embedded Postgres. They cover authentication, schema validation, transactional multi-event updates, replay deduplication, stale corrections, atomic rollback, immutable historical goals, future-day goals, timezone changes, measurement metadata, throttling and API behavior.
- Nine growth numerical tests cover published WHO LMS values, unit conversion, dates, percentile inversion, head circumference, weight-for-length and CDC adult scenarios.
- Ten mobile Playwright checks exercise manual bottle add/edit/reload, planned-versus-completed totals, natural-language review before save, overnight sleep, goal history, overflow and the dedicated share surface.
- Today and Share were visually inspected at 390 × 844. The sample Share surface fits eight events, feeding and sleep totals, and its footer within that viewport.

## Live service checks

- A dedicated Neon `beckett` project has separate main and development branches. Migrations 001–003 applied to both. A synthetic development-database roundtrip proved durable insert, idempotent replay, identity-preserving correction and stale-write rejection. Synthetic rows were removed afterward. Main received schema migrations only.
- Three synthetic live Luna requests through Vercel AI Gateway/OIDC passed: an explicit feed, a waking correction targeting the existing sleep UUID, and an ambiguous update yielding questions with no operations. No real family notes were sent in those checks.
- Clerk's dedicated Beckett development instance has password and email-code sign-in disabled, Google enabled, and its allowlist enforced on sign-up and sign-in. The server independently enforces the two approved verified Google email addresses. No invitations were sent.
- Actual HTTP calls without a bearer token or with a malformed bearer token return 401. The Google sign-in landing UI renders. Interactive Google login could not be completed because Chrome reported another extension UI blocking browser automation; it is not claimed as verified end-to-end.

## Deployment and remaining setup

Vercel project: [Beckett in Brian Labs](https://vercel.com/brian-dopson-labs/beckett).

The Vercel project uses repository root directory `baby-tracker`. Preview variables use the separate Neon development branch and Clerk development instance. Production credentials are intentionally not configured until a custom domain and production Google OAuth/Clerk instance are ready. Vercel automatically assigned the first deployment to production; that deployment is a fail-closed setup screen, with no configured family access or database credentials. The explicitly targeted preview contains the working service configuration.

The native GitHub connection attempt failed with Vercel's repository-access error. Grant the Vercel GitHub app access to `dopsonbr/baby-tracker`, then connect it at [Project Settings → Git](https://vercel.com/brian-dopson-labs/beckett/settings/git). Set `main` as the production branch. No custom GitHub CI was added.

Existing Beckett Day and Growth Tracker sites were read-only references. Their data and audiences were not changed. Historical records were not imported; the original head-measurement review flag and historical feeding goals must be preserved in any future migration.

The manifest and icon are present, but no offline writes, service-worker data caching, or native iOS app are implemented. Browser speech recognition requires microphone permission; real microphone capture has not been exercised by automated tests.
