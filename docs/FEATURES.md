# Feature status and acceptance criteria

Legend: ✅ implemented and tested · 🟡 implemented, needs live-stack verification · 🔜 planned / placeholder

> **Verification status.** DB rules (✅) are verified by automated tests against the real migrations in PGlite. UI flows marked 🟡 are type-checked, lint-clean and built, and their schemas/mappers are unit-tested, but they have **not yet been exercised end-to-end against a running Supabase stack** (Docker was unavailable in the build environment).

## Platform foundation

| Feature | Status | Acceptance criteria |
| --- | --- | --- |
| Multi-tenant schema with composite FKs | ✅ | A user in clinic B cannot read or insert clinic A rows; cross-tenant FK references are rejected |
| Data-driven RBAC, multi-role members | ✅ | `my_permissions()` returns the union of role grants; future roles need no schema change |
| Onboarding (`create_clinic`) | ✅ / 🟡 UI | Caller becomes admin (+doctor if practitioner) with a primary branch |
| Last-admin protection | ✅ | Removing or suspending the final admin raises an error |
| Audit log without PHI | ✅ | Inserts/updates/deletes on key tables record actor, action, entity, and changed field names only |
| Storage policies | ✅ | Patient files readable/writable only with clinical access; branding writable only with `settings.manage` |
| Env validation and service-key guard | ✅ | Missing env shows the config screen; a service-role key is refused |
| English / Marathi | ✅ | Every key exists in both dictionaries (test); language switch on auth screens, user menu, and profile |

## Auth

| Feature | Status | Acceptance criteria |
| --- | --- | --- |
| Sign in / sign up / forgot / set password | 🟡 | Zod-validated; errors shown without revealing whether an account exists; recovery and invite links route to set-password |
| Session handling | 🟡 | Protected routes redirect to sign-in and return to the original path; sign-out clears cached data |

## Admin workflows

| Feature | Status | Acceptance criteria |
| --- | --- | --- |
| Dashboard (role-aware) | 🟡 | Stats come from `dashboard_summary` (RLS-scoped); finance cards only with `billing.read` |
| Patients: list, search, sort, paginate, register, edit | ✅ DB / 🟡 UI | Search by name, ID or phone; phone masked in list; doctor-assignment restricted by RLS |
| Appointments: day view, filters, book, reschedule, check-in, cancel (reason), no-show | ✅ DB / 🟡 UI | Overlaps rejected; invalid transitions rejected; doctor notified |
| Billing: create invoice, record payment, void, print | ✅ DB / 🟡 UI | Server-computed totals; overpayment blocked; void only when unpaid; A4 print |
| Reports: revenue by day, by method, appointments by status | ✅ DB / 🟡 UI | `reports.read` required; range ≤ 1 year |
| Staff & access: list, invite (Edge Function), edit roles, suspend | 🟡 | Invite requires `users.manage` verified with the caller's JWT; roles the UI cannot assign yet are preserved |
| Clinic settings and branches | 🟡 | PIN, GSTIN, phone validated client- and server-side |
| Audit log viewer | 🟡 | Filter by record type; paginated; actor names resolved |

## Doctor workflows

| Feature | Status | Acceptance criteria |
| --- | --- | --- |
| Consultation editor (complaint, vitals + BMI, Ayurvedic exam, assessment, pathya/apathya, follow-up) | ✅ DB / 🟡 UI | Atomic save; opening from an appointment moves it to *in consultation*; finalize locks the record and completes the visit; unsaved-changes guard |
| Ayurvedic examination (Prakriti, Vikriti, Agni, Koshtha, Bala, Ashtavidha Pariksha, Sara, Satva) | ✅ DB / 🟡 UI | Enum-validated; locked with the consultation |
| Prescriptions (forms, dose, frequency, timing, anupana, duration) | ✅ DB / 🟡 UI | Atomic draft save; issue assigns `RX-YYYY-NNNNNN`; issued items are immutable; printable with signature block |
| Investigations: order, record result, upload report | ✅ DB / 🟡 UI | Random storage file names; signed-URL viewing |
| Draft queue and finalized list | 🟡 | Only the doctor's own records |

