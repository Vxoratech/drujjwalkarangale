# Vaidyora

**Vaidyora by Vxora Tech** — *Ancient Wisdom. Modern Practice.*

A multi-tenant clinic-management SaaS for Ayurvedic clinics and practitioners in India. English and Marathi, INR, Asia/Kolkata, DD/MM/YYYY.

| Layer | Stack |
| --- | --- |
| Frontend | React 18, TypeScript (strict), Vite, Tailwind CSS, React Router, TanStack Query, React Hook Form + Zod, Radix UI, Lucide, Sonner |
| Backend | Supabase: Auth, PostgreSQL with Row Level Security, Storage, Edge Functions |
| Tests | Vitest + Testing Library (unit/components); PGlite (real Postgres in WASM) for migrations, RLS and RPC tests |

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design and [docs/FEATURES.md](docs/FEATURES.md) for what is implemented, the acceptance criteria, and what is still planned.

## Quick start (local)

Prerequisites: Node 20+, the [Supabase CLI](https://supabase.com/docs/guides/cli), and Docker (for the local Supabase stack).

```bash
npm install
supabase start                 # local Postgres/Auth/Storage; applies supabase/migrations
cp .env.example .env.local     # then paste the local API URL and anon key printed by `supabase start`
npm run dev                    # http://localhost:5173
```

Without `.env.local` the app shows a **Backend not configured** screen. It never pretends to work without a backend.

### Demo data (optional)

Seeds a fictional clinic with three users (owner doctor, admin, doctor), patients, appointments, a finalized consultation, an issued prescription, and invoices. The password comes from your shell; it is never committed.

```bash
SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=<anon> SUPABASE_SERVICE_ROLE_KEY=<service-role> DEMO_PASSWORD='<choose one>' npm run seed:demo
```

Sign in as `dr.ujjwal@demo.vaidyora.test` (admin + doctor), `admin@demo.vaidyora.test` (admin) or `dr.meera@demo.vaidyora.test` (doctor). The script refuses to run against a hosted `*.supabase.co` project unless `ALLOW_REMOTE_SEED=yes`.

### Staff invitations (Edge Function)

```bash
supabase functions serve invite-member --env-file supabase/functions/.env
```

`supabase/functions/.env` (git-ignored) needs `SITE_URL` and `ALLOWED_ORIGINS`. Supabase injects `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` automatically.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server (also serves the dev-only component gallery at `/__gallery`) |
| `npm run build` | Typecheck and production build |
| `npm run lint` | ESLint (strict TS rules, no `any`) |
| `npm test` | All tests: unit, component, and database/RLS |
| `npm run test:db` | Database tests only (migrations + RLS + RPCs in PGlite) |
| `npm run db:types` | Generate full Supabase types from the local DB |
| `npm run seed:demo` | Seed the fictional demo clinic (see above) |

## Security essentials

- The browser only ever gets the **anon/publishable** key. `readEnv()` refuses to start if a service-role key is put in a `VITE_*` variable.
- Every tenant table has RLS. Permissions are data (`role_permissions`), and the UI reads them through `my_permissions()` only to decide what to show; the database enforces them.
- Money-moving and numbering operations (invoices, payments, issuing prescriptions, finalizing consultations) run as server-side RPCs inside a single transaction.
- Audit logs store who, what, and which **field names** changed, never the values, so they hold no PHI.
- User-facing errors go through `toUserMessage()`, which only passes through messages our own SQL raises deliberately.
