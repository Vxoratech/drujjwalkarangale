# Vaidyora — Remaining gaps and release blockers

Status as of 02/11/2026. "Blocker" means the item must be done before any **real patient data** enters the system. A blocker-free staging demo with fictional data is possible today.

## Release blockers

| # | Item | Why it blocks | Owner | Effort |
| --- | --- | --- | --- | --- |
| B1 | **Apply migration 0015** to the hosted project | The app sends request keys to billing functions that the hosted database doesn't have yet; invoices, payments and refunds fail | Engineering | minutes (`supabase db push`) |
| B2 | **Deploy Edge Functions** `invite-member`, `document-url` and set `SITE_URL` / `ALLOWED_ORIGINS` | Staff invitations and opening patient documents don't work without them | Engineering | < 1 hour |
| B3 | **Auth configuration** on the hosted project: Site URL and redirects, password policy, SMTP sender | Password reset and invite links won't land correctly; built-in email is rate-limited | Engineering | < 1 hour |
| B4 | **Legal and privacy review** (DPDP Act 2023, IT Act/SPDI, medical-record retention, telemedicine, ABDM if used) and a **data processing agreement** with Supabase | Patient health data; [SECURITY.md §13](SECURITY.md#13-regulatory-position-not-a-compliance-claim). No compliance is claimed. | Clinic owner + counsel | weeks |
| B5 | **Hosting region decision** (currently Sydney); move to an Indian region if required | Data-location expectations; moving later means migrating data | Owner + counsel | decision, then hours |
| B6 | **Backups**: enable PITR and a scheduled copy of the storage bucket; do one restore drill | No recovery path for patient records otherwise | Engineering | hours |
| B7 | **Run the live E2E flow** on a disposable staging project (`E2E_*` secrets in CI) | The signed-in screens are unit-tested and type-checked but haven't been clicked through against a real backend | Engineering | hours |
| B8 | **Clinical review of the रुग्णपत्रिका form and Marathi copy** by a practising vaidya | Labels and sections must match clinical practice; machine-assisted Marathi needs native review | Dr. Ujjwal Karangale | 1–2 sessions |
| B9 | **React Router v7 upgrade** (or a reviewed risk acceptance) | Two high advisories open in 6.x. Exposure is low: no SSR, and the only stored navigation paths (notification links) reject backslashes in the database. Upgrade before production. | Engineering | ~1 day |
| B10 | **Production hosting with security headers** (CSP, HSTS, `frame-ancestors 'none'`) | [DEPLOYMENT.md §4](DEPLOYMENT.md#4-frontend-build-and-hosting) | Engineering | hours |

## Should fix soon (not blocking a first clinic)

| Item | Notes |
| --- | --- |
| zod 4 migration | Advisory GHSA-mrhx-c7xc-m3w5 (memory use on oversized collections). Mitigated where it matters: Edge Functions refuse bodies over 8 KB before parsing. The browser only validates the user's own form input. |
| Scheduled jobs (`pg_cron`) | Audit retention purge, abandoned-upload purge plus storage object deletion, notification cleanup |
| Error monitoring provider | Wire `setErrorSink()` to Sentry or similar with PII off |
| Database rule messages in Marathi | Server-raised business messages are shown in English; generic errors are translated |
| Platform console UI | `platform_*` functions exist; operators currently use SQL |
| Dev-dependency advisories | Vite 5 / esbuild and others; dev-only, not shipped. Upgrade Vite in a maintenance pass. |
| Manual accessibility pass | axe finds no WCAG A/AA issues on the screens it can reach; a keyboard-only and screen-reader (NVDA/VoiceOver) pass of the signed-in screens is still needed |

## Product gaps (planned, not built)

- UI for Receptionist, Accountant, Pharmacist and Branch Manager (permissions already configured)
- GST tax-invoice format (HSN/SAC, CGST/SGST split), credit notes, medicine and inventory catalogue
- PDF/CSV export files (printing uses the browser's "Save as PDF")
- SMS and WhatsApp reminders, realtime notifications (polling every 60 s today)
- Clinic logo upload and doctor signature images on prints
- Patient archiving/merge UI, branch filter controls on list screens
- Read-access logging beyond patient records and documents (e.g. consultation views)
- Data-export tooling for DPDP data-principal requests

## What is verified today

| Check | Result |
| --- | --- |
| Migrations from a clean database | All 15 apply in order to an empty Postgres (PGlite) in every test run. 0001–0014 applied to the hosted project with `supabase db lint` clean. |
| Tenant isolation and RBAC | 102 database tests, including cross-clinic attacks on patients, appointments, prescriptions and documents |
| Unit and component | 120 tests (validation, states, transitions, prescriptions, permissions, i18n, money, security guards) |
| End-to-end (no backend) | 33 Playwright tests on desktop and Pixel 7: sign-in, Marathi rendering, responsive layout, print/PDF, axe WCAG A/AA |
| Static | `tsc` strict and ESLint clean; `npm run build` succeeds |