## Phases 4–6 additions

| Feature | Status | Acceptance criteria |
| --- | --- | --- |
| Per-command tenant isolation (SELECT / INSERT / UPDATE / DELETE) | ✅ | Matrix test over 12 tenant tables: another clinic's owner reads, updates and deletes nothing, and inserts are rejected |
| Policy coverage checks | ✅ | Every public table has RLS; no `true` policies except reference data; DELETE granted only where intended; `anon` has no table grants |
| Branch-level access (`member_branches`) | ✅ DB / 🟡 UI | Branch-scoped members see and act only on their branches' appointments, consultations and invoices |
| Platform (Super Admin) boundary | ✅ DB | Platform admins see clinic metadata only (no PHI); clinic admins cannot call platform RPCs or change clinic status; suspension blocks members |
| Subscriptions and plan limits | ✅ DB / 🟡 UI | Trial on signup; doctor, branch and staff limits enforced in the database; read-only plan card |
| Invitation acceptance | ✅ DB / 🟡 UI | Invited members get no access until they accept |
| Clinic picker, suspended screen, session expiry, access-change refresh | 🟡 | Expired tokens sign the user out with a notice; permissions are re-checked every 5 min, on window focus, and after any permission error |
| Patient status, occupation, approximate age, consents | ✅ DB / 🟡 UI | One active consent per type; consents are append-only except withdrawal |
| Patient documents via signed-URL Edge Function | ✅ DB / 🟡 UI | Upload bound to a pending row; no direct client reads of patient files; every open is audited; soft delete with reason |
| Extended Ayurvedic examination + clinic-configured fields | ✅ DB / 🟡 UI | Ama, dosha scores, Nidra, digestion, Dinacharya, family history; custom field keys and types validated server-side |
| Follow-ups | ✅ DB / 🟡 UI | Created on finalize; front desk books them atomically with `book_follow_up` |
| Prescription revisions, bilingual instructions, route/quantity, templates | ✅ DB / 🟡 UI | Each issue snapshots an immutable revision; revise needs a reason and keeps the number; templates are clinician-authored only |
| Receipts and refunds | ✅ DB / 🟡 UI | Receipt numbers per payment; refunds ≤ amount paid; refunds are immutable; cached totals match the rows (test) |
| Audit events | ✅ | Append-only even for the owner; patient views logged (throttled); membership changes record role transitions; no PHI values; retention purge only via the service role |
| Clinic time zone | ✅ | Calendar dates, numbering years and reports use `clinics.timezone`; the UI formats in it |
| Generated database and permission docs | ✅ | `docs/DATABASE.md` and `docs/PERMISSIONS.md` generated from migrations; CI fails if stale or if a table is unannotated |

## Phases 7–9 additions

