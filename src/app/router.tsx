import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { createBrowserRouter, Navigate, Outlet, useLocation, type RouteObject } from 'react-router-dom';
import { ErrorState, FullPageSpinner } from '@/components/feedback/States';
import { useAuth } from '@/features/auth/AuthProvider';
import { ForgotPasswordPage, SetPasswordPage, SignInPage, SignUpPage } from '@/features/auth/pages';
import { ClinicProvider, useClinicGate } from '@/features/clinic/ClinicProvider';
import { ClinicPickerScreen, InvitationScreen, SuspendedScreen } from '@/features/clinic/GateScreens';
import { OnboardingPage } from '@/features/clinic/OnboardingPage';
import { RequirePermission } from '@/lib/permissions/Guards';
import { CAN_VIEW_PATIENTS, CAN_VIEW_PRESCRIPTIONS, CAN_VIEW_SCHEDULE, type PermissionRequirement } from '@/lib/permissions/permissions';
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

function ClinicGate() {
  const gate = useClinicGate();
  if (gate.status === 'loading') return <FullPageSpinner />;
  if (gate.status === 'error') return <ErrorState message={toUserMessage(gate.error)} onRetry={gate.retry} />;
  if (gate.status === 'no_membership') return <OnboardingPage />;
  if (gate.status === 'pick_clinic') return <ClinicPickerScreen memberships={gate.memberships} choose={gate.choose} />;
  if (gate.status === 'invitation') return <InvitationScreen membership={gate.membership} others={gate.others} choose={gate.choose} />;
  if (gate.status === 'suspended') return <SuspendedScreen membership={gate.membership} others={gate.others} choose={gate.choose} />;
  return (
    <ClinicProvider value={gate.value}>
      <Outlet />
    </ClinicProvider>
  );
}

const appRoutes: RouteObject[] = [
  { index: true, element: page(() => import('@/features/dashboard/DashboardPage'), 'DashboardPage') },
  { path: 'profile', element: page(() => import('@/features/clinic-settings/ProfilePage'), 'ProfilePage') },
  {
    path: 'patients',
    children: [
      { index: true, element: guarded(CAN_VIEW_PATIENTS, page(() => import('@/features/patients/PatientsPage'), 'PatientsPage')) },
      { path: ':patientId', element: guarded(CAN_VIEW_PATIENTS, page(() => import('@/features/patients/PatientDetailPage'), 'PatientDetailPage')) },
    ],
  },
  {
    path: 'appointments',
    children: [
      { index: true, element: guarded(CAN_VIEW_SCHEDULE, page(() => import('@/features/appointments/AppointmentsPage'), 'AppointmentsPage')) },
      { path: ':appointmentId', element: guarded(CAN_VIEW_SCHEDULE, page(() => import('@/features/appointments/AppointmentDetailPage'), 'AppointmentDetailPage')) },
    ],
  },
  {
    path: 'consultations',
    children: [
      { index: true, element: guarded('clinical.write', page(() => import('@/features/consultations/ConsultationsPage'), 'ConsultationsPage')) },
      { path: 'new', element: guarded('clinical.write', page(() => import('@/features/consultations/ConsultationEditorPage'), 'ConsultationEditorPage')) },
      { path: ':consultationId', element: guarded(['clinical.read_all', 'clinical.read_assigned'], page(() => import('@/features/consultations/ConsultationEditorPage'), 'ConsultationEditorPage')) },
    ],
  },
  {
    path: 'prescriptions',
    children: [
      { index: true, element: guarded(CAN_VIEW_PRESCRIPTIONS, page(() => import('@/features/prescriptions/PrescriptionsPage'), 'PrescriptionsPage')) },
      { path: 'new', element: guarded('clinical.write', page(() => import('@/features/prescriptions/PrescriptionEditorPage'), 'PrescriptionEditorPage')) },
      { path: ':prescriptionId', element: guarded(CAN_VIEW_PRESCRIPTIONS, page(() => import('@/features/prescriptions/PrescriptionEditorPage'), 'PrescriptionEditorPage')) },
    ],
  },
  {
    path: 'billing',
    children: [
      { index: true, element: guarded('billing.read', page(() => import('@/features/billing/InvoicesPage'), 'InvoicesPage')) },
      { path: 'payments', element: guarded('billing.read', page(() => import('@/features/billing/PaymentsPage'), 'PaymentsPage')) },
      { path: 'new', element: guarded('billing.create', page(() => import('@/features/billing/CreateInvoicePage'), 'CreateInvoicePage')) },
      { path: ':invoiceId', element: guarded('billing.read', page(() => import('@/features/billing/InvoiceDetailPage'), 'InvoiceDetailPage')) },
    ],
  },
  { path: 'reports', element: guarded('reports.read', page(() => import('@/features/reports/ReportsPage'), 'ReportsPage')) },
  { path: 'staff', element: guarded(['users.read', 'users.manage'], page(() => import('@/features/users/StaffPage'), 'StaffPage')) },
  { path: 'settings', element: guarded('settings.manage', page(() => import('@/features/clinic-settings/SettingsPage'), 'SettingsPage')) },
  { path: 'audit', element: guarded('audit.read', page(() => import('@/features/audit-logs/AuditLogPage'), 'AuditLogPage')) },
  { path: '*', element: <NotFoundPage /> },
];

export const routes: RouteObject[] = [
  {
    errorElement: <RouteErrorBoundary />,
    children: [
      { path: '/auth/sign-in', element: <SignInPage /> },
      { path: '/auth/sign-up', element: <SignUpPage /> },
      { path: '/auth/forgot', element: <ForgotPasswordPage /> },
      // Dev-only component gallery; tree-shaken from production builds.
      ...(import.meta.env.DEV ? [{ path: '/__gallery', element: page(() => import('@/dev/Gallery'), 'Gallery') }] : []),
      {
        element: <RequireAuth />,
        children: [
          { path: '/auth/set-password', element: <SetPasswordPage /> },
          {
            element: <ClinicGate />,
            children: [
              // Print views render without the app chrome.
              {
                path: '/print/prescriptions/:prescriptionId',
                element: guarded(CAN_VIEW_PRESCRIPTIONS, page(() => import('@/features/prescriptions/PrescriptionPrintPage'), 'PrescriptionPrintPage')),
              },
              { path: '/print/invoices/:invoiceId', element: guarded('billing.read', page(() => import('@/features/billing/InvoicePrintPage'), 'InvoicePrintPage')) },
              { path: '/print/receipts/:paymentId', element: guarded('billing.read', page(() => import('@/features/billing/ReceiptPrintPage'), 'ReceiptPrintPage')) },
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
