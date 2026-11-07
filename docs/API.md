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
- **Query keys** come from `src/lib/query/keys.ts`. Signing out (or a different user signing in) clears the whole cache.
- **Mutations invalidate by prefix**, for example `['appointments']` after any booking change, so lists and details stay consistent.
- **Branch filter:** lists and dashboards take the optional branch chosen in the header (`branchFilter`); `null` means all of the caller's branches. The server limits results to the caller's branches regardless.
- **No bulk downloads of clinic data.** Lists are paginated server-side (`range()` + `count: 'exact'`), filtered server-side, and dashboards use aggregate RPCs that return numbers, not rows.

## 2. Choosing the mechanism

| Use | When | Examples |
| --- | --- | --- |
| **Direct table access under RLS** | One row, no derived numbers, the policy fully expresses who may do it | Edit a patient, book or reschedule an appointment, record consent, order an investigation, branch create/edit, exam-field definitions |
| **RPC, `SECURITY INVOKER`** | Several rows must change together, but the caller's own RLS is the right authority | `save_consultation`, `save_prescription_draft`, `save_medical_profile`, `book_follow_up`, `view_patient` |
| **RPC, `SECURITY DEFINER`** | Server-computed values, state machines, staff and permission changes, or aggregates across rows the caller cannot read | `register_patient`, `find_possible_duplicates`, `create_invoice`, `record_payment`, `record_refund`, `void_invoice`, `issue_prescription`, `revise_prescription`, `finalize_consultation`, `set_appointment_status`, `create_staff_member`, `set_staff_access`, `set_staff_branches`, `set_staff_status`, `save_role_template`, `set_branch_hours`, `my_access`, `org_overview`, `doctor_overview`, `clinic_trends`, `branch_metrics`, `clinical_report`, `staff_activity` |
| **Edge Function** | Needs the service-role key (Auth admin API, signed URLs) | `staff-admin`, `document-url` |

No extra API is added where RLS already says everything (for example there is no "get patient" endpoint; the table is read directly).

## 3. Cross-cutting contracts

### Authentication
- Every call carries the user's Supabase JWT. Supabase refreshes it automatically.
- `anon` has **no** table privileges and no RPC execute rights (tested). Unauthenticated calls fail with `401` or `42501`.
- If the session expires (`401`, `PGRST301`/`PGRST302`), the global query handler signs out locally and the sign-in page explains why.

### Authorization (never trust the client)
- Access is derived from `auth.uid()` only: `private.my_account()` (doctor, admin, or active staff), `private.can(key)`, `private.can_at(key, branch)`, `private.in_branch(branch)`, `private.can_see_patient(patient)` and `private.can_view_clinical(key, patient)`. A branch id sent by the client is **only a filter** or a target that is checked.
- Definer RPCs check permission **after** loading the target row under `FOR UPDATE`, using the row's `branch_id`, not an argument.
- Staff functions also apply `private.can_manage_staff` (never yourself; delegated managers only for staff whose branches are all theirs) and `private.can_grant` (doctor/admin: any non-doctor-only key; others: only keys they hold).
- The UI reads `my_access()` only to decide what to show.

### Validation
| Boundary | Validation |
| --- | --- |
| Forms (untrusted user input) | Zod schemas next to each feature (`*Schema.ts`), with unit tests. They convert rupees to paise and blanks to `null`. |
| Edge Function bodies | Zod (`BodySchema` per function); invalid input returns `400` before any privileged work. |
| Database (final authority) | `CHECK` constraints, enums, foreign keys, triggers (state machines, immutability, identity guards, contact-only patient edits, clinic-configured field types, working hours) and RPC argument checks. Nothing relies on frontend validation alone. |
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
| `create_invoice`, `record_payment`, `record_refund` | `p_idempotency_key uuid`, stored on the created row with a unique index. A repeat returns the original row. The same key with different details is rejected (`23505`). The client generates one key per dialog or form with `useIdempotencyKey()` and renews it only after success. |
| `issue_prescription`, `finalize_consultation`, `void_invoice`, `revise_prescription` | Guarded by state. A repeat of a completed step either returns the current row (`finalize`, `void`) or fails with a clear message (`issue`, `revise`); it never acts twice. |
| `save_consultation`, `save_prescription_draft` | Updates replace content atomically. A retried create may leave a second **draft**, which is harmless and visible in "My drafts". |
| `book_follow_up` | Locks the follow-up and requires `status = 'pending'`, so a second booking fails. |
| `accept_staff_invitation`, `reconcile_payment`, `confirm_document_upload`, `set_staff_access`, `set_staff_branches` | Naturally idempotent (they set or replace state). |
| `register_patient` | Not idempotent by key: a retry re-runs the duplicate check, so a second identical registration is refused (`P0003`) unless the user confirms again. |
| `staff-admin` `invite` | Re-sending links the same account again; a staff member who already joined gets `409`. |

## 4. Service reference

Notation: *Input → Output*. "RLS" means direct table access whose policy is listed in DATABASE.md. No service takes a clinic id.