| Feature | Status | Acceptance criteria |
| --- | --- | --- |
| Admin overview (patients, new registrations, today's appointments, completed consultations, pending/overdue follow-ups, net collections, outstanding, unreconciled payments) | ✅ DB / 🟡 UI | `clinic_overview()` returns counts and sums only, branch-scoped; refuses doctors and other clinics (tests) |
| Trends (registrations, appointments, consultations, collections) with 7/30/90-day ranges | ✅ DB / 🟡 UI | `clinic_trends()` buckets by day/week/month in the clinic time zone; each chart has a table view |
| Branch comparison | ✅ DB / 🟡 UI | `branch_metrics()` lists only branches in the caller's scope; shown only when more than one branch is visible |
| Recent clinic activity | 🟡 | Latest audit events for users with `audit.read` |
| Demo labelling | ✅ DB / 🟡 UI | `settings.demo` can be set only by trusted server code; dashboards show a "Demo data" notice |
| Appointment week view, branch assignment | 🟡 | Week starts Monday; branch picker appears when the clinic has several active branches |
| Prescription search (number, patient, doctor, status, dates), detail, revision history, print, EN/MR | ✅ DB / 🟡 UI | Admins see issued/cancelled prescriptions only, never drafts or consultation notes (tests) |
| Payment history, receipts, reconciliation | ✅ DB / 🟡 UI | Payment amounts are immutable; only reconciliation fields change, through `reconcile_payment()` with `payments.reconcile` |
| Access reviews and member last activity | ✅ DB / 🟡 UI | Append-only reviews by `users.manage`; 90-day review reminder |
| Clinic preferences (bilingual labels, default duration, prescription language, consultation sections) | ✅ DB / 🟡 UI | Unknown keys and wrong types are rejected by the database |
| Doctor workspace (queue, in-progress, completed today/month, follow-ups, recently opened patients) | ✅ DB / 🟡 UI | Counts are RLS-scoped to the doctor; recent patients come only from the doctor's own view events and drop out when access ends |
| Patient history form (रुग्णपत्रिका) | ✅ DB / 🟡 UI | See "Required fields" below |
| Amendments to finalized consultations | ✅ DB / 🟡 UI | Only the treating doctor, only after finalizing; append-only; record shows "Amended" |
| Clinician review before issuing | ✅ DB | `issue_prescription(id, true)` is required; the revision snapshot records the confirmation |
| Print layout | 🟡 | Rows, sections and the signature block avoid page breaks; table headers repeat on each A4 page |
| Bilingual UI | ✅ | Central dictionaries with English fallback (test); language switcher; Noto Sans Devanagari; optional bilingual labels "मराठी (English)"; no hardcoded strings in shared components (test) |

### Patient history form — required fields and why

| Field | Required | Reason |
| --- | --- | --- |
| Chief complaint | **Yes** | Every visit must record why the patient came; it identifies the visit in history and on prescriptions. |
| Patient identity (first name) | **Yes** (at registration) | Needed to identify the record. All other demographics are optional (data minimisation). |
| वेदना विशेष, present illness, past history | No | Relevant only to some complaints. |
| Family history (मातृज, पितृज, स्वकुल) | No | Recorded when it informs the case. |
| रजोइतिहास | No | Offered only when the patient is not recorded as male, and only if the clinic enables the section. |
| Vitals, दिनचर्या, सामान्य परीक्षण, Nadi, Prakriti, dosha observations | No | Clinician's judgement per visit; numeric vitals are range-checked when entered. |
| Investigations, attachments | No | Added as needed. |
| Doctor's clinical notes | No | Private working notes; never printed. |

Sections can be hidden clinic-wide in **Clinic Settings → Clinic preferences**. Hidden sections do not change existing records.

### Language handling

- The UI language (per user, stored in the browser and in `profiles.preferred_locale`) is separate from a patient's preferred language (`patients.preferred_locale`) and from a prescription's print language (`prescriptions.language`).
- Medicine names, doses and clinician-written instructions are never machine-translated. The prescription stores separate English and Marathi instructions written by the clinician; printing uses the prescription's language and shows the other language only when that one is empty.
- Numbers and dates use Latin digits with Indian grouping (₹1,23,456.78) and DD/MM/YYYY in both languages for consistency with printed records and payment systems.
- Messages raised by database rules (e.g. "Payment exceeds the outstanding balance") are currently shown in English; generic errors are translated.

## Planned / not yet implemented 🔜

- UI for the provisioned roles (Receptionist, Accountant, Pharmacist, Branch Manager). Their permission mappings already exist.
- Super Admin platform console (cross-tenant operations belong in a separate service-role backend, not tenant RLS).
- Credit notes; GST-compliant tax invoice format (HSN/SAC, CGST/SGST split); a medicine/inventory catalogue.
- Platform console UI (the `platform_*` RPCs exist); payment-provider integration for subscriptions.
- Clinic logo upload UI (the storage policy exists); doctor signature images on prescriptions.
- Patient archiving UI (the `archived_at` column exists); merging duplicate patients.
- SMS/WhatsApp reminders; email notifications; a realtime notification push (polling every 60 s today).
- Branch filter controls on list screens (scope is enforced; explicit filters are not built yet).
- Read-access logging beyond patient records and documents (e.g. consultation views); data-export tooling for DPDP Act requests.
- E2E tests (Playwright) against a seeded local Supabase stack; pgTAP suite.
- Marathi copy review by a native-speaking clinician.
- Translated database rule messages (currently English).
- Export to PDF/CSV files (printing uses the browser's "Save as PDF").
