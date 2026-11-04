# Feature status and acceptance criteria

Legend: ✅ implemented and tested · 🟡 implemented, needs live-stack verification · 🔜 planned / placeholder

> **Verification status.** DB rules (✅) are verified by automated tests against the real migrations in PGlite. UI flows marked 🟡 are type-checked, lint-clean and built, and their schemas/mappers are unit-tested, but they have **not yet been exercised end-to-end against a running Supabase stack** (Docker was unavailable in the build environment).

## Organization, identity and access

| Feature | Status | Acceptance criteria |
| --- | --- | --- |
| One organization, many branches | ✅ | Exactly one organization row (a second insert or a delete is refused); a primary branch that cannot be deactivated |
| One primary doctor | ✅ | Bound once by trusted setup; cannot be replaced, demoted, deactivated or duplicated, even by the database owner |
| Administrators | ✅ DB / 🟡 UI | Appointed only by the doctor (Edge Function); all branches; clinical read-only |
| Configurable staff permissions | ✅ DB / 🟡 UI | Template ∪ grants − denies; doctor-only keys refused by trigger; no self-elevation; delegated managers grant only what they hold |
| Branch scope | ✅ DB / 🟡 UI | Staff see appointments, visits, bills, documents, reports and audit events of assigned branches only |
| Invitation lifecycle | ✅ DB / 🟡 UI | Invited staff have no access until they accept; deactivation needs a reason, removes access at once and blocks sign-in |
| No public registration | ✅ | No sign-up page or link; staff-record linking only to the invited email and only for `staff` accounts |
| Audit log without PHI | ✅ | Row changes, views, document access and permission changes (keys granted and revoked), with branch; never values |
| Storage policies | ✅ | Upload only to a pending document row with `investigations.upload`; no direct reads; branding writable with `settings.organization` |
| Env validation and service-key guard | ✅ | Missing env shows the config screen; a service-role key is refused |
| English / Marathi | ✅ | Every key exists in both dictionaries (test); Marathi is machine-assisted and needs review (B8) |

## Auth

| Feature | Status | Acceptance criteria |
| --- | --- | --- |
| Sign in / forgot / set password | 🟡 | Zod-validated; errors don't reveal whether an account exists; invite and recovery links route to set-password |
| Access gate | 🟡 | Invited → accept screen; deactivated or no access → explanation; access refreshed every 2 minutes and on focus |

## Admin workflows

| Feature | Status | Acceptance criteria |
| --- | --- | --- |
| Admin dashboard | ✅ DB / 🟡 UI | All-branches or single-branch filter; patients, active branches, today's appointments, consultations completed, follow-ups, collections, outstanding invoices, branch performance, staff activity, recent events |
| Staff dashboards | ✅ DB / 🟡 UI | Sections appear only with the matching report permission; figures limited to the user's branches |
| Patients: central profile, search, register with duplicate review, edit | ✅ DB / 🟡 UI | One profile across branches; likely duplicates (phone, similar name + age) must be reviewed before registering, never merged automatically; contact-only editors cannot change identity fields; medical history separate and permission-gated |
| Appointments: day/week view, branch filter, book, reschedule, check-in, cancel (reason), no-show | ✅ DB / 🟡 UI | One calendar for Dr. Ujjwal (no overlap across branches); active branch and working hours enforced; separate permissions per action; doctor notified |
| Billing: create invoice, record payment, void, print | ✅ DB / 🟡 UI | Server-computed totals; overpayment blocked; void only when unpaid; A4 print |
| Reports: operational, financial, clinical | ✅ DB / 🟡 UI | Each section needs its own permission; branch filter; range ≤ 1 year; counts and sums only |
| Staff Management: list, Add Staff wizard, permission editor, branches, invite, reset, deactivate, history | ✅ DB / 🟡 UI | Sensitive grants need confirmation; changes audited; managers act within their branches |
| Roles & Permissions: template editor | ✅ DB / 🟡 UI | Account roles fixed; built-in templates editable, not deletable; in-use templates cannot be deleted |
| Branch Management: branches, contact, manager, working hours | ✅ DB / 🟡 UI | Branch settings holders edit contact details and hours of their branches only; overlapping hours refused |
| Clinic settings | 🟡 | Organization profile, numbering, fee, time zone, preferences, examination fields; `settings.organization` |
| Audit log viewer | 🟡 | Filter by record type; paginated; actor names resolved |

## Doctor workflows

| Feature | Status | Acceptance criteria |
| --- | --- | --- |
| Consultation editor (complaint, vitals + BMI, Ayurvedic exam, assessment, pathya/apathya, follow-up) | ✅ DB / 🟡 UI | Atomic save; opening from an appointment moves it to *in consultation*; finalize locks the record and completes the visit; unsaved-changes guard |
| Ayurvedic examination (Prakriti, Vikriti, Agni, Koshtha, Bala, Ashtavidha Pariksha, Sara, Satva) | ✅ DB / 🟡 UI | Enum-validated; locked with the consultation |
| Prescriptions (forms, dose, frequency, timing, anupana, duration) | ✅ DB / 🟡 UI | Atomic draft save; issue assigns `RX-YYYY-NNNNNN`; issued items are immutable; printable with signature block |
| Investigations: order, record result, upload report | ✅ DB / 🟡 UI | Random storage file names; signed-URL viewing |
| Doctor dashboard | ✅ DB / 🟡 UI | Next patient, today's queue across branches, branch-wise schedule, drafts, follow-ups, recent patients, clinical activity |
| Draft queue and finalized list | 🟡 | Drafts visible only to the doctor |

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
- Credit notes; GST-compliant tax invoice format (HSN/SAC, CGST/SGST split); a medicine/inventory catalogue.
- Clinic logo upload UI (the storage policy exists); doctor signature images on prescriptions.
- Patient archiving UI (the `archived_at` column exists); merging duplicate patients.
- SMS/WhatsApp reminders; email notifications; a realtime notification push (polling every 60 s today).
- Branch filter controls on list screens (scope is enforced; explicit filters are not built yet).
- Read-access logging beyond patient records and documents (e.g. consultation views); data-export tooling for DPDP Act requests.
- E2E tests (Playwright) against a seeded local Supabase stack; pgTAP suite.
- Marathi copy review by a native-speaking clinician.
- Translated database rule messages (currently English).
- Export to PDF/CSV files (printing uses the browser's "Save as PDF").
