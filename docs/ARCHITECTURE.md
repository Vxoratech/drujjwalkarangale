# Vaidyora — Architecture

## 1. Overview

```
Browser (React SPA, anon key only)
   │  supabase-js (PostgREST / RPC / Storage / Functions)
   ▼
Supabase
 ├─ Auth ............ email + password, invites, password recovery
 ├─ PostgreSQL ...... tenant data, RLS on every table, SECURITY DEFINER RPCs for privileged writes
 ├─ Storage ......... private bucket `clinic-files`, path-scoped policies
 └─ Edge Functions .. `invite-member` (needs the service role to call the Auth admin API)
```

## 2. Multi-tenancy

- **Tenant = clinic.** Every tenant-owned row has `clinic_id`.
- **Composite foreign keys** (`(patient_id, clinic_id) → patients(id, clinic_id)`) make cross-tenant references impossible at the schema level, even through a buggy client or a service-role script.
- `clinic_id` is immutable after insert (`private.prevent_clinic_change` trigger).
- The **active clinic** in the UI is a preference stored in `localStorage`, checked against the user's server-side memberships. Switching clinics drops the previous tenant's cached queries. Every TanStack Query key starts with the clinic id.

## 3. Authorization (RBAC)

- `app_role` enum: `super_admin, admin, doctor, receptionist, accountant, pharmacist, branch_manager`.
- A member can hold **several roles** in a clinic (`clinic_members.roles app_role[]`), e.g. an owner who is both Admin and Doctor.
- `permissions` and `role_permissions` are reference data seeded by migration. Mappings for the future roles already exist, so enabling a role is a data change.
- Policy helpers in the non-exposed `private` schema: `has_permission`, `is_member`, `is_doctor_of_patient`, `can_read_patient`, `can_read_clinical`, `can_write_clinical`.
- **Clinical separation:** Admin-only users manage patients, schedule, and billing but cannot read consultation notes, examinations, prescriptions, or investigations. Doctors see only patients assigned to them or booked with them.
- The frontend mirrors permissions (`useClinic().can`, `<Can>`, `<RequirePermission>`) to shape navigation and actions. It never makes the authorization decision.

| Area | Admin | Doctor |
| --- | --- | --- |
| Patients | all: create / edit | assigned or booked only: create (self-assigned) / edit |
| Appointments | whole schedule: book / reschedule / cancel | own schedule: status updates only |
| Consultations, Ayurvedic exam, Rx, investigations | — | read and write for own patients; finalize own |
| Billing, payments, reports | ✓ | — |
| Settings, branches, staff, audit log | ✓ | — |

## 4. Data integrity

| Rule | Where enforced |
| --- | --- |
| No double-booking a doctor | `EXCLUDE USING gist (doctor_id, tstzrange)`, ignoring cancelled/no-show |
| Appointment state machine | `private.validate_appointment_status` trigger |
| Finalized consultations are immutable | trigger plus RLS (`status = 'draft'` for updates) |
| Issued prescriptions are immutable; numbering only via `issue_prescription()` | trigger plus RLS `WITH CHECK` |
| Invoice totals computed server-side; overpayment blocked; row locks | `create_invoice`, `record_payment`, `void_invoice` RPCs |
| Money in integer paise | `bigint` columns; `rupeesToPaise()` on input |
| Sequential human-readable numbers per clinic (`P-000001`, `RX-2026-000001`, `INV-2026-000001`) | `private.next_number` (atomic upsert) |
| A clinic always keeps one active admin | `protect_last_admin` trigger |
| Consultation + examination save atomically; prescription items replaced atomically | `save_consultation`, `save_prescription_draft` (SECURITY INVOKER, so RLS still applies) |

## 5. Frontend structure

```
src/
  app/            App, router (lazy routes + guards), layouts (AppShell, AuthLayout), navigation config
  components/
    ui/           Button, Input/Select/Textarea/Checkbox/RadioGroup/DateInput/SearchInput, Card/StatCard,
                  Badge/StatusBadge, Tabs/SegmentedControl, DropdownMenu, Modal/ConfirmDialog/Drawer,
                  Tooltip, PageHeader/Breadcrumb/Toolbar, BrandMark
    forms/        FormField (label/hint/error/ARIA wiring), FormSection, FormGrid, FileUpload
    data-display/ DataTable (sort, pagination, mobile cards), Pagination, Avatar/PatientIdentity,
                  Timeline, AuditEvent, PrintableDocument (A4 letterhead)
    feedback/     Empty / Error / PermissionDenied / Skeleton / Spinner / Alert, toast (safe messages)
  features/       auth, clinic (tenant context, onboarding), dashboard, patients, appointments,
                  consultations, prescriptions, investigations, billing, reports, users,
                  clinic-settings, audit-logs
  services/       data access: typed functions over supabase-js (the only place that talks to Supabase)
  lib/            env, supabase client, query client + keys, permissions, formatters, errors, validation
  locales/        en, mr dictionaries + typed i18n provider (missing keys fail the type check)
  styles/         tokens.css (single source of design tokens), index.css
  types/          domain types matching the schema
```

Layering: **page/component → feature hook (TanStack Query) → service → Supabase**. Validation lives in Zod schemas next to each feature, with pure `to*Payload` mappers that have their own tests.

## 6. Design system

Tokens live in `src/styles/tokens.css` (colors, type scale, spacing, layout widths, radii, shadows, z-index, motion, focus ring); `tailwind.config.ts` only maps onto them.

- Text: `#29332D`. Muted text is darkened to `#5F6A60` for 4.5:1 contrast; brand `#7D877D` is reserved for large or non-essential text.
- Antique Gold `#E5D1A0` is used for fills and highlights only. Gold *text* uses `--color-gold-ink #7A5D1A` for AA contrast.
- Manrope for display, DM Sans for UI, Noto Sans Devanagari as the Marathi fallback. Tabular numerals (`.tabular`) for money, dates, and IDs.
- Accessibility: visible focus ring, skip link, labelled icon buttons, `aria-sort` on tables, a WAI-ARIA combobox for patient search, `role=alert` on errors, and reduced-motion support.

## 7. Privacy

- Phone numbers are masked in list views.
- Notification titles are generic (no patient names).
- Uploaded files get random names (original names can contain PHI) in a private bucket, served through short-lived signed URLs.
- Route errors log only the error name.
- Signing out clears the query cache.

## 8. Testing

- `tests/db/*.test.ts` applies the **real migrations** to PGlite with minimal `auth`/`storage` stand-ins, then exercises RLS as different users: tenant isolation, doctor scoping, clinical separation, state machines, immutability, billing math and overpayment, audit-log PHI-freedom, storage scoping, and transactional rollback.
- Unit tests cover formatters (IST, INR, paise), error sanitising, env/service-key detection, the permission algebra, i18n key parity, and every form schema and mapper.
- Component tests cover FormField ARIA wiring, Button, DataTable sorting and empty state, RadioGroup and SegmentedControl, ConfirmDialog failure handling, guards, and role-based shell navigation.

PGlite is not the Supabase runtime. Before release, also run against a local Supabase stack (`supabase start`) and add pgTAP tests with `supabase test db`.
