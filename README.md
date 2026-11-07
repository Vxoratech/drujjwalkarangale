# Vaidyora

**Vaidyora by Vxora Tech** — *Ancient Wisdom. Modern Practice.*

Clinic management for **Dr. Ujjwal Karangale's Ayurvedic clinic**: one organization, several branches, one doctor, and a staff whose access is set per person. English and Marathi, INR, Asia/Kolkata, DD/MM/YYYY.

- **Primary doctor** (Dr. Ujjwal): the only clinical author. Consultations, examinations and prescriptions are doctor-only permissions that can never be granted to anyone else.
- **Administrators**: run the clinic across all branches, with read-only clinical access. Only the doctor can appoint them.
- **Staff** (receptionist, coordinator, accountant, billing executive, assistant, branch manager, custom): a role template plus individual grants and denies, limited to their assigned branches.
- **Patients** have one central profile across branches; every visit, bill and document records the branch that handled it.

There is no public sign-up and no way to register another clinic or doctor.

| Layer | Stack |
| --- | --- |
| Frontend | React 18, TypeScript (strict), Vite, Tailwind CSS, React Router, TanStack Query, React Hook Form + Zod, Radix UI, Lucide, Sonner |
| Backend | Supabase: Auth, PostgreSQL with Row Level Security, Storage, Edge Functions |
| Tests | Vitest + Testing Library; PGlite (real Postgres in WASM) for migrations, RLS and functions; Playwright + axe |

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) first. Then [PERMISSIONS.md](docs/PERMISSIONS.md) (generated matrix), [DATABASE.md](docs/DATABASE.md) and [ERD.md](docs/ERD.md) (generated), [API.md](docs/API.md), [SECURITY.md](docs/SECURITY.md), [DEPLOYMENT.md](docs/DEPLOYMENT.md), [RELEASE.md](docs/RELEASE.md) (blockers), [FEATURES.md](docs/FEATURES.md), [USER_JOURNEYS.md](docs/USER_JOURNEYS.md) and [PHASE_REPORTS.md](docs/PHASE_REPORTS.md).

## Quick start (local)

Prerequisites: Node 20+, the [Supabase CLI](https://supabase.com/docs/guides/cli), and Docker (for the local Supabase stack).

```bash
npm install
supabase start                 # local Postgres/Auth/Storage; applies supabase/migrations
cp .env.example .env.local     # then paste the local API URL and anon key printed by `supabase start`
npm run dev                    # http://localhost:5173
```

Without `.env.local` the app shows a **Backend not configured** screen. It never pretends to work without a backend.

### First-time setup: the doctor and the first administrator

The organization and its primary branch are created by the migrations. The doctor is bound once, by trusted setup (never from the app):

```bash
SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<service-role> SITE_URL=<app url> \
DOCTOR_EMAIL=<doctor's email> ADMIN_EMAIL=<optional admin email> ADMIN_NAME='<name>' npm run bootstrap
```

Both receive an invitation email and set their own password. After that, all staff are added in **Staff Management**. The SQL editor equivalent is `select public.bootstrap_primary_doctor('<email>');` once the auth user exists.

### Demo data (optional, local or disposable staging only)

```bash
SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=<anon> SUPABASE_SERVICE_ROLE_KEY=<service-role> DEMO_PASSWORD='<choose one>' npm run seed:demo
```

Creates the doctor, an admin, a second branch, a receptionist, an accountant and a branch manager (`…@demo.vaidyora.test`), with fictional patients, appointments, a finalized consultation and an invoice. It refuses a hosted `*.supabase.co` project unless `ALLOW_REMOTE_SEED=yes`.

### Edge Functions

`staff-admin` (staff invitations, password resets, activation and sign-in blocking, administrator appointment) and `document-url` (audited, short-lived links to patient files):

```bash
supabase functions serve --env-file supabase/functions/.env
```

`supabase/functions/.env` (git-ignored) needs `SITE_URL` and `ALLOWED_ORIGINS`. Supabase injects `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` automatically.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server (also serves the dev-only component gallery at `/__gallery`) |
| `npm run build` | Typecheck and production build |
| `npm run lint` | ESLint (strict TS rules, no `any`) |
| `npm test` | Unit, component and database/RLS tests |
| `npm run test:e2e` | Playwright end-to-end tests (see [docs/TESTING.md](docs/TESTING.md)) |
| `npm run test:db` | Database tests only (migrations + RLS + functions in PGlite) |
| `npm run bootstrap` | Bind the primary doctor and appoint the first administrator (service role) |
| `npm run seed:demo` | Seed fictional demo data (see above) |
| `npm run docs:db` | Regenerate `docs/DATABASE.md`, `docs/PERMISSIONS.md` and `docs/ERD.md` from the migrations |

## Security essentials

- The browser only ever gets the **anon/publishable** key. `readEnv()` refuses to start if a service-role key is put in a `VITE_*` variable.
- Every table has RLS. Effective permissions are computed in the database (`private.can`, `private.can_at`); the UI reads `my_access()` only to decide what to show.
- Exactly one organization and at most one primary doctor are enforced by constraints; nobody can edit their own access, and doctor-only permissions are rejected by trigger anywhere but the doctor's role.
- Money-moving and numbering operations run as server-side functions inside a single transaction, idempotent on a request key.
- Audit logs store who, what, which branch, which **field names** changed and which permission keys were granted or revoked, never clinical values.
