# Vaidyora — User journeys

The journeys the product is built around, for the two enabled roles. Permissions are listed in [PERMISSIONS.md](PERMISSIONS.md); the screens are linked to their routes. Each step names the safeguard that applies, so reviewers can check the journey against the rules.

Personas (fictional):
- **Snehal, clinic administrator.** Front desk and owner's office: registers patients, runs the schedule, bills, manages staff.
- **Dr. Meera, doctor.** Sees her own patients, records consultations and prescriptions.
- **Dr. Ujjwal, owner.** Holds both roles in one clinic.

## 1. Getting in

| Step | Screen | What happens | Safeguard |
| --- | --- | --- | --- |
| Sign in | `/auth/sign-in` | Email and password; English or मराठी | Auth rate limits; generic error for wrong credentials |
| Accept an invitation (first time) | Invitation screen | "Join *clinic* as Doctor" → Accept | No access until accepted |
| Choose a clinic (several memberships) | Clinic picker | Pick one; switch later from the account menu | Cache of the previous clinic is dropped |
| Suspended clinic | Suspended screen | Explains why; other clinics remain available | Server refuses all data for that clinic |
| Session expires | Sign-in | "Your session has expired" | Local sign-out, cache cleared |

## 2. Administrator (Snehal)

### 2.1 Morning: open the day
1. **Dashboard** (`/`): today's appointments, pending and overdue follow-ups, net collections, outstanding, unreconciled payments, trends, branch comparison, recent activity. *Counts only; no clinical notes.*
2. **Today's schedule** on the dashboard → **Appointments** (`/appointments`), day or week view, filtered by doctor and status.

### 2.2 A new patient walks in
1. **Patients → Register patient** (drawer). Only the first name is required; mobile, address, approximate age, occupation and language are optional (data minimisation).
2. **Patient profile → Consents → Record consent** (treatment, data processing, SMS or WhatsApp reminders).
3. **Book appointment**: patient picker, doctor, branch, date and time, duration, type, source. *An overlapping slot for the same doctor is refused by the database.*
4. On arrival: **Check in** (actions menu). *The state machine allows only valid next steps.*

### 2.3 After the visit
1. **New invoice** from the profile: consultation fee prefilled; lines, GST %, discount. *Totals are computed by the server in paise; a double click creates one invoice (request key).*
2. **Record payment**: UPI, cash, card or bank; partial payments allowed. *No overpayment; one payment per request key; a receipt number is assigned.*
3. **Print invoice / receipt** (A4).
4. **Refund** if needed: reason required, never more than was paid.

### 2.4 Follow-ups
Dashboard **Follow-ups due** → **Book** (date and time). *Creates the appointment and links the follow-up in one transaction.*

### 2.5 End of day / week
- **Billing → Payments**: filter unreconciled → **Reconcile** with the bank or UPI settlement reference.
- **Reports**: registrations, appointments, consultations and collections over a range; branch comparison.
- **Prescriptions**: search issued prescriptions by number or patient and reprint. *Drafts and consultation notes are never visible to admins.*

### 2.6 Staff and clinic
- **Staff & Access**: invite (email), assign Admin and/or Doctor, limit to branches, suspend. *Plan limits; the last admin can't be removed; changes are audited with before and after roles.*
- **Access review** (every 90 days): check roles, branches and last activity → record the review.
- **Clinic Settings**: profile, GSTIN, time zone, invoice prefix, fee, preferences (bilingual labels, prescription language, consultation sections), branches, examination fields, subscription (read-only).
- **Audit Log**: filter by record type and action. *Field names only, never values.*

## 3. Doctor (Dr. Meera)

The ten-step clinical workflow from the brief, as implemented:

| # | Step | Screen | Safeguard |
| --- | --- | --- | --- |
| 1 | Open the patient profile | Dashboard **queue** or **recently opened patients** → `/patients/:id` | Only assigned or booked patients; every open is audited; bulk-opening brake |
| 2 | Review history | Profile tabs: Visits (with examination summary), Prescriptions, Investigations, Documents, Follow-ups | Drafts of other doctors are not visible |
| 3 | Start the consultation | Queue → **Start consultation** (moves the appointment to *In consultation*) | Treating doctor only |
| 4 | Required clinical fields | **Chief complaint** (the only required field) | See [FEATURES.md](FEATURES.md#patient-history-form--required-fields-and-why) |
| 5 | Ayurvedic examination | रुग्णपत्रिका header, वेदना विशेष, family history (मातृज / पितृज / स्वकुल), रजोइतिहास (when relevant), vitals and BMI, Prakriti, Vikriti, dosha ratings, Agni, Ama, Koshtha, Bala, Ashtavidha Pariksha, दिनचर्या, सामान्य परीक्षण, clinic-specific fields | Recorded by the clinician; the app never diagnoses |
| 6 | Assessment and plan | Findings, assessment, diagnoses, treatment plan, pathya / apathya, follow-up date, private notes | Autosave is manual (**Save draft**); unsaved-changes warning |
| 7 | Create a prescription | **Write prescription**: medicines, form, route, dose, quantity, frequency, timing, anupana, duration, English and Marathi instructions; apply own or shared **template** | Templates hold only what clinicians wrote |
| 8 | Review and finalize | **Issue prescription** → tick "I have reviewed every medicine, dose…" | The database refuses to issue without the confirmation; number assigned; immutable revision stored |
| 9 | Print or export | **Print** → A4 in the prescription's language → browser print or "Save as PDF" | Private notes never print |
| 10 | Schedule follow-up | Follow-up date on the consultation → **Finalize consultation** | Record locks; follow-up created for the front desk |

**Corrections afterwards**
- **Consultation:** finalized records are never edited. **Add amendment** (reason and text), and the record shows *Amended*.
- **Prescription:** **Revise** (reason required) opens revision 2 with the same number; revision 1 stays in the history. Or **Cancel**.

**Investigations and documents**
- **Order investigation** → **Record result** → **Attach report** (upload with progress).
- Opening a report gives a 60-second link and is audited.

## 4. Owner (Dr. Ujjwal, Admin + Doctor)
The dashboard shows **My clinical workspace** first, then **Clinic overview**. Navigation includes both clinical and administrative modules. Permissions are the union of both roles.

## 5. Platform operator (Vxora Tech)
Not a clinic user. Uses `platform_*` functions to list clinics (metadata only), set plans, and suspend or reactivate clinics. There is no UI yet; this is a trusted, separate boundary.
