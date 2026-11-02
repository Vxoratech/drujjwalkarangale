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
| Appointment status transitions | `tests/db/rls.test.ts` (state machine, reasons, other doctors refused); `tests/unit/appointments.test.tsx` (actions by role and status, cancellation reason, **UI table matches the SQL trigger**) |
| Patient registration | `tests/unit/patients.test.tsx` (trimming, nulls, doctor self-assignment); `tests/db/rls.test.ts` (codes, assignment rules) |
| Prescription creation and revision | `tests/unit/prescriptions.test.tsx` (draft → review checkbox → issue; read-only issued view; revision needs a reason); `tests/db/tenancy.test.ts` and `dashboards.test.ts` (numbering, immutable revisions, clinician confirmation) |
| Role and permission boundaries | `tests/unit/AppShell.test.tsx` (navigation per role), `components.test.tsx` (guards); `tests/db/*` (admin vs doctor clinical separation, branch scope, platform boundary, admin sees issued prescriptions only) |
| Cross-tenant access denial | `tests/db/security.test.ts`: another clinic's owner is refused for **patient, appointment, prescription and documents** via tables, RPCs and storage; `tenancy.test.ts`: per-command matrix over 12 tables |
| Storage access rules | `tests/db/security.test.ts`, `tenancy.test.ts`, `rls.test.ts` (upload bound to a pending row, no direct reads, no planting, purge via service role only); `services/documents.test.ts` (type, size, safe names) |
| Currency calculations | `lib/formatters` (₹ formatting, paise conversion), `services/billing.test.ts` (client preview equals server rounding), `tests/db/*` (server totals, partial payments, refunds, cached totals equal the rows) |
| Marathi text rendering | `src/locales/i18n.test.ts` (key parity, fallback); `tests/unit/components.test.tsx`, `prescriptions.test.tsx` (Marathi labels and clinician text); `e2e/public.spec.ts` (Devanagari font actually loaded, `lang="mr"`, translated validation) |
| Responsive layouts | `e2e/public.spec.ts`: no horizontal scrolling on key pages at desktop, tablet (iPad Mini) and phone (Pixel 7) sizes; tables turn into cards on phones |
| Print output | `e2e/print.spec.ts` (A4 width, no clipped cells, rows not split across pages, 14-item Marathi prescription paginates to 2–4 pages, short one fits on 1, private notes never printed); `prescriptions.test.tsx` (print language independent of UI language) |
| Security guards | `tests/unit/security-guards.test.ts`, `hardcoded-strings.test.ts`, `migrations.test.ts` |

## End-to-end against a real backend

`e2e/clinic-flow.spec.ts` covers sign in → register patient → consultation with examination → finalize → prescription → clinician review → issue → print. It is **skipped** unless these are set, and must only be pointed at a **disposable** Supabase test project seeded with `npm run seed:demo`, never one with real patients:

```bash
E2E_SUPABASE_URL=… E2E_SUPABASE_ANON_KEY=… E2E_EMAIL=… E2E_PASSWORD=… npm run test:e2e
```

Without them, Playwright serves the app against an unreachable placeholder backend, so no test can touch real data. In CI, provide them as repository secrets to enable the flow.

## Fixtures

`src/dev/fixtures.ts` holds fictional records, used by component tests and by the dev-only pages `/__gallery` and `/__fixtures/prescription?lang=mr&items=14`. Production builds exclude those routes.
