# Vaidyora — Remaining gaps and release blockers

Status as of 03/11/2026 (single-organization revision). "Blocker" means the item must be done before any **real patient data** enters the system. A blocker-free staging demo with fictional data is possible today.

## Release blockers

| # | Item | Why it blocks | Owner | Effort |
| --- | --- | --- | --- | --- |
| B1 | **Bind the primary doctor** (`npm run bootstrap` or `select public.bootstrap_primary_doctor(...)`) and appoint the first administrator | Until then nobody has access: the app shows "No access yet" | Owner + Engineering | minutes |
| B2 | **Deploy Edge Functions** `staff-admin`, `document-url` and set `SITE_URL` / `ALLOWED_ORIGINS` | Staff invitations, password resets, deactivation sign-in blocking, administrator appointment and opening patient documents need them | Engineering | < 1 hour |
| B3 | **Auth configuration** on the hosted project: **disable public sign-up**, Site URL and redirects, password policy, SMTP sender | Sign-ups currently create (access-less) accounts; invite and reset links won't land correctly; built-in email is rate-limited | Engineering | < 1 hour |
| B4 | **Legal and privacy review** (DPDP Act 2023, IT Act/SPDI, medical-record retention, telemedicine, ABDM if used) and a **data processing agreement** with Supabase | Patient health data; [SECURITY.md §13](SECURITY.md#13-regulatory-position-not-a-compliance-claim). No compliance is claimed. | Clinic owner + counsel | weeks |
| B5 | **Hosting region decision** (currently Sydney); move to an Indian region if required | Data-location expectations; moving later means migrating data | Owner + counsel | decision, then hours |
| B6 | **Backups**: enable PITR and a scheduled copy of the storage bucket; do one restore drill | No recovery path for patient records otherwise | Engineering | hours |
| B7 | **Run the live E2E flow** on a disposable staging project (`E2E_*` secrets in CI) and click through staff onboarding with a test receptionist | The signed-in screens are unit-tested and type-checked, and the database rules are tested in PGlite, but they haven't been clicked through against a real backend | Engineering | hours |
| B8 | **Clinical review of the रुग्णपत्रिका form and Marathi copy** (including the new staff, branch and permission screens) by a practising vaidya | Labels and sections must match clinical practice; machine-assisted Marathi needs native review | Dr. Ujjwal Karangale | 1–2 sessions |
| B9 | **React Router v7 upgrade** (or a reviewed risk acceptance) | Two high advisories open in 6.x. Exposure is low: no SSR, and the only stored navigation paths (notification links) reject backslashes in the database. Upgrade before production. | Engineering | ~1 day |
| B10 | **Production hosting with security headers** (CSP, HSTS, `frame-ancestors 'none'`) | [DEPLOYMENT.md §4](DEPLOYMENT.md#4-frontend-build-and-hosting) | Engineering | hours |

## Should fix soon (not blocking a first clinic)

| Item | Notes |
| --- | --- |
| zod 4 migration | Advisory GHSA-mrhx-c7xc-m3w5 (memory use on oversized collections). Mitigated where it matters: Edge Functions refuse bodies over 8 KB before parsing. The browser only validates the user's own form input. |
| Scheduled jobs (`pg_cron`) | Audit retention purge, abandoned-upload purge plus storage object deletion, notification cleanup |
| Error monitoring provider | Wire `setErrorSink()` to Sentry or similar with PII off |
| Database rule messages in Marathi | Server-raised business messages are shown in English; generic errors are translated |
| Dev-dependency advisories | Vite 5 / esbuild and others; dev-only, not shipped. Upgrade Vite in a maintenance pass. |
| Manual accessibility pass | axe finds no WCAG A/AA issues on the screens it can reach; a keyboard-only and screen-reader (NVDA/VoiceOver) pass of the signed-in screens is still needed |

## Product gaps (planned, not built)

- Patient merge tooling (duplicates are flagged at registration and never merged automatically)
- Pharmacist / dispensing role and medicine inventory
- GST tax-invoice format (HSN/SAC, CGST/SGST split), credit notes, medicine and inventory catalogue
- PDF/CSV export files (printing uses the browser's "Save as PDF")
- SMS and WhatsApp reminders, realtime notifications (polling every 60 s today)
- Clinic logo upload and doctor signature images on prints
- Read-access logging beyond patient records and documents (e.g. consultation views)
- Data-export tooling for DPDP data-principal requests

## What is verified today

| Check | Result |
| --- | --- |
| Migrations from a clean database | The five baseline migrations apply in order to an empty Postgres (PGlite) on every test run, and to the hosted project (reset 03/11/2026); `supabase db lint --linked` reports no issues |
| Identity and access | 29 database tests: one organization, one doctor (cannot be duplicated, replaced, demoted or deactivated even by the database owner), admin appointment, doctor-only permissions, grants and denies, no self-elevation, delegated authority, invitation lifecycle, deactivation, branch scope, working hours |
| Clinical and branch isolation | 16 database tests: receptionists cannot read or write any clinical table or function; branch scoping for schedule, billing and reports; admin read-only clinical access; doctor-only drafts; documents; audit without clinical values |
| Workflows | 15 database tests: central registration with duplicate detection, cross-branch visits on one profile, no double-booking across branches, working hours, appointment permissions, follow-ups, idempotent billing, dashboards and reports with branch filters, staff activity, notifications |
| Unit and component | 131 tests, including navigation per account type, the permission editor, the duplicate review flow and contact-only editing |
| End-to-end (no backend) | 48 Playwright tests on desktop, iPad Mini and Pixel 7: sign-in, no public sign-up, Marathi rendering, responsive layout, print/PDF, axe WCAG A/AA |
| Static | `tsc` strict and ESLint clean; `npm run build` succeeds |
