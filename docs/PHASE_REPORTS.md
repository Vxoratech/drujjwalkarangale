# Vaidyora — Phase reports

Reports in the Phase 14 format. The brief's numbered phases (1–13) map onto the implementation phases A–E below; commits are on `feature/vaidyora-foundation` ([PR #1](https://github.com/Vxoratech/drujjwalkarangale/pull/1)).

**Assumptions made without stopping** (each can be changed):
1. A member may hold several roles in one clinic, so an owner can be Admin + Doctor.
2. Admins do not read clinical notes. They see issued prescriptions (to reprint) and clinical counts, but no drafts.
3. Money is stored in integer paise; GST is applied per line and the discount comes off the total.
4. Only the chief complaint is required in a consultation.
5. A subscription lapse never blocks access to clinical records; only an explicit platform suspension does.
6. India-first defaults: Asia/Kolkata, DD/MM/YYYY, INR, weeks start on Monday; Latin digits in both languages.

---

## Phase A — Audit and architecture
| | |
| --- | --- |
| **Files** | `README.md`, `docs/ARCHITECTURE.md`, `docs/USER_JOURNEYS.md`, `docs/PERMISSIONS.md` (generated), `docs/ERD.md` (generated), `docs/SECURITY.md` |
| **Done** | Repository audited: empty apart from a README, so the project was created from scratch. Architecture: React SPA + Supabase with RLS as the primary boundary, definer RPCs for privileged work, Edge Functions for the service role. Journeys for Admin, Doctor, Owner and Platform. Permission matrix generated from data. ERD generated from foreign keys. Security risks and dependencies listed. |
| **Commands** | `git log`, `ls`, tool versions; `npm run docs:db` |
| **Results** | Docs generated from the real schema; CI fails if they go stale |
| **Limitations** | ERD shows key columns only (full detail in DATABASE.md) |
| **Next** | Phase B |

## Phase B — Design foundation
| | |
| --- | --- |
| **Files** | `src/styles/tokens.css`, `src/styles/index.css`, `tailwind.config.ts`, `src/components/**` (≈30 components), `src/app/layouts/*`, `src/dev/Gallery.tsx` |
| **Done** | Tokens (colour, type, spacing, layout, radii, shadows, z-index, motion, focus); Manrope, DM Sans and Noto Sans Devanagari; responsive shell (collapsible sidebar, mobile drawer); shared loading, empty, error, permission-denied and success states; Admin and Doctor dashboard layouts; accessible data table, forms, dialogs, tabs, charts |
| **Commands** | `npm run build`; Playwright and axe on the gallery |
| **Results** | No WCAG A/AA violations found by axe on reachable screens; no horizontal overflow at 1280 px or on Pixel 7 |
| **Limitations** | No dark mode (not in scope); a manual screen-reader pass is still needed |
| **Next** | Phase C |

## Phase C — Backend foundation
| | |
| --- | --- |
| **Files** | `supabase/config.toml`, `supabase/migrations/0001–0015`, `supabase/functions/*`, `scripts/seed-demo.ts`, `tests/db/*` |
| **Done** | 31 tables with constraints, composite tenant FKs and indexes; RLS on every table, per command; 37 RPCs; auth and membership resolution; invitations; plan limits; audit trail; fictional seed; tenant-isolation and security suites |
| **Commands** | `npm run test:db`; `supabase db push --dry-run`, `supabase db push`, `supabase db lint --linked` |
| **Results** | 102 DB tests pass; 0001–0014 applied to the hosted project, lint clean |
| **Limitations** | Local Supabase stack not run (no Docker here; PGlite used instead); **0015 not yet pushed** |
| **Next** | Phase D |

## Phase D — Core workflows
| | |
| --- | --- |
| **Files** | `src/features/*` (auth, clinic, dashboard, patients, appointments, consultations, prescriptions, investigations, documents, billing, reports, users, clinic-settings, audit-logs, follow-ups), `src/services/*`, `src/locales/*` |
| **Done (in the brief's order)** | 1 sign-in, invitations, clinic picker · 2 patient registration and profile, consents · 3 appointments (day/week, branch, transitions, cancellation, conflicts, follow-up booking) · 4 consultation and history form (रुग्णपत्रिका) · 5 Ayurvedic examination incl. clinic fields · 6 prescriptions with review, revisions, templates · 7 print-ready A4 in EN/MR · 8 investigations and private documents with progress · 9 billing, payments, receipts, refunds, reconciliation (idempotent) · 10 reports and audit viewer · 11 branches, staff, roles, access reviews |
| **Commands** | `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run build` |
| **Results** | 120 unit and component tests pass; build succeeds |
| **Limitations** | Signed-in screens not yet exercised against a live backend; database rule messages are in English; no GST tax-invoice format |
| **Next** | Phase E |

## Phase E — Production hardening
| | |
| --- | --- |
| **Files** | `e2e/*`, `playwright.config.ts`, `tests/unit/security-guards.test.ts`, `tests/unit/migrations.test.ts`, `tests/db/security.test.ts`, `src/lib/monitoring.ts`, `docs/API.md`, `docs/TESTING.md`, `docs/DEPLOYMENT.md`, `docs/RELEASE.md`, `.github/workflows/ci.yml` |
| **Done** | Automated tests at every layer; RBAC and tenant isolation re-verified; responsive and axe accessibility checks (fixed print-footer contrast, small-text contrast and chart touch targets); migrations applied from a clean DB on every run; error handling and security reviewed (idempotency, rate limits, scrubbed monitoring, body-size caps, dependency upgrades); setup and deployment documented; blockers listed |
| **Commands** | `npx tsc -b --noEmit`, `npx eslint src tests scripts e2e`, `npx vitest run`, `npm run build`, `npx playwright test`, `npm audit --omit=dev` |
| **Results** | 222 Vitest tests and 33 Playwright tests pass (5 skipped by design); build OK; production advisories reduced to React Router v7-only and zod 4-only items (mitigated, tracked) |
| **Limitations** | See [RELEASE.md](RELEASE.md): blockers B1–B10 |
| **Next** | Clear B1–B3 (minutes to hours), then a staging pilot with fictional data, then the legal review and region decision before real patients |
