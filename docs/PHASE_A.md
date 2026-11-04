# Vaidyora — Phase A: audit and architecture

> **Superseded:** revision 2 (single organization, one doctor, many branches) is in [ARCHITECTURE.md](ARCHITECTURE.md). This page records the original multi-tenant design.

The ten deliverables the brief asks for before implementation, in one place. Each section is a summary; the linked documents hold the detail (several are generated from the migrations, so they can't drift).

## 1. Repository audit
- **Starting point (25/10/2026):** `Vxoratech/drujjwalkarangale` had one commit containing a two-line `README.md`. There was no framework, no dependencies, no routes, no environment configuration and no business logic to preserve.
- **Consequence:** the project was created from scratch with the stack the brief requires. There was no existing working code to replace, so nothing was removed.
- **Today:** four feature commits on `feature/vaidyora-foundation` ([PR #1](https://github.com/Vxoratech/drujjwalkarangale/pull/1)). The hosted Supabase project `Dr-UjjwalKarangale` has migrations 0001–0014 applied; 0015 is pending.

## 2. Proposed system architecture
```
Browser — React 18 SPA (Vite, TypeScript strict), anon key only
  │  TanStack Query → typed services (src/services/*)
  ▼
Supabase
  ├─ Auth ........... email/password, invitations, recovery, refresh-token rotation
  ├─ PostgreSQL ..... RLS on every table · SECURITY DEFINER RPCs for money, numbering, state machines, aggregates
  ├─ Storage ........ private bucket, path-bound upload policy, no direct reads of patient files
  └─ Edge Functions . invite-member (Auth admin API) · document-url (audited 60 s signed URLs)
```
Key decisions:
- RLS is the primary isolation boundary.
- Permissions are data, and a member can hold several roles.
- Composite foreign keys `(id, clinic_id)` make cross-tenant references impossible.
- Money is integer paise.
- Clinical records are immutable once finalized or issued; corrections are amendments or revisions.
- The audit log never holds clinical values.

Detail: [ARCHITECTURE.md](ARCHITECTURE.md).

## 3. Frontend module and folder structure
```
src/
  app/          App, router (lazy routes + guards), layouts (AppShell, AuthLayout), navigation config, route errors
  components/   ui/ · forms/ · data-display/ · feedback/  (≈30 shared, typed, accessible components)
  features/     auth · clinic · dashboard · patients · appointments · consultations · prescriptions ·
                investigations · documents · follow-ups · billing · reports · users · clinic-settings · audit-logs
  services/     one module per domain; the only place that calls Supabase
  hooks/        useDoctors, useDebouncedValue, useUnsavedChangesGuard, useIdempotencyKey
  lib/          env, supabase client, query client + keys, permissions + guards, formatters, errors, validation, monitoring
  locales/      en, mr dictionaries + typed i18n provider
  styles/       tokens.css (single source of design tokens), index.css (base + print)
  types/        domain types
  dev/          gallery, fictional fixtures, print fixture (development builds only)
```
Rule: page → feature hook → service → Supabase. Components never import `supabase-js`.

## 4. Database entity relationship design
- **31 tables in five domains:** tenancy and identity; patients and scheduling; clinical records; billing; audit and notifications.
- Mermaid diagrams are generated from the foreign keys: [ERD.md](ERD.md).
- Every column, constraint, index and per-command policy: [DATABASE.md](DATABASE.md).
- **Tenant model:**
  - The tenant is the **clinic**.
  - Branches belong to a clinic.
  - Users join clinics through `clinic_members` (roles, status, default branch), with optional `member_branches` scope.
  - Platform operators sit outside the tenant model entirely.

## 5. Admin / Doctor permission matrix
Generated from `role_permissions`: [PERMISSIONS.md](PERMISSIONS.md). In short:

| Area | Admin | Doctor |
| --- | --- | --- |
| Patients | all; register, edit | assigned or booked only; register (self-assigned), edit |
| Appointments | whole schedule; book, reschedule, cancel | own schedule; status updates |
| Consultations, examinations, investigations, documents | counts only, never contents | read and write for own patients |
| Prescriptions | issued ones: search, view, print | write own; issue with confirmation; revise |
| Billing, payments, refunds, reconciliation, reports | ✓ | — |
| Settings, branches, staff, access reviews, audit log | ✓ | — |

Receptionist, Accountant, Pharmacist and Branch Manager are configured in data and can be enabled without schema changes. Super Admin is a separate platform boundary with no tenant data access.

## 6. RLS and tenant-isolation strategy
1. `clinic_id` on every tenant row, immutable (trigger), with composite foreign keys to parents.
2. Policies per command, built from `private.has_permission`, `is_member`, `can_read_patient`, `can_read_clinical` and `in_branch_scope`. All of these derive access from `auth.uid()`, never from client input.
3. No `anon` grants; no "authenticated means allowed" policies (except two reference tables); `DELETE` granted on two tables only.
4. Privileged writes go through definer RPCs that load the row `FOR UPDATE` and check permission against that row's clinic.
5. Storage: uploads are bound to a pending metadata row; there are no client reads of patient files; downloads go through an audited Edge Function.
6. Caches are keyed by clinic and dropped on switch or sign-out.
7. **Proof:** 102 database tests, including an attack suite in which another clinic's owner tries every route to a patient, appointment, prescription and documents. See [SECURITY.md](SECURITY.md).

## 7. API / service contracts
For every service: what it's responsible for, which mechanism it uses (direct table access under RLS, RPC, or Edge Function), request and response, authentication, authorization, validation, errors and idempotency. See [API.md](API.md).

## 8. Design system specification
- **Tokens** in `src/styles/tokens.css`:
  - Forest #31583F, Deep Forest #233A2C, Soft Sage #E7EEE4, Antique Gold #E5D1A0 (fills only; gold text uses #7A5D1A for contrast), Warm Ivory #F7F5EF;
  - text #29332D, with muted text darkened to #5F6A60 for AA contrast;
  - accessible status colours, and scales for type, spacing, radii, shadows, z-index and motion, plus the focus ring.
- **Type:** Manrope for display, DM Sans for UI, Noto Sans Devanagari for Marathi; tabular numerals for figures.
- **Components:** buttons, inputs, select, checkbox, radio, date, search, form field, card, stat card, data table (sort, paginate, mobile cards), badges, avatar and patient identity, tabs, segmented control, dropdown, modal, confirm dialog, drawer, toast, tooltip, breadcrumb, page header and toolbar, sidebar and top bar, empty/skeleton/error/permission states, pagination, file upload with progress, timeline, audit event, column chart, printable A4 document.
- **Layout:** collapsible sidebar on desktop, drawer on tablet and mobile; single-column forms on phones; no horizontal page scroll.
- **Accessibility:** WCAG 2.2 AA target; keyboard support, visible focus, labelled controls; axe-clean on reachable screens.

Live reference: `/__gallery` (development builds).

## 9. Phased implementation plan
| Phase | Scope | Status |
| --- | --- | --- |
| A | Audit and architecture | ✅ this document |
| B | Design foundation | ✅ |
| C | Backend foundation | ✅ (0015 pending on hosted) |
| D | Core workflows 1–11, in the brief's order | ✅ (live click-through pending) |
| E | Production hardening | ✅ code; blockers listed in [RELEASE.md](RELEASE.md) |

Reports per phase: [PHASE_REPORTS.md](PHASE_REPORTS.md). Definition-of-done status per feature: [DEFINITION_OF_DONE.md](DEFINITION_OF_DONE.md).

## 10. Key technical risks and assumptions
**Risks**
1. **Signed-in screens not yet exercised against a live backend:** mitigated by unit and component tests plus 102 DB tests; resolved by the live E2E run.
2. **Hosted project pauses on the free tier:** it is paused now, so pushes and testing are blocked until it's restored or upgraded.
3. **Region and legal position unreviewed** for health data (Sydney today).
4. **Open React Router v7 and zod 4 advisories:** low exposure and mitigated; upgrades tracked.
5. **Edge Functions not deployed:** staff invites and document opening don't work on hosted yet.
6. **Clinical vocabulary and Marathi wording** need practitioner review.

**Assumptions** (each changeable):
- a member can hold multiple roles;
- admins never read clinical notes but can reprint issued prescriptions;
- paise storage, with GST per line and the discount on the total;
- only the chief complaint is required;
- a subscription lapse never blocks clinical access;
- India-first defaults (Asia/Kolkata, DD/MM/YYYY, INR, Monday weeks, Latin digits).

**Demo-only behaviour, labelled as such:**
- the `/__gallery` and `/__fixtures/*` pages exist in development builds only;
- `settings.demo` shows a "Demo data" notice on dashboards;
- the seed script creates fictional people on `.test` domains;
- non-production environments show a banner.

Nothing fakes a backend: without Supabase configuration the app shows "Backend not configured".