### Authentication and access — `services/auth.ts`, `services/organization.ts`
| Function | Mechanism | Input → Output | Authorization |
| --- | --- | --- | --- |
| `signIn`, `requestPasswordReset`, `updatePassword`, `signOut` | Supabase Auth | credentials → session | Auth rate limits; reset never reveals whether an account exists. There is no sign-up. |
| `fetchMyAccess()` | RPC `my_access` | → account type, permissions, branches (or a `reason`: `invited`, `deactivated`, `no_access`) | own identity |
| `acceptStaffInvitation()` | RPC `accept_staff_invitation` | → void | own invited staff record |
| `logSessionEvent(event)` | RPC `log_session_event` | → void | signed in (client-reported) |
| `fetchOrganization`, `updateOrganization` | RLS | → `Organization` | read: active accounts; write: `settings.organization` |
| `fetchSettings`, `updateSettings` | RLS | → `OrganizationSettings` | same; preferences validated by trigger; the demo flag is operator-only |
| `fetchBranches`, `saveBranch` | RLS | → `Branch` | read: active accounts; create, (de)activate, code, manager: `branches.manage`; contact details also `settings.branch` at that branch |
| `fetchBranchHours`, `saveBranchHours` | RLS / RPC `set_branch_hours` | → `WorkingHours[]` | `branches.manage` or `settings.branch` at the branch; overlaps refused |
| `fetchProfile`, `updateProfile`, `fetchPrimaryDoctor`, `fetchProfileNames`, `fetchAdministrators` | RLS `user_profiles` | → profiles | own profile editable (display fields only); names of colleagues for active accounts |

### Staff and permissions — `services/staff.ts`
| Function | Mechanism | Authorization |
| --- | --- | --- |
| `listStaff`, `getStaffMember` | RLS | `staff.view` (staff sharing a branch; everyone for doctor/admin); own record always |
| `createStaffMember({profile, roleId, branchIds, overrides})` | RPC `create_staff_member` | `staff.manage` (+ `staff.permissions` for overrides); branches within the caller's; grants within authority; not a doctor/admin email |
| `updateStaffMember`, `setStaffBranches`, `setStaffAccess` | RPCs | `can_manage_staff` (never self); `setStaffAccess` also `staff.permissions` and grant authority; audited with keys granted and revoked |
| `fetchStaffPermissionMatrix(id)` | RPC `staff_permission_matrix` | can see the staff member; per key: in template, override, effective, grantable by the caller |
| `listRoleTemplates`, `saveRoleTemplate`, `deleteRoleTemplate` | RLS / RPCs | `staff.permissions`; account roles fixed; built-in or in-use templates cannot be deleted |
| `fetchPermissionCatalog`, `fetchStaffActivity`, `fetchStaffLastActivity` | RLS / RPCs | active accounts / `staff.view` |
| `sendStaffInvitation`, `sendStaffPasswordReset`, `setStaffStatus` | Edge `staff-admin` | `can_manage_staff_member` with the caller's JWT; deactivation requires a reason and bans the auth user |
| `inviteAdministrator`, `setAdministratorActive` | Edge `staff-admin` | primary doctor only |

### Patients — `services/patients.ts`, `services/consents.ts`
| Function | Mechanism | Input → Output | Notes |
| --- | --- | --- | --- |
| `listPatients({search,page,pageSize,sort,status,branchId})` | RLS, paginated | → `Page<PatientListItem>` | organization-wide with `patients.view_basic`; billing staff see patients they bill at their branches |
| `findPossibleDuplicates(input)` | RPC | → `DuplicateCandidate[]` | same phone, or similar name with matching date of birth or age |
| `registerPatient(input, branchId, duplicateReviewed)` | RPC `register_patient` | → `Patient` | `patients.create` at the branch; refuses likely duplicates with `P0003` until reviewed; the review is audited |
| `viewPatient(id)` | RPC `view_patient` (invoker) | → `Patient` | audits `patients.viewed`; brake at 300 opens per 10 minutes |
| `getPatient`, `updatePatient` | RLS | → `Patient` | `edit_contact` changes contact fields only; `edit` for identity; status needs `edit` or `delete` |
| `getMedicalProfile`, `saveMedicalProfile` | RLS / RPC (invoker) | → `MedicalProfile` | read: `patients.view_history` + a visit at the caller's branch; write: the doctor |
| `listConsents`, `grantConsent`, `withdrawConsent` | RLS | → consent rows | `consents.manage`; append-only, withdrawal only |

### Appointments — `services/appointments.ts`
| Function | Mechanism | Notes |
| --- | --- | --- |
| `listAppointments({from,to,branchId,patientId,statuses})`, `getAppointment` | RLS | `appointments.view` at the branch |
| `createAppointment`, `rescheduleAppointment` | RLS | `appointments.create` / `reschedule` at the branch; one calendar, so overlap anywhere → `23P01`; active branch and working hours enforced |
| `setAppointmentStatus(id, status, reason)` | RPC (definer) | `cancel`, `update_status`, or the doctor; state machine; cancellation reason required |
| `bookFollowUp` | RPC `book_follow_up` (invoker) | `follow_ups.manage` + `appointments.create`; one transaction |

