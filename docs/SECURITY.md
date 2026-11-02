# Vaidyora — File storage, security and privacy

Patient information is treated as highly sensitive health data. This document says what is **implemented** (and tested) and what is **operational policy** that the clinic or the Vxora Tech operations team must carry out. It is not a compliance certificate; see [§13](#13-regulatory-position-not-a-compliance-claim).

## Phase 11 — File storage

| Requirement | Implementation | Verified by |
| --- | --- | --- |
| Private bucket | One bucket, `clinic-files`, `public = false`; 10 MB limit; PDF, PNG, JPEG and WebP only (bucket settings) | migration 0004 |
| Tenant-aware paths | `{clinic_id}/patients/{patient_id}/{document_id}.{ext}`, assigned by a trigger, never by the client | `tests/db/tenancy.test.ts` |
| Access by membership and patient permission | **Upload:** allowed only to the exact path of a pending `patient_documents` row the caller created, with clinical write access to that patient. **Read:** clients have **no** `SELECT` on patient files. Downloads go through `document-url`, which checks access with the caller's JWT first. **Branding** files: members read, `settings.manage` writes. | `tests/db/security.test.ts` (cross-clinic read, overwrite and plant attempts fail) |
| File type and size validation | Browser (`validateDocumentFile`), table checks (`mime_type`, `size_bytes` ≤ 10 MB) and the bucket limits, independently | `services/documents.test.ts`, `security.test.ts` |
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

### 1. Row Level Security on every tenant-owned table
- RLS is enabled on **every** `public` table. A test fails if one is added without it.
- No policy grants access merely for being signed in, except two non-tenant reference tables (`permissions`, `role_permissions`).
- `DELETE` is granted to API users on only two tables (`member_branches`, draft `prescription_items`). `anon` has no table grants at all. Both are asserted by tests.
- Policies are separate per command (`SELECT` / `INSERT` / `UPDATE` / `DELETE`); DATABASE.md lists each one.

### 2. Least privilege
- Permissions are data (`role_permissions`). Admins don't read clinical notes; doctors see only their patients; branch scope narrows further.
- Platform operators have no tenant data access ([PERMISSIONS.md](PERMISSIONS.md)).
- Privileged helpers live in the non-exposed `private` schema. Only the policy helpers are executable by `authenticated`.
- Service-only RPCs (`log_document_access`, `consume_rate_limit`, `purge_*`, `find_user_id_by_email`) are granted to `service_role` only.

### 3. Server-side permission checks
Every definer RPC loads the target row and checks `has_permission()` against **that row's** clinic, never an argument. Edge Functions authorise with the caller's own JWT before using the service role. See [API.md §3](API.md#authorization-never-trust-the-client).

### 4. Session handling
- Supabase Auth issues short-lived JWTs (1 hour) with rotating refresh tokens (`enable_refresh_token_rotation`). The minimum password length is 10, with mixed case and a digit.
- If a session expires or is revoked, the app signs out locally and explains why. Signing out clears all cached data.
- Membership and permission changes take effect within 5 minutes, on window focus, or immediately after any refused request.
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
| Sign-in / sign-up | 30 per IP per 5 minutes (Supabase Auth) |
| OTP / token verification | 30 per IP per 5 minutes (Supabase Auth) |
| Opening patient records | 300 per user per 10 minutes (`view_patient`); refusals are audited as `security.rate_limited` |
| Staff invitations | 20 per inviter per hour (`invite-member`) |
| Document links | 120 per user per 10 minutes (`document-url`) |

Direct table reads are protected by RLS and pagination rather than counters. Supabase's API gateway limits apply on top. A production deployment should add a WAF or edge rule for abusive IPs.

### 9. Data retention and deletion
| Data | Policy |
| --- | --- |
| Clinical records (patients, consultations, examinations, prescriptions, investigations, documents) | **Never hard-deleted by the app.** Retained at least **3 years from the last visit**, the minimum in Indian Medical Council regulations; clinics often keep longer. Corrections are made by amendment, revision or soft delete. |
| Financial records (invoices, payments, refunds) | Never deleted; retain at least **8 years** for tax records. Corrections by void or refund. |
| Audit events | `clinics.audit_retention_days` (default 2920 days, minimum 1095), purged by `purge_expired_audit_events()` (service role, scheduled) |
| Notifications | Can be purged after 90 days (generic content only) |
| Rate-limit counters | Pruned automatically on each use |
| Closed clinics | Status `closed`; export and deletion follow the contract with the clinic, executed by operations and recorded |
| Patient requests (access, correction, erasure) | Handled by the clinic. Erasure must respect the medical-record retention duty above. |

### 10. Audit trails
- `audit_events` is append-only, even for the database owner (trigger).
- It records who did what to which record, field **names** for updates, patient views, document access, membership and role changes, platform actions and rate-limit refusals.
- It never stores names, phone numbers, notes or clinical values; a test scans the table for them.

### 11. Error monitoring without patient details
`src/lib/monitoring.ts` reports only an error's type and code, the route **pattern** (ids and query strings removed), the environment and a timestamp. It never includes messages, payloads or URLs with ids (tested). It is connected to route errors and query and mutation failures. A provider is attached with `setErrorSink()`; for example, Sentry with `sendDefaultPii: false` and breadcrumbs, replay and request bodies disabled. Edge Functions log only error **codes**.

### 12. Cross-tenant leakage protection
- `clinic_id` is immutable and composite foreign keys apply everywhere. Query caches are keyed by clinic and dropped on switch.
- **Automated tests** (`tests/db/security.test.ts`, `tenancy.test.ts`) have a fully privileged owner of clinic B try to read, open, edit, delete, bill, re-issue, revise, confirm, sign, overwrite or plant files for clinic A's **patient, appointment, prescription and documents**, through tables, RPCs and storage. Every attempt fails.

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
| Incident | Suspend the affected clinic (`platform_set_clinic_status`), preserve audit events, assess, and notify per DPDP obligations. |

### 15. Safe database migrations
- Forward-only, timestamp-ordered files; already-applied migrations are not edited. Fixes go in a new migration.
- A test enforces naming and ordering. It fails on any `DROP TABLE`, `TRUNCATE`, `DROP COLUMN` or unqualified `DELETE` that isn't in a reviewed allowlist, and on any migration that disables RLS or grants table access to `anon`.
- CI applies **all** migrations to a fresh Postgres (PGlite) and runs the RLS suite on every push. Generated docs must match the migrations.
- Before production: run `supabase db push --dry-run` and review the list; take a backup or PITR marker first.

### 16. Seed data
`scripts/seed-demo.ts` uses fictional people and `.test` email domains only. It marks the clinic `settings.demo = true`, so dashboards show a "Demo data" notice.
