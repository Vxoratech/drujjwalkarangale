# Vaidyora — User journeys

The journeys the product is built around: the primary doctor, an administrator and staff. Permissions are listed in [PERMISSIONS.md](PERMISSIONS.md); the screens are linked to their routes. Each step names the safeguard that applies, so reviewers can check the journey against the rules.

Personas (fictional):
- **Dr. Ujjwal Karangale, primary doctor.** The only clinical author; also manages staff and branches.
- **Snehal, administrator.** Runs the clinic across branches: schedule, billing, staff, settings.
- **Priya, receptionist** (Main Clinic and Dhanori). Registers patients, books and checks in; no clinical access.

## 1. Getting in

| Step | Screen | What happens | Safeguard |
| --- | --- | --- | --- |
| Sign in | `/auth/sign-in` | Email and password; English or मराठी | Auth rate limits; generic error for wrong credentials |
| Accept an invitation (first time) | Invitation email → set password → Accept | Staff join the team | No access until accepted; the email must match the staff record |
| Deactivated or no access | Explanation screen | Contact the administrator | Server returns nothing; sign-in blocked for deactivated staff |
| Session expires | Sign-in | "Your session has expired" | Local sign-out, cache cleared |

## 2. Administrator (Snehal)

### 2.1 Morning: open the day
1. **Dashboard** (`/`): today's appointments, pending and overdue follow-ups, net collections, outstanding, unreconciled payments, trends, branch comparison, recent activity. *Counts only; no clinical notes.*
2. **Branch filter** in the header (All branches or one), then **Appointments** (`/appointments`), day or week view, filtered by status.

### 2.2 A new patient walks in
1. **Patients → Register patient** (drawer). Search first: patients are shared by all branches. Only the first name is required. *If a similar record exists (same phone, or similar name and age), Vaidyora shows it; open it, or confirm this is someone else. Nothing is merged automatically.*
2. **Patient profile → Consents → Record consent** (treatment, data processing, SMS or WhatsApp reminders).
3. **Book appointment**: patient, branch, date and time, duration, type, source. *Dr. Ujjwal has one calendar, so an overlapping slot at any branch is refused, as are bookings outside the branch's working hours.*
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

### 2.6 Staff, branches and clinic
- **Staff Management → Add staff**: details → branches → role template → adjust permissions → invite. *Doctor-only permissions are locked; sensitive grants ask for confirmation; everything is audited with the keys granted and revoked.*
- **Staff detail**: edit details and branches, change template or individual permissions, resend invitation, send a password reset, deactivate (reason required, sign-in blocked) or reactivate, view access history.
- **Roles & Permissions**: edit templates (changes apply to everyone on the template; individual overrides stay).
- **Branch Management**: add branches, contact details, manager, working hours, activate or deactivate.
- **Clinic Settings**: organization profile, GSTIN, time zone, invoice prefix, fee, preferences, examination fields.
- **Audit Log**: filter by record type, action and branch. *Field names only, never values.*

## 3. Doctor (Dr. Ujjwal)

The ten-step clinical workflow from the brief, as implemented:

| # | Step | Screen | Safeguard |
| --- | --- | --- | --- |
| 1 | Open the patient profile | Dashboard **queue** or **recently opened patients** → `/patients/:id` | Every open is audited; bulk-opening brake; medical history shown with allergies alert |
| 2 | Review history | Profile tabs: Visits (with examination summary), Prescriptions, Investigations, Documents, Follow-ups | Visits show the branch that handled them |
| 3 | Start the consultation | Queue → **Start consultation** (moves the appointment to *In consultation*) | Doctor only (doctor-only permission) |
| 4 | Required clinical fields | **Chief complaint** (the only required field) | See [FEATURES.md](FEATURES.md#patient-history-form--required-fields-and-why) |
| 5 | Ayurvedic examination | रुग्णपत्रिका header, वेदना विशेष, family history (मातृज / पितृज / स्वकुल), रजोइतिहास (when relevant), vitals and BMI, Prakriti, Vikriti, dosha ratings, Agni, Ama, Koshtha, Bala, Ashtavidha Pariksha, दिनचर्या, सामान्य परीक्षण, clinic-specific fields | Recorded by the clinician; the app never diagnoses |
| 6 | Assessment and plan | Findings, assessment, diagnoses, treatment plan, pathya / apathya, follow-up date, private notes | Autosave is manual (**Save draft**); unsaved-changes warning |
| 7 | Create a prescription | **Write prescription**: medicines, form, route, dose, quantity, frequency, timing, anupana, duration, English and Marathi instructions; apply a **template** | Templates hold only what clinicians wrote |
| 8 | Review and finalize | **Issue prescription** → tick "I have reviewed every medicine, dose…" | The database refuses to issue without the confirmation; number assigned; immutable revision stored |
| 9 | Print or export | **Print** → A4 in the prescription's language → browser print or "Save as PDF" | Private notes never print |
| 10 | Schedule follow-up | Follow-up date on the consultation → **Finalize consultation** | Record locks; follow-up created for the front desk |

**Corrections afterwards**
- **Consultation:** finalized records are never edited. **Add amendment** (reason and text), and the record shows *Amended*.
- **Prescription:** **Revise** (reason required) opens revision 2 with the same number; revision 1 stays in the history. Or **Cancel**.

**Investigations and documents**
- **Order investigation** → **Record result** → **Attach report** (upload with progress).
- Opening a report gives a 60-second link and is audited.

## 4. Receptionist (Priya)
- Dashboard: today's appointments and follow-ups at her branches.
- Registers patients (duplicate review), edits contact details, records consents, books, reschedules, checks in and cancels.
- Cannot open consultations, examinations, prescriptions, investigations, documents or medical history, by any screen or API call. Cannot see other branches' schedules.
- Anything more (for example billing) is granted individually in Staff Management.

## 5. Primary doctor as administrator
Dr. Ujjwal also adds staff, assigns branches and permissions, appoints and deactivates administrators, and manages branches. His navigation puts clinical work first, with an **Administration** section below.