### Clinical — `services/clinical.ts`
| Function | Mechanism | Notes |
| --- | --- | --- |
| `listConsultations({patientId,branchId,status})`, `getConsultation` | RLS | `consultations.view` at the visit branch; examinations need `examinations.view` |
| `saveConsultation(input, exam, id?)` | RPC (invoker) | doctor only; consultation + examination atomically |
| `finalizeConsultation(id)` | RPC (definer) | doctor only; locks; creates the follow-up at the visit branch |
| `listAmendments`, `addAmendment` | RLS | doctor; finalized records only; append-only |
| `searchPrescriptions`, `getPrescription`, `listPrescriptions`, `listPrescriptionRevisions` | RLS | `prescriptions.view` at the branch; drafts only for the doctor |
| `savePrescriptionDraft`, `issuePrescription`, `revisePrescription`, `cancelPrescription`, `listTemplates`, `saveTemplate` | RPC / RLS | doctor only; issue requires confirmation and writes an immutable snapshot |
| `listInvestigations`, `listOpenInvestigations`, `orderInvestigation`, `updateInvestigation` | RLS | view at the branch; order and results: doctor; `investigations.manage`: status only |
| `listExamFields`, `saveExamField` | RLS | read: active accounts; write: `settings.organization` |
| `listFollowUps({status,dueBefore,branchId,patientId})` | RLS | `follow_ups.view` at the branch |

### Files — `services/documents.ts`
| Function | Mechanism | Notes |
| --- | --- | --- |
| `uploadDocument({patientId, branchId, …}, onProgress)` | RLS insert → Storage upload → RPC `confirm_document_upload` | `investigations.upload` at the branch; path assigned by the server |
| `getDocumentUrl(id)` | Edge `document-url` | RLS read with the caller's JWT (`documents.view` at the branch), audit, 60-second signed URL |
| `listDocuments`, `deleteDocument(id, reason)` | RLS / RPC | soft delete with reason; `documents.delete` |

### Billing — `services/billing.ts`
| Function | Mechanism | Notes |
| --- | --- | --- |
| `listInvoices({…, branchId})`, `getInvoice`, `listPayments`, `getPayment` | RLS | `billing.view` at the branch |
| `createInvoice({…, branchId, idempotencyKey})` | RPC (definer) | `billing.create` at the branch (the appointment's branch when billing a visit); totals in paise |
| `recordPayment`, `recordRefund`, `voidInvoice`, `reconcilePayment` | RPC (definer) | `payments.record` / `refund` / `billing.void` / `payments.reconcile` at the invoice's branch; row-locked |

### Reports — `services/reports.ts`
All take `branchId | null` and a date range of up to a year, and return numbers only. `fetchOverview` (`org_overview`: operational, financial sections present only with `reports.operational` / `reports.financial`), `fetchClinicTrends`, `fetchBranchMetrics` (financial columns null without `reports.financial`), `fetchRevenueReport`, `fetchPaymentMethodReport` (`reports.financial`), `fetchAppointmentStatusReport` (`reports.operational`), `fetchClinicalReport` (`reports.clinical`), `fetchDoctorOverview` (primary doctor only), `fetchRecentPatients` (own view events).

### Notifications and audit — `services/notifications.ts`, `services/audit.ts`
`listNotifications()`, `markNotificationsRead(ids)`: own rows; only `read_at` may change. The doctor is notified of bookings and cancellations by others and of results. `listAuditEvents({page,pageSize,entityType,action,branchId})`: `audit.view`; doctor and admin see everything, staff their branches and own actions.

## 5. Edge Functions

| | `staff-admin` | `document-url` |
| --- | --- | --- |
| Purpose | Staff invitations, password resets, activation (with sign-in blocking), administrator appointment | Short-lived download link for a patient document |
| Request | `POST { action: 'invite' \| 'reset_password', staffId }`, `{ action: 'set_status', staffId, status, reason? }`, `{ action: 'invite_admin', email, fullName }`, `{ action: 'set_admin_status', userId, active }` | `POST { documentId: uuid }` |
| Response | `200 { userId }` or `{ ok: true }` | `200 { url, expiresIn: 60 }` |
| Authentication | `verify_jwt = true`; `auth.getUser()` with the caller's JWT | same |
| Authorization | staff actions: `can_manage_staff_member` with the **caller's** client (and the database function checks again); admin actions: `my_access().account_type = 'primary_doctor'` | RLS `SELECT` on `patient_documents` with the caller's client (missing and forbidden both give `404`) |
| Rate limit | 20 per caller per hour → `429` | 120 per user per 10 minutes → `429` |
| Privileged step | service role: invite email, `link_staff_account` / `link_admin_account` (email must match; only `staff` accounts), ban or unban the auth user | service role: audit `patient_documents.accessed`, then sign the URL; no audit, no URL |
| Errors | `400`, `401`, `403`, `404`, `409` already joined or wrong account, `422` reason required, `429`, `502` email failed | `400`, `401`, `404`, `429`, `500` |
| CORS | `ALLOWED_ORIGINS` allowlist | same |
