# Vaidyora — File storage, security and privacy

Patient information is treated as highly sensitive health data. This document says what is **implemented** (and tested) and what is **operational policy** that the clinic or the Vxora Tech operations team must carry out. It is not a compliance certificate; see [§13](#13-regulatory-position-not-a-compliance-claim).

## Phase 11 — File storage

| Requirement | Implementation | Verified by |
| --- | --- | --- |
| Private bucket | One bucket, `clinic-files`, `public = false`; 10 MB limit; PDF, PNG, JPEG and WebP only (bucket settings) | migration 0500 |
| Server-assigned paths | `patients/{patient_id}/{document_id}.{ext}`, assigned by a trigger, never by the client | `tests/db/clinical-access.test.ts` |
| Access by permission and branch | **Upload:** allowed only to the exact path of a pending `patient_documents` row the caller created, with `investigations.upload` at that document's branch. **Read:** clients have **no** `SELECT` on patient files. Downloads go through `document-url`, which reads the row with the caller's JWT (`documents.view` at the branch) first. **Branding** files: active accounts read, `settings.organization` writes. | `tests/db/clinical-access.test.ts` (receptionists cannot upload, see or open documents) |
| File type and size validation | Browser (`validateDocumentFile`), table checks (`mime_type`, `size_bytes` ≤ 10 MB) and the bucket limits, independently | `services/documents.test.ts` |
| Safe filenames | The storage name is the document UUID. The display name is sanitised (`sanitizeFileName`: no directories, control characters or leading dots, ≤ 200 characters) and the database rejects anything else. | both suites |
| Metadata in PostgreSQL | `patient_documents`: patient, optional investigation and consultation, category, title, file name, type, size, uploader, upload time, deletion fields | DATABASE.md |
| Short-lived signed URLs | 60 seconds, created server-side after an audit record is written; opened in a new tab and never stored | `document-url` |
| Upload progress and errors | XHR upload with a progress bar (`role=progressbar`); errors show a translated message; nothing is confirmed until the object exists | `DocumentsPanel` |
| No public bucket, no long-lived URLs | No public URLs are ever generated; `getPublicUrl` is not used | `security-guards.test.ts` scope + code review |

### Deletion, retention and audit for files

| Event | Behaviour |
| --- | --- |
| Upload | Metadata row created → file uploaded → `confirm_document_upload()`. All three steps are audited (insert and update of `patient_documents`). |
| Abandoned upload (browser closed mid-way) | Unconfirmed rows are invisible to everyone. `purge_abandoned_uploads(interval '24 hours')` (service role only) deletes them and returns their storage paths; the scheduled job then deletes those objects through the Storage API. |
| View or download | Every signed URL is preceded by a `patient_documents.accessed` audit event, with no file name or patient name in it. |
| "Delete" by a clinician | Soft delete with a reason (`delete_document()`). The document disappears from the record, but the file and the metadata are **retained**. |
| Physical deletion | Only after the clinical retention period ([§9](#9-data-retention-and-deletion)), by an operations job using the service role, which records what was removed. There is no hard-delete path in the app. |

## Phase 12 — Security and privacy

### 1. Row Level Security on every table
- RLS is enabled on **every** `public` table. A test fails if one is added without it.
- No policy grants access merely for being signed in: even reference data (branches, permission catalogue, templates) needs an **active** account (`private.is_active_user()`); invited, deactivated or unknown accounts see nothing (tested).
- `DELETE` is granted to API users on draft `prescription_items` only. Staff, branch and permission tables accept writes only through functions. `anon` has no table grants at all.
- Policies are separate per command (`SELECT` / `INSERT` / `UPDATE` / `DELETE`); DATABASE.md lists each one.

### 2. Least privilege
- Effective permissions are computed per request: account role (doctor, admin) or staff template ∪ grants − denies, never doctor-only keys, and only while the account and staff record are active.
- Clinical **writes** are doctor-only permissions held by exactly one account. Admins **read** clinical records (as the brief requires) but cannot write them; staff need an explicit clinical view permission **and** a visit at one of their branches.
- Branch scope (`staff_branch_assignments`) limits staff to their branches for appointments, visits, bills, documents, reports and audit events.
- Privileged helpers live in the non-exposed `private` schema. Only the policy helpers are executable by `authenticated`.
- Service-only functions (`bootstrap_primary_doctor`, `link_admin_account`, `link_staff_account`, `log_document_access`, `consume_rate_limit`, `purge_*`, `find_user_id_by_email`) are granted to `service_role` only.

### 3. Server-side permission checks
Every definer function loads the target row and checks `private.can_at(permission, row.branch_id)` against **that row's** branch, never an argument. Identity is never taken from input: `auth.uid()` only. Edge Functions authorise with the caller's own JWT (`my_access`, `can_manage_staff_member`) before using the service role.

**Identity guards** (tested in `tests/db/access.test.ts`):
- One organization row (unique `singleton`), undeletable; `primary_doctor_id` is write-once.
- At most one `primary_doctor` profile (unique partial index); account type and activation change only inside trusted identity functions, so even a direct `UPDATE` by the database owner is refused.
- Staff records link only to `staff` accounts with the invited email; a staff record can never be re-pointed at another account.
- Nobody edits their own template, overrides, branches or status; delegated managers grant only what they hold, to staff whose branches are all theirs.

### 4. Session handling
- Supabase Auth issues short-lived JWTs (1 hour) with rotating refresh tokens (`enable_refresh_token_rotation`). The minimum password length is 10, with mixed case and a digit.
- If a session expires or is revoked, the app signs out locally and explains why. Signing out clears all cached data.
- Permission and branch changes take effect on the next request in the database, and in the UI within 2 minutes or on window focus. Deactivating staff also bans the auth user, which stops token refresh.
- **Hosted project:** set the same password policy, rate limits and Site URL in the Supabase dashboard. `config.toml` applies only to local stacks.

### 5. Environment-variable hygiene
- The browser reads only `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and `VITE_APP_ENV`. A test fails on any other `VITE_*` variable or any service-role reference.
- `readEnv()` refuses to start if a service-role key is configured.
- `.env*` files are git-ignored except `.env.example`, which holds placeholders only. Edge Function secrets live in Supabase secrets.
- The demo seed takes its service key and demo password from the shell, and refuses hosted projects unless explicitly allowed.

### 6. Input validation
Zod at every form and Edge Function boundary. Database constraints, enums, triggers and RPC checks are the final authority. Search input is escaped before it reaches PostgREST filters.

### 7. Output escaping
React escapes all rendered text. A test fails if browser code uses `dangerouslySetInnerHTML`, `innerHTML`, `insertAdjacentHTML`, `document.write`, `eval` or `new Function`. Printed documents are rendered by React too, not by string templates.

### 8. Rate limiting
| Surface | Limit |
| --- | --- |
| Sign-in | 30 per IP per 5 minutes (Supabase Auth). Public sign-up is disabled. |
| OTP / token verification | 30 per IP per 5 minutes (Supabase Auth) |
| Opening patient records | 300 per user per 10 minutes (`view_patient`); refusals are audited as `security.rate_limited` |
| Staff invitations, resets and access changes | 20 per caller per hour (`staff-admin`) |
| Document links | 120 per user per 10 minutes (`document-url`) |

Direct table reads are protected by RLS and pagination rather than counters. Supabase's API gateway limits apply on top. A production deployment should add a WAF or edge rule for abusive IPs.

### 9. Data retention and deletion
| Data | Policy |
| --- | --- |
| Clinical records (patients, consultations, examinations, prescriptions, investigations, documents) | **Never hard-deleted by the app.** Retained at least **3 years from the last visit**, the minimum in Indian Medical Council regulations; clinics often keep longer. Corrections are made by amendment, revision or soft delete. |
| Financial records (invoices, payments, refunds) | Never deleted; retain at least **8 years** for tax records. Corrections by void or refund. |
| Audit events | `clinic_settings.audit_retention_days` (default 2920 days, minimum 1095), purged by `purge_expired_audit_events()` (service role, scheduled) |
| Notifications | Can be purged after 90 days (generic content only) |
| Rate-limit counters | Pruned automatically on each use |
| Patient requests (access, correction, erasure) | Handled by the clinic. Erasure must respect the medical-record retention duty above. |

### 10. Audit trails
- `audit_events` is append-only, even for the database owner (trigger).
- It records who did what to which record and branch, field **names** for updates, patient views, document access, staff creation, status changes, branch changes, permission changes (keys granted and revoked), template changes, duplicate-registration reviews and rate-limit refusals.
- It never stores names, phone numbers, notes or clinical values; a test scans the table for them.

### 11. Error monitoring without patient details
`src/lib/monitoring.ts` reports only an error's type and code, the route **pattern** (ids and query strings removed), the environment and a timestamp. It never includes messages, payloads or URLs with ids (tested). It is connected to route errors and query and mutation failures. A provider is attached with `setErrorSink()`; for example, Sentry with `sendDefaultPii: false` and breadcrumbs, replay and request bodies disabled. Edge Functions log only error **codes**.

### 12. Clinical and branch isolation
- **Automated tests** (`tests/db/clinical-access.test.ts`) have a receptionist query every clinical table directly, call every clinical function and hand-craft inserts: nothing is returned and every write is refused. Staff at one branch cannot see or book the schedule of another, accountants cannot bill outside their branch, and branch managers see only their branch's staff and figures.
- A clinical view permission granted to staff is still limited to visits at their branches, and disappears as soon as it is revoked (tested).
- Query caches are dropped on sign-out and when the signed-in user changes.

### 13. Regulatory position (not a compliance claim)
Vaidyora has **not** been certified or legally reviewed for compliance. Before production use with real patients, a qualified Indian legal and security reviewer should assess at least:

- **Digital Personal Data Protection Act, 2023** and its Rules: consent and notice, purpose limitation, the data-principal rights workflow, breach notification, and whether Vxora Tech or the clinic is the data fiduciary or processor.
- **Information Technology Act, 2000** and the **SPDI Rules, 2011** (sensitive personal data, including health information), to the extent still applicable.
- **Clinical record retention** under Indian Medical Council (Professional Conduct, Etiquette and Ethics) Regulations, and any NCISM rules for AYUSH practitioners.
- **Telemedicine Practice Guidelines (2020)**, if teleconsultations are used.
- **ABDM / ABHA** health-data standards, if integration with the national health stack is planned.
- **Data localisation and hosting:** the hosted project's region (currently `ap-southeast-2`, Sydney) should be confirmed against contractual and regulatory expectations; an Indian region (e.g. `ap-south-1`) may be preferable.
- **Contracts:** a data processing agreement with Supabase and its sub-processors, plus the clinic terms.

### 14. Backup and recovery
| Item | Plan |
| --- | --- |
| Database | Supabase daily backups (on paid plans). Enable **Point-in-Time Recovery** for production (target RPO ≤ 5 minutes). |
| Storage | Not covered by database PITR: run a scheduled copy of `clinic-files` to a separate encrypted bucket or account. |
| Schema | Every change is a forward-only migration in git; production is changed only by `supabase db push` from reviewed commits. |
| Restore drill | Quarterly: restore to a staging project, run `npm run test:db` against it, record the time taken (target RTO ≤ 4 hours). |
| Secrets | Keys can be rotated in the Supabase dashboard; rotate the service-role key if exposure is suspected. Anon key rotation only requires a frontend redeploy. |
| Incident | Deactivate affected accounts (Staff Management; this also blocks sign-in), rotate keys if needed, preserve audit events, assess, and notify per DPDP obligations. |

### 15. Safe database migrations
- Forward-only, timestamp-ordered files; already-applied migrations are not edited. Fixes go in a new migration.
- A test enforces naming and ordering. It fails on any `DROP TABLE`, `TRUNCATE`, `DROP COLUMN` or unqualified `DELETE` that isn't in a reviewed allowlist, and on any migration that disables RLS or grants table access to `anon`.
- CI applies **all** migrations to a fresh Postgres (PGlite) and runs the RLS suite on every push. Generated docs must match the migrations.
- Before production: run `supabase db push --dry-run` and review the list; take a backup or PITR marker first.

### 16. Seed data
`scripts/seed-demo.ts` uses fictional people and `.test` email domains only. It sets `clinic_settings.preferences.demo = true`, so dashboards show a "Demo data" notice. `scripts/bootstrap.ts` handles only real identities (doctor and first admin) and never handles passwords.
