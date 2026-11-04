# Vaidyora — Environment setup and deployment

Three environments are assumed: **local** (your machine), **staging** (a disposable Supabase project for tests and demos) and **production** (real patients, only after the release blockers in [RELEASE.md](RELEASE.md) are cleared). Use a separate Supabase project for each, and never reuse production keys elsewhere.

## 1. Prerequisites
- Node 20+ (CI uses 22), npm
- [Supabase CLI](https://supabase.com/docs/guides/cli) 2.x, logged in (`supabase login`)
- Docker, for a local Supabase stack only (optional; the database tests use PGlite and need no Docker)

## 2. Local development
```bash
npm install
supabase start                  # local Postgres, Auth, Storage, Studio
cp .env.example .env.local      # paste the API URL and anon key printed by `supabase start`
npm run dev                     # http://localhost:5173
```
Optional fictional demo data:
```bash
SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=<anon> SUPABASE_SERVICE_ROLE_KEY=<service-role> DEMO_PASSWORD='<choose>' npm run seed:demo
```

## 3. Supabase project setup (staging or production)

| # | Step | How | Status for **Dr-UjjwalKarangale** |
| --- | --- | --- | --- |
| 1 | Create the project in the intended **region** | Dashboard. Consider an Indian region (`ap-south-1`, Mumbai) for health data; see [SECURITY.md §13](SECURITY.md#13-regulatory-position-not-a-compliance-claim) | Created in `ap-southeast-2` (Sydney); review |
| 2 | Link the repo | `supabase link --project-ref <ref>` | ✅ linked |
| 3 | Apply migrations | `supabase db push --dry-run`, review, then `supabase db push`. (03/11/2026: the database was reset to the single-organization baseline with `supabase db reset --linked`; never do that once real data exists.) | ✅ 0100–0500 applied |
| 4 | Check the schema | `supabase db lint --linked` | ✅ no issues |
| 5 | **Turn off public sign-up** | Authentication → Sign In / Providers → disable **Allow new users to sign up**. Invitations still work. | ⏳ to do (sign-ups currently create accounts with no access) |
| 6 | Auth URLs | Authentication → URL configuration: **Site URL** = app origin; add the same origin to redirect URLs (invites and resets land on `/auth/set-password`) | ⏳ to do |
| 7 | Auth policy | Minimum password length 10, mixed case and digits; refresh-token rotation on; rate limits as in `supabase/config.toml` (`config.toml` affects local stacks only) | ⏳ to do |
| 8 | Email (SMTP) | Configure a real SMTP sender for invites and resets; the built-in sender is heavily rate-limited | ⏳ to do |
| 9 | Edge Function secrets | `supabase secrets set SITE_URL=https://app.example.in ALLOWED_ORIGINS=https://app.example.in` (`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically) | ⏳ to do |
| 10 | Deploy Edge Functions | `supabase functions deploy staff-admin` and `supabase functions deploy document-url` | ⏳ **not deployed**: staff invitations and opening documents need them |
| 11 | **Bind the primary doctor** | `npm run bootstrap` with `DOCTOR_EMAIL` (and optionally `ADMIN_EMAIL`), or in the SQL editor after creating the auth user: `select public.bootstrap_primary_doctor('<email>');`. Runs once; the binding is permanent. | ⏳ to do |
| 12 | Branches and staff | In the app: Branch Management (rename **Main Clinic**, add branches, working hours), then Staff Management | ⏳ after 11 |
| 13 | Scheduled jobs | Enable `pg_cron` and schedule (as the service role): `select public.purge_expired_audit_events();` daily; `select public.purge_abandoned_uploads();` hourly, plus a small job that deletes the returned storage paths through the Storage API | ⏳ to do |
| 14 | Backups | Enable **Point-in-Time Recovery** (production), plus a scheduled copy of the `clinic-files` bucket | ⏳ to do |

## 4. Frontend build and hosting
```bash
npm ci
npm run lint && npm run typecheck && npm test && npm run build    # output: dist/
```
Set at build time (public values only):

| Variable | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://<ref>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | the project's **anon / publishable** key (never the service-role key; the app refuses to start with one) |
| `VITE_APP_ENV` | `production`, `staging` or `development` (non-production shows a banner) |

Host `dist/` on any static host (Vercel, Netlify, Cloudflare Pages, S3 + CloudFront) with:
- **SPA fallback:** every path serves `index.html`.
- **HTTPS only**, with HSTS.
- **Security headers** (adjust the Supabase origin):
  ```
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob: https://<ref>.supabase.co; connect-src 'self' https://<ref>.supabase.co wss://<ref>.supabase.co; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
  Referrer-Policy: strict-origin-when-cross-origin
  X-Content-Type-Options: nosniff
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  ```
- **Cache:** `assets/*` immutable for a long time; `index.html` with `no-cache`.

The dev-only routes `/__gallery` and `/__fixtures/*` are not included in production builds.

## 5. Release procedure
1. All CI jobs green on the pull request (lint, typecheck, unit, database, E2E, docs up to date, build).
2. `supabase db push --dry-run` against **staging**, review, push; run `npm run test:e2e` with the staging `E2E_*` values.
3. Take a backup (or note the PITR timestamp) of **production**.
4. `supabase db push` to production; deploy any changed Edge Functions; deploy the frontend.
5. Smoke test: sign in as the doctor and as a test staff account, open a patient, book and cancel a test appointment, print a prescription, and confirm the staff account cannot open consultations.
6. Rollback: frontend → redeploy the previous build; database → forward-fix migration (preferred) or PITR restore for data damage.

## 6. Monitoring
Attach an error provider with `setErrorSink()` in `src/main.tsx` (for example Sentry with `sendDefaultPii: false`, no replay, no request bodies). Reports carry only error type and code plus the route pattern. Watch Supabase logs for `429` and `54000` (rate limits) and for `42501` spikes (possible probing).
