# Vaidyora — API and data-access design

How the browser talks to the backend, and the contract of every operation. For table-level detail (columns, constraints, policies per command) see the generated [DATABASE.md](DATABASE.md); for who may do what see [PERMISSIONS.md](PERMISSIONS.md).

## 1. Layers

```
Page / component
  └─ TanStack Query hook (useQuery / useMutation)      caching, invalidation, retries
       └─ service function  src/services/*.ts           typed input → typed output, one place per domain
            ├─ PostgREST table access under RLS          ordinary reads and single-row writes
            ├─ Postgres RPC (database function)          multi-row, numbering, money, aggregates
            └─ Edge Function                             needs the service-role key or an external integration
```

- **Components never import `supabase-js`.** Only `src/services/*` and `src/lib/supabase/client.ts` do.
- **Query keys start with the clinic id** (`src/lib/query/keys.ts`). Switching clinic drops the previous clinic's cache; signing out clears everything.
- **Mutations invalidate by prefix**, for example `[clinicId, 'appointments']` after any booking change, so lists and details stay consistent.
- **No bulk downloads of clinic data.** Lists are paginated server-side (`range()` + `count: 'exact'`), filtered server-side, and dashboards use aggregate RPCs that return numbers, not rows.

## 2. Choosing the mechanism

| Use | When | Examples |
| --- | --- | --- |
| **Direct table access under RLS** | One row, no derived numbers, the policy fully expresses who may do it | Register/edit a patient, book an appointment, record consent, order an investigation, branch CRUD, exam-field definitions |
| **RPC, `SECURITY INVOKER`** | Several rows must change together, but the caller's own RLS is the right authority | `save_consultation`, `save_prescription_draft`, `book_follow_up`, `view_patient`, `dashboard_summary`, `doctor_overview` |
| **RPC, `SECURITY DEFINER`** | Server-computed values (totals, numbers), state machines, or aggregates across rows the caller cannot read | `create_invoice`, `record_payment`, `record_refund`, `void_invoice`, `issue_prescription`, `revise_prescription`, `finalize_consultation`, `set_appointment_status`, `clinic_overview`, `clinic_trends`, `branch_metrics`, `reconcile_payment`, `platform_*` |
| **Edge Function** | Needs the service-role key (Auth admin API, signed URLs) or a third-party call | `invite-member`, `document-url` |

No extra API is added where RLS already says everything (for example there is no "get patient" endpoint; the table is read directly).

## 3. Cross-cutting contracts

### Authentication
- Every call carries the user's Supabase JWT. Supabase refreshes it automatically.
- `anon` has **no** table privileges and no RPC execute rights (tested). Unauthenticated calls fail with `401` or `42501`.
- If the session expires (`401`, `PGRST301`/`PGRST302`), the global query handler signs out locally and the sign-in page explains why.

### Authorization (never trust the client)
- The `clinic_id` sent by the client is **only a filter**. Every RLS policy and every definer RPC re-derives access from `clinic_members` for `auth.uid()`, using `private.has_permission(clinic, key)`, `private.is_member`, `private.can_read_patient`, `private.can_read_clinical` and `private.in_branch_scope`.
- Composite foreign keys `(x_id, clinic_id)` stop a row from referencing another clinic's patient or appointment, even when the client sends its own `clinic_id`.
- Definer RPCs check permission **after** loading the target row under `FOR UPDATE`, using the row's `clinic_id`, not an argument.
- The UI reads `my_permissions()` only to decide what to show.

### Validation
| Boundary | Validation |
| --- | --- |
| Forms (untrusted user input) | Zod schemas next to each feature (`*Schema.ts`), with unit tests. They convert rupees to paise and blanks to `null`. |
| Edge Function bodies | Zod (`InviteSchema`, `BodySchema`); invalid input returns `400` before any privileged work. |
| Database (final authority) | `CHECK` constraints, enums, composite foreign keys, triggers (state machines, immutability, clinic-configured field types) and RPC argument checks. Nothing relies on frontend validation alone. |
| Files | Type and size checked in the browser, then by the `patient_documents` checks, then by the bucket's own limits (see [SECURITY.md](SECURITY.md#phase-11--file-storage)). |

### Errors
Backend errors are thrown unchanged from services, then mapped once by `toUserMessage()` (`src/lib/errors.ts`):

