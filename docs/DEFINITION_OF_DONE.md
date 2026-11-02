# Vaidyora — Definition of Done status

Each feature is scored against the twelve criteria of Phase 15.

**Key:** ✅ met and evidenced · 🟡 met in code, not yet verified end-to-end against the live backend · ❌ not met. No feature currently has a ❌.

## Criteria

| # | Criterion | How it is checked |
| --- | --- | --- |
| 1 | Shared design system | Tokens in `tokens.css`, shared components only; axe A/AA clean on reachable screens |
| 2 | Desktop, tablet, mobile | Tailwind breakpoints; Playwright no-overflow checks on desktop (1280), tablet (iPad Mini) and phone (Pixel 7) for reachable screens |
| 3 | Meaningful validation | Zod schemas (unit-tested) + database constraints |
| 4 | Persisted through the intended backend | Services call PostgREST, RPCs or Edge Functions; no mocks outside tests; "Backend not configured" screen otherwise |
| 5 | Tenant and role permissions enforced | RLS and RPC checks (102 DB tests); UI guards (component tests) |
| 6 | Loading, empty, success, failure states | Shared states; component tests for representative screens |
| 7 | TypeScript checks pass | `tsc -b` strict, no `any` (lint rule) |
| 8 | Relevant automated tests pass | 222 Vitest + 48 Playwright (9 skipped by design) |
| 9 | Sensitive actions audited | Triggers on every clinical, billing and membership table; view, access and security events |
| 10 | No secrets committed | Guard test + repository and history scan (only a dummy test string matches) |
| 11 | No fabricated success | Every success toast sits in an `onSuccess` handler or after an awaited server call (audited 02/11/2026); failures keep dialogs open and show safe errors |
| 12 | Limitations documented | [FEATURES.md](FEATURES.md), [RELEASE.md](RELEASE.md), this table |

## Status per feature

| Feature | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| Sign-in, recovery, invitations, clinic picker | ✅ | ✅ | ✅ | 🟡 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Patient registration, profile, consents | ✅ | 🟡 | ✅ | 🟡 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Appointments (day/week, booking, transitions, follow-ups) | ✅ | 🟡 | ✅ | 🟡 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Consultation and रुग्णपत्रिका, amendments | ✅ | 🟡 | ✅ | 🟡 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Ayurvedic examination incl. clinic fields | ✅ | 🟡 | ✅ | 🟡 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Prescriptions (editor, review, revisions, templates) | ✅ | 🟡 | ✅ | 🟡 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Printed prescription (A4, EN/MR) | ✅ | ✅ | n/a | 🟡 | ✅ | ✅ | ✅ | ✅ | n/a | ✅ | ✅ | ✅ |
| Investigations and documents (upload, progress, signed links) | ✅ | 🟡 | ✅ | 🟡¹ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Billing (invoices, payments, refunds, receipts, reconciliation) | ✅ | 🟡 | ✅ | 🟡² | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Dashboards and reports | ✅ | 🟡 | ✅ | 🟡 | ✅ | ✅ | ✅ | ✅ | n/a | ✅ | ✅ | ✅ |
| Staff, branches, roles, access reviews | ✅ | 🟡 | ✅ | 🟡¹ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Clinic settings and preferences | ✅ | 🟡 | ✅ | 🟡 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Audit log viewer | ✅ | 🟡 | n/a | 🟡 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Notifications | ✅ | 🟡 | n/a | 🟡 | ✅ | ✅ | ✅ | ✅ | n/a | ✅ | ✅ | ✅ |
| Platform boundary and subscriptions | n/a³ | n/a | ✅ | ✅ | ✅ | n/a | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

**Notes**
- **🟡 in column 2:** signed-in screens use the same responsive components that are verified on reachable screens, but they haven't been checked at three sizes against live data.
- **🟡 in column 4:** the code paths are real and their database side is tested in PGlite, but they haven't been clicked through against the hosted project. That project is currently **paused**, and blocker **B7** in [RELEASE.md](RELEASE.md) covers the live run.
- ¹ Needs the Edge Functions deployed (**B2**).
- ² Needs migration 0015 on the hosted project (**B1**).
- ³ No UI by design; operators use SQL or RPCs.

**Fixes made during this audit**
- Notification "mark read" failures were silently swallowed; they now show an error.
- Session-event failures now go to the scrubbed error monitor.
- A tablet profile was added to the Playwright suite.
