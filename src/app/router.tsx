import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { createBrowserRouter, Navigate, Outlet, useLocation, type RouteObject } from 'react-router-dom';
import { ErrorState, FullPageSpinner } from '@/components/feedback/States';
import { useAuth } from '@/features/auth/AuthProvider';
import { ForgotPasswordPage, SetPasswordPage, SignInPage } from '@/features/auth/pages';
import { AccessProvider, useAccessGate } from '@/features/access/AccessProvider';
import { NoAccessScreen } from '@/features/access/GateScreens';
import { RequirePermission } from '@/lib/permissions/Guards';
import { REQUIRES as R, type PermissionRequirement } from '@/lib/permissions/permissions';
import { toUserMessage } from '@/lib/errors';
import { AppShell } from './layouts/AppShell';
import { NotFoundPage, RouteErrorBoundary } from './RouteErrors';

/** Code-split a named page export. */
function page<T extends Record<string, ComponentType>>(loader: () => Promise<T>, name: keyof T) {
  const Lazy = lazy(async () => ({ default: (await loader())[name] as ComponentType }));
  return (
    <Suspense fallback={<FullPageSpinner />}>
      <Lazy />
    </Suspense>
  );
}

function guarded(requirement: PermissionRequirement, element: ReactNode) {
  return <RequirePermission requirement={requirement}>{element}</RequirePermission>;
}

function RequireAuth() {
  const { state, recovery } = useAuth();
  const location = useLocation();
  if (state.status === 'loading') return <FullPageSpinner />;
  if (state.status === 'signed_out') return <Navigate to="/auth/sign-in" replace state={{ from: location.pathname + location.search }} />;
  if (recovery && location.pathname !== '/auth/set-password') return <Navigate to="/auth/set-password" replace />;
  return <Outlet />;
}

/** Resolves the user's account, permissions and branches before any app screen renders. */
function AccessGate() {
  const gate = useAccessGate();
  if (gate.status === 'loading') return <FullPageSpinner />;
  if (gate.status === 'error') return <ErrorState message={toUserMessage(gate.error)} onRetry={gate.retry} />;
  if (gate.status === 'no_access') return <NoAccessScreen reason={gate.reason} />;
  return (
    <AccessProvider value={gate.value}>
      <Outlet />
    </AccessProvider>
  );
}