| Source | Shape | Shown to the user |
| --- | --- | --- |
| Business rule raised by our SQL | `{ code: '23514' \| 'P0001' \| …, message }`, where the message is in `SAFE_MESSAGES` | The message as written (English) |
| Permission (`42501`, RLS violation) | `{ code: '42501' }` | "You do not have permission…" (translated). Also refreshes permissions in case access changed. |
| Not found / not visible (`P0002`, `PGRST116`) | — | "The record could not be found…" (no difference between missing and forbidden, so ids can't be probed) |
| Booking overlap (`23P01`) | — | "This time slot overlaps…" |
| Rate limited (`54000`, HTTP `429`) | — | "Too many requests…" |
| Anything else | — | Generic message. Raw database text is **never** shown, because it can contain record values. |

Edge Functions return `{ error: string }` with HTTP `400 / 401 / 403 / 404 / 409 / 422 / 429 / 500`.

### Idempotency
| Operation | Mechanism |
| --- | --- |
| `create_invoice`, `record_payment`, `record_refund` | `p_idempotency_key uuid`, stored on the created row with a unique index per clinic. A repeat returns the original row. The same key with different details is rejected (`23505`). The client generates one key per dialog or form with `useIdempotencyKey()` and renews it only after success. |
| `issue_prescription`, `finalize_consultation`, `void_invoice`, `revise_prescription` | Guarded by state. A repeat of a completed step either returns the current row (`finalize`, `void`) or fails with a clear message (`issue`, `revise`); it never acts twice. |
| `save_consultation`, `save_prescription_draft` | Updates replace content atomically. A retried create may leave a second **draft**, which is harmless and visible in "My drafts". |
| `book_follow_up` | Locks the follow-up and requires `status = 'pending'`, so a second booking fails. |
| `accept_invitation`, `reconcile_payment`, `confirm_document_upload` | Naturally idempotent (they set state). |
| `invite-member` | Upsert on `(clinic_id, user_id)`; an already-active member gets `409`. |

## 4. Service reference

Notation: *Input → Output*. "RLS" means direct table access whose policy is listed in DATABASE.md.

### Authentication and membership — `services/auth.ts`, `services/clinic.ts`
| Function | Mechanism | Input → Output | Authorization |
| --- | --- | --- | --- |
| `signIn`, `signUp`, `requestPasswordReset`, `updatePassword`, `signOut` | Supabase Auth | credentials → session | Auth rate limits; reset never reveals whether an account exists |
| `fetchMemberships(userId)` | RLS `clinic_members` | → `Membership[]` (active and invited, with clinic status) | own rows |
| `fetchPermissions(clinicId)` | RPC `my_permissions` | → `Permission[]` | active membership in an active clinic |
| `acceptInvitation(clinicId)` | RPC `accept_invitation` | → void | own invited membership |
| `inviteMember({clinicId,email,fullName,roles,branchIds})` | Edge `invite-member` | → void | caller's JWT must hold `users.manage` (checked via `my_permissions`); plan limits; 20 per inviter per hour |
| `updateMember`, `setMemberBranches` | RLS | → void | `users.manage`; the last admin is protected |
| `fetchStaff`, `fetchDoctors`, `fetchProfileNames` | RLS | → lists | members of the clinic |
| `listAccessReviews`, `recordAccessReview`, `fetchMemberActivity` | RLS / RPC `member_last_activity` | → reviews / last activity | `users.manage` |
| `logSessionEvent` | RPC `log_session_event` | → void | membership (client-reported) |

### Clinics and branches — `services/clinic.ts`, `services/subscription.ts`
| Function | Mechanism | Authorization |
| --- | --- | --- |
| `createClinic` | RPC `create_clinic` (definer) | any signed-in user; becomes admin on a trial plan |
| `fetchClinic`, `updateClinic`, `updateClinicSettings` | RLS | read: members; write: `settings.manage`. Status changes are platform-only; settings shape is validated by trigger. |
| `fetchBranches`, `saveBranch` | RLS | read: members; write: `settings.manage`; plan branch limit |
| `fetchSubscription` | RLS | `subscription.read`; writes are platform RPCs only |

### Patients — `services/patients.ts`, `services/consents.ts`
| Function | Mechanism | Input → Output | Notes |
| --- | --- | --- | --- |
| `listPatients(clinicId, {search,page,pageSize,sort,status,doctorId})` | RLS, paginated | → `Page<PatientListItem>` | search escaped for PostgREST; doctors see assigned or booked patients only |
| `viewPatient(id)` | RPC `view_patient` (invoker) | → `Patient` | audits `patients.viewed` (10-minute collapse); brake at 300 opens per 10 minutes (audited, then `54000`) |
| `getPatient` | RLS | → `Patient` | no audit; for pickers and print headers |
| `createPatient`, `updatePatient` | RLS | `PatientInput` → `Patient` | doctors can only self-assign |
| `listConsents`, `grantConsent`, `withdrawConsent` | RLS | → consent rows | `consents.manage`; append-only, withdrawal only |

### Appointments — `services/appointments.ts`
| Function | Mechanism | Notes |
| --- | --- | --- |
| `listAppointments({from,to,doctorId,patientId,statuses})`, `getAppointment` | RLS | branch-scoped; doctors see their own |
| `createAppointment`, `rescheduleAppointment` | RLS | `appointments.manage`; overlap → `23P01`; branch defaults to member or primary |
| `setAppointmentStatus(id, status, reason)` | RPC (definer) | state machine; cancellation reason required |
| `bookFollowUp` | RPC `book_follow_up` (invoker) | appointment + follow-up link in one transaction |

### Consultations and Ayurvedic examinations — `services/clinical.ts`
| Function | Mechanism | Notes |
| --- | --- | --- |
| `listConsultations`, `getConsultation` | RLS | clinical access + branch scope |
| `saveConsultation(clinicId, input, exam, id?)` | RPC `save_consultation` (invoker) | consultation + examination atomically; custom fields validated against definitions |
| `finalizeConsultation(id)` | RPC (definer) | treating doctor only; locks the record; creates the follow-up |
| `listAmendments`, `addAmendment` | RLS | treating doctor, finalized records only; append-only |
| `listExamFields`, `saveExamField` | RLS | read: members; write: `settings.manage`; key immutable |
| `listFollowUps` | RLS | clinicians and appointment managers |

### Prescriptions — `services/clinical.ts`
| Function | Mechanism | Notes |
| --- | --- | --- |
| `searchPrescriptions(params)` | RLS, paginated | admins: issued and cancelled only |
| `getPrescription`, `listPrescriptions`, `listPrescriptionRevisions` | RLS | |
| `savePrescriptionDraft(clinicId, {patient_id, consultation_id, header}, items, id?)` | RPC (invoker) | header + items replaced atomically |
| `issuePrescription(id, clinicianConfirmed)` | RPC (definer) | requires `true`; assigns `RX-YYYY-NNNNNN`; writes an immutable revision snapshot |
| `revisePrescription(id, reason)`, `cancelPrescription` | RPC / RLS | reason required; number kept; earlier revisions unchanged |
| `listTemplates`, `saveTemplate` | RLS | owner or shared; content validated; never generated by the app |

### Investigations and files — `services/clinical.ts`, `services/documents.ts`
| Function | Mechanism | Notes |
| --- | --- | --- |
| `listInvestigations`, `orderInvestigation`, `updateInvestigation` | RLS | clinical write access |
| `uploadDocument(clinicId, input, onProgress)` | RLS insert → Storage upload (XHR, progress) → RPC `confirm_document_upload` | type and size pre-checked; display name sanitised; path assigned by the server |
| `getDocumentUrl(id)` | Edge `document-url` | RLS check with the caller's JWT, audit, 60-second signed URL; 120 per user per 10 minutes |
| `listDocuments`, `deleteDocument(id, reason)` | RLS / RPC | soft delete with reason |

### Billing and payments — `services/billing.ts`
| Function | Mechanism | Notes |
| --- | --- | --- |
| `listInvoices`, `getInvoice` | RLS, paginated | branch-scoped |
| `createInvoice({…, idempotencyKey})` | RPC (definer) | totals computed server-side in paise |
| `recordPayment({…, idempotencyKey})`, `recordRefund({…, idempotencyKey})` | RPC (definer) | row-locked; no overpayment or over-refund; receipt and refund numbers |
| `voidInvoice` | RPC (definer) | unpaid invoices only, reason required |
| `listPayments`, `getPayment`, `reconcilePayment` | RLS / RPC | amounts immutable; reconciliation fields only |

### Reports — `services/reports.ts`
`fetchDashboardSummary`, `fetchDoctorOverview` (invoker: counts only what the caller can see); `fetchClinicOverview`, `fetchClinicTrends`, `fetchBranchMetrics`, `fetchRevenueReport`, `fetchPaymentMethodReport`, `fetchAppointmentStatusReport` (definer or `reports.read`: numbers only, branch-scoped, ranges up to one year); `fetchRecentPatients` (own view events only).

### Notifications — `services/notifications.ts`
`listNotifications(clinicId)` and `markNotificationsRead(ids)`. Own rows only; only `read_at` may be updated. Notifications are created by database triggers and have generic titles (no patient names).

### Audit events — `services/audit.ts`
`listAuditEvents(clinicId, {page, pageSize, entityType, action})`, requiring `audit.read`. Read-only; append-only table. Events are written only by triggers, definer RPCs and the `document-url` function.

## 5. Edge Functions

| | `invite-member` | `document-url` |
| --- | --- | --- |
| Purpose | Invite staff (Auth admin API) and create an invited membership | Short-lived download link for a patient document |
| Request | `POST { clinicId, email, fullName, roles: ('admin'\|'doctor')[], branchIds?: uuid[] }` | `POST { documentId: uuid }` |
| Response | `200 { userId, invited }` | `200 { url, expiresIn: 60 }` |
| Authentication | `verify_jwt = true`; `auth.getUser()` with the caller's JWT | same |
| Authorization | `users.manage` in `clinicId`, checked with the **caller's** client | RLS `SELECT` on `patient_documents` with the caller's client (missing and forbidden both give `404`) |
| Rate limit | 20 per inviter per hour → `429` | 120 per user per 10 minutes → `429` |
| Privileged step | service role: invite email, membership upsert, branch scope | service role: audit `patient_documents.accessed`, then sign the URL. If the audit write fails, **no URL** is returned. |
| Errors | `400` invalid body, `401`, `403`, `409` already a member, `422` plan limit, `429`, `500` | `400`, `401`, `404`, `429`, `500` |
| CORS | `ALLOWED_ORIGINS` allowlist | same |
