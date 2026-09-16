# Verification and release status

Verified locally on September 16, 2026.

## Implementation checks

- Formatting, ESLint across all workspaces, TypeScript, and production build pass.
- Twenty-six backend tests run against the actual migrations in embedded Postgres. They cover authentication, schema validation, transactional multi-event updates, replay deduplication, stale corrections, atomic rollback, historical goals, timezone changes, measurement metadata, throttling, photo validation/deduplication, and transactional legacy import/replay/conflicts.
- Nine growth numerical tests cover published WHO LMS values, unit conversion, dates, percentile inversion, head circumference, weight-for-length and CDC adult scenarios.
- Fourteen mobile Playwright checks exercise manual bottle add/edit/reload, planned-versus-completed totals, natural-language review before save, overnight sleep, goal history, overflow, photo upload/preview/removal, tips toggle and complete PNG export.
- Today and Share were visually inspected at phone size. The export uses cream paper, handwritten type, a blue activity table and pastel tip panels. A 20-event synthetic day downloaded successfully as a complete 2000-pixel-wide PNG; the phone view remains readable and the saved picture includes the whole sheet. Native OS sharing and real camera hardware have not been exercised.

## Live service checks

- A dedicated Neon `beckett` project has separate main and development branches. Migrations 001–004 applied to both. A synthetic development-database roundtrip proved durable insert, idempotent replay, identity-preserving correction and stale-write rejection. Synthetic rows were removed afterward. Both branches now contain the explicitly requested import: five days, 47 activities and six measurements. Every field matched the normalized source payload on readback; replay returned already-imported without duplicates. Private receipts record distinct database fingerprints, the shared payload hash and 58 provenance records.
- Three synthetic live Luna requests through Vercel AI Gateway/OIDC passed: an explicit feed, a waking correction targeting the existing sleep UUID, and an ambiguous update yielding questions with no operations. No real family notes were sent in those checks.
- Three additional synthetic live Luna vision fixtures passed: B2 + F3 + Total5 becomes one 5-ounce feed; nursing without measured volume asks a question with no operations; a mismatched board date also returns no operations. No real whiteboard photo was sent in these checks.
- Clerk's dedicated Beckett development instance has password and email-code sign-in disabled, Google enabled, and its allowlist enforced on sign-up and sign-in. The server independently enforces the two approved verified Google email addresses. No invitations were sent.
- Actual HTTP calls without a bearer token or with a malformed bearer token return 401. The Google sign-in landing UI renders. Interactive Google login could not be completed because Chrome reported another extension UI blocking browser automation; it is not claimed as verified end-to-end.

## Deployment and remaining setup

Vercel project: [Beckett in Brian Labs](https://vercel.com/brian-dopson-labs/beckett).

The Vercel project uses repository root directory `baby-tracker`. Preview variables use the separate Neon development branch and Clerk development instance. Production credentials are intentionally not configured until a custom domain and production Google OAuth/Clerk instance are ready. Vercel automatically assigned the first deployment to production; that deployment is a fail-closed setup screen, with no configured family access or database credentials. The explicitly targeted preview contains the working service configuration.

The native GitHub connection attempt failed with Vercel's repository-access error. Grant the Vercel GitHub app access to `dopsonbr/baby-tracker`, then connect it at [Project Settings → Git](https://vercel.com/brian-dopson-labs/beckett/settings/git). Set `main` as the production branch. No custom GitHub CI was added.

Existing Beckett Day and Growth Tracker sites were read-only sources. Their data and audiences were not changed. Owner records were imported with the original head-measurement review flag, historical feeding goals, caregiver note and completed/planned statuses. Other viewers' duplicate records were excluded. The saved September 15 schedule was reference-derived; its persisted statuses were retained rather than inferred again from the image. Original photo assets remain on the old site. Future changes on the old sites are not synchronized.

The manifest and icon are present, but no offline writes, service-worker data caching, or native iOS app are implemented. Browser speech recognition requires microphone permission; real microphone capture has not been exercised by automated tests.