const appRoutes: RouteObject[] = [
  { index: true, element: page(() => import('@/features/dashboard/DashboardPage'), 'DashboardPage') },
  { path: 'profile', element: page(() => import('@/features/clinic-settings/ProfilePage'), 'ProfilePage') },
  {
    path: 'patients',
    children: [
      { index: true, element: guarded(R.viewPatients, page(() => import('@/features/patients/PatientsPage'), 'PatientsPage')) },
      { path: ':patientId', element: guarded(R.viewPatients, page(() => import('@/features/patients/PatientDetailPage'), 'PatientDetailPage')) },
    ],
  },
  {
    path: 'appointments',
    children: [
      { index: true, element: guarded(R.viewSchedule, page(() => import('@/features/appointments/AppointmentsPage'), 'AppointmentsPage')) },
      { path: ':appointmentId', element: guarded(R.viewSchedule, page(() => import('@/features/appointments/AppointmentDetailPage'), 'AppointmentDetailPage')) },
    ],
  },
  {
    path: 'consultations',
    children: [
      { index: true, element: guarded(R.viewConsultations, page(() => import('@/features/consultations/ConsultationsPage'), 'ConsultationsPage')) },
      { path: 'new', element: guarded(R.writeConsultations, page(() => import('@/features/consultations/ConsultationEditorPage'), 'ConsultationEditorPage')) },
      { path: ':consultationId', element: guarded(R.viewConsultations, page(() => import('@/features/consultations/ConsultationEditorPage'), 'ConsultationEditorPage')) },
    ],
  },
  { path: 'examinations', element: guarded(R.viewExaminations, page(() => import('@/features/consultations/ConsultationsPage'), 'ExaminationsPage')) },
  {
    path: 'prescriptions',
    children: [
      { index: true, element: guarded(R.viewPrescriptions, page(() => import('@/features/prescriptions/PrescriptionsPage'), 'PrescriptionsPage')) },
      { path: 'new', element: guarded(R.createPrescription, page(() => import('@/features/prescriptions/PrescriptionEditorPage'), 'PrescriptionEditorPage')) },
      { path: ':prescriptionId', element: guarded(R.viewPrescriptions, page(() => import('@/features/prescriptions/PrescriptionEditorPage'), 'PrescriptionEditorPage')) },
    ],
  },
  { path: 'investigations', element: guarded(R.viewInvestigations, page(() => import('@/features/investigations/InvestigationsPage'), 'InvestigationsPage')) },
  { path: 'follow-ups', element: guarded(R.viewFollowUps, page(() => import('@/features/follow-ups/FollowUpsPage'), 'FollowUpsPage')) },
  {
    path: 'billing',
    children: [
      { index: true, element: guarded(R.viewBilling, page(() => import('@/features/billing/InvoicesPage'), 'InvoicesPage')) },
      { path: 'payments', element: guarded(R.viewBilling, page(() => import('@/features/billing/PaymentsPage'), 'PaymentsPage')) },
      { path: 'new', element: guarded('billing.create', page(() => import('@/features/billing/CreateInvoicePage'), 'CreateInvoicePage')) },
      { path: ':invoiceId', element: guarded(R.viewBilling, page(() => import('@/features/billing/InvoiceDetailPage'), 'InvoiceDetailPage')) },
    ],
  },
  { path: 'reports', element: guarded(R.viewReports, page(() => import('@/features/reports/ReportsPage'), 'ReportsPage')) },
  { path: 'branches', element: guarded(R.manageBranches, page(() => import('@/features/branches/BranchesPage'), 'BranchesPage')) },
  {
    path: 'staff',
    children: [
      { index: true, element: guarded(R.manageStaff, page(() => import('@/features/staff/StaffPage'), 'StaffPage')) },
      { path: ':staffId', element: guarded(R.manageStaff, page(() => import('@/features/staff/StaffDetailPage'), 'StaffDetailPage')) },
    ],
  },
  { path: 'roles', element: guarded(R.managePermissions, page(() => import('@/features/staff/RolesPage'), 'RolesPage')) },
  { path: 'settings', element: guarded(R.manageSettings, page(() => import('@/features/clinic-settings/SettingsPage'), 'SettingsPage')) },
  { path: 'audit', element: guarded(R.viewAuditLogs, page(() => import('@/features/audit-logs/AuditLogPage'), 'AuditLogPage')) },
  { path: '*', element: <NotFoundPage /> },
];

export const routes: RouteObject[] = [
  {
    errorElement: <RouteErrorBoundary />,
    children: [
      { path: '/auth/sign-in', element: <SignInPage /> },
      { path: '/auth/forgot', element: <ForgotPasswordPage /> },
      // Dev-only component gallery; tree-shaken from production builds.
      ...(import.meta.env.DEV
        ? [
            { path: '/__gallery', element: page(() => import('@/dev/Gallery'), 'Gallery') },
            { path: '/__fixtures/prescription', element: page(() => import('@/dev/PrintFixture'), 'PrintFixture') },
          ]
        : []),
      {
        element: <RequireAuth />,
        children: [
          { path: '/auth/set-password', element: <SetPasswordPage /> },
          {
            element: <AccessGate />,
            children: [
              // Print views render without the app chrome.
              {
                path: '/print/prescriptions/:prescriptionId',
                element: guarded(['prescriptions.print', 'prescriptions.create'], page(() => import('@/features/prescriptions/PrescriptionPrintPage'), 'PrescriptionPrintPage')),
              },
              { path: '/print/invoices/:invoiceId', element: guarded(R.viewBilling, page(() => import('@/features/billing/InvoicePrintPage'), 'InvoicePrintPage')) },
              { path: '/print/receipts/:paymentId', element: guarded(R.viewBilling, page(() => import('@/features/billing/ReceiptPrintPage'), 'ReceiptPrintPage')) },
              { path: '/', element: <AppShell />, children: appRoutes },
            ],
          },
        ],
      },
    ],
  },
];

export function createAppRouter() {
  return createBrowserRouter(routes);
}
