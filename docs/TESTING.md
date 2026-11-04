# Vaidyora — Quality and testing

| Layer | Tool | Command | Where |
| --- | --- | --- | --- |
| Unit and component | Vitest + React Testing Library (jsdom) | `npm run test:unit` | `src/**/*.test.ts(x)`, `tests/unit/` |
| Database, RLS and RPCs | Vitest + PGlite running the **real migrations** | `npm run test:db` | `tests/db/` |
| End-to-end | Playwright (desktop Chrome, iPad Mini, Pixel 7) | `npm run test:e2e` | `e2e/` |
| Static | ESLint (typed rules, React hooks), `tsc` strict | `npm run lint`, `npm run typecheck` | — |
| Build | Vite production build | `npm run build` | — |

`npm test` runs unit and database tests. CI runs everything on every push and pull request, including a check that the generated database docs match the migrations.

## Coverage of the Phase 13 requirements

| Requirement | Tests |
| --- | --- |
| Form validation | `features/*/…Schema.test.ts` (patient, consultation, prescription, invoice, payment, refund); `tests/unit/patients.test.tsx` (registration form errors); `prescriptions.test.tsx` (required medicine fields); `e2e/public.spec.ts` (sign-in validation, focus on first invalid field) |
| Loading, empty and error states | `tests/unit/patients.test.tsx` (loading → rows, empty with action, safe error with retry); `components.test.tsx` (empty state, permission denied) |
| Appointment status transitions | `tests/db/workflows.test.ts` (no overlap across branches, working hours, separate cancel and check-in permissions); `tests/unit/appointments.test.tsx` (actions by role and status, cancellation reason, **UI table matches the SQL trigger**) |
| Patient registration | `tests/unit/patients.test.tsx` (trimming, nulls, duplicate review, contact-only editing); `tests/db/workflows.test.ts` (patient IDs, duplicate detection, review required, one profile across branches) |
| Prescription creation and revision | `tests/unit/prescriptions.test.tsx` (draft → review checkbox → issue; read-only issued view; revision needs a reason); `tests/db/clinical-access.test.ts` (doctor-only drafts, issue, immutable records) |
| Role and permission boundaries | `tests/unit/AppShell.test.tsx` (navigation per account type), `permission-editor.test.tsx`, `components.test.tsx` (guards); `tests/db/access.test.ts` (one organization, one doctor, doctor-only keys, grants and denies, no self-elevation, delegated authority, invitations, deactivation, branch scope) |
| Clinical and branch isolation | `tests/db/clinical-access.test.ts`: a receptionist is refused every clinical table and function; staff cannot reach other branches' schedules or bills; granted clinical view stays branch-limited; admin reads but never writes clinical records |
| Storage access rules | `tests/db/clinical-access.test.ts` (server-assigned paths, upload needs `investigations.upload` and a pending row, documents hidden without `documents.view`); `services/documents.test.ts` (type, size, safe names) |
| Currency calculations | `lib/formatters` (₹ formatting, paise conversion), `services/billing.test.ts` (client preview equals server rounding), `tests/db/*` (server totals, partial payments, refunds, cached totals equal the rows) |
| Marathi text rendering | `src/locales/i18n.test.ts` (key parity, fallback); `tests/unit/components.test.tsx`, `prescriptions.test.tsx` (Marathi labels and clinician text); `e2e/public.spec.ts` (Devanagari font actually loaded, `lang="mr"`, translated validation) |
| Responsive layouts | `e2e/public.spec.ts`: no horizontal scrolling on key pages at desktop, tablet (iPad Mini) and phone (Pixel 7) sizes; tables turn into cards on phones |
| Print output | `e2e/print.spec.ts` (A4 width, no clipped cells, rows not split across pages, 14-item Marathi prescription paginates to 2–4 pages, short one fits on 1, private notes never printed); `prescriptions.test.tsx` (print language independent of UI language) |
| Security guards | `tests/unit/security-guards.test.ts`, `hardcoded-strings.test.ts`, `migrations.test.ts` |

## End-to-end against a real backend

`e2e/clinic-flow.spec.ts` covers sign in → register patient → consultation with examination → finalize → prescription → clinician review → issue → print. It is **skipped** unless these are set, and must only be pointed at a **disposable** Supabase test project seeded with `npm run seed:demo` (`E2E_EMAIL` = the demo doctor), never one with real patients:

```bash
E2E_SUPABASE_URL=… E2E_SUPABASE_ANON_KEY=… E2E_EMAIL=… E2E_PASSWORD=… npm run test:e2e
```

Without them, Playwright serves the app against an unreachable placeholder backend, so no test can touch real data. In CI, provide them as repository secrets to enable the flow.

## Fixtures

`src/dev/fixtures.ts` holds fictional records, used by component tests and by the dev-only pages `/__gallery` and `/__fixtures/prescription?lang=mr&items=14`. Production builds exclude those routes.
