import {
  Building2,
  CalendarCheck2,
  CalendarDays,
  FlaskConical,
  IndianRupee,
  KeyRound,
  LayoutDashboard,
  Leaf,
  LineChart,
  Pill,
  ScrollText,
  Settings,
  Stethoscope,
  UserRound,
  Users,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';
import { REQUIRES, type PermissionRequirement } from '@/lib/permissions/permissions';
import type { TranslationKey } from '@/locales/i18n';
import type { AccountType } from '@/types/domain';

export interface NavItem {
  to: string;
  label: TranslationKey;
  icon: LucideIcon;
  requirement?: PermissionRequirement;
  end?: boolean;
}

export interface NavSection {
  label: TranslationKey;
  items: NavItem[];
}

const item = (to: string, label: TranslationKey, icon: LucideIcon, requirement?: PermissionRequirement, end?: boolean): NavItem => ({ to, label, icon, requirement, end });

const ADMIN: NavSection[] = [
  {
    label: 'nav.sectionClinic',
    items: [
      item('/', 'nav.overview', LayoutDashboard, undefined, true),
      item('/patients', 'nav.patients', UsersRound, REQUIRES.viewPatients),
      item('/appointments', 'nav.appointments', CalendarDays, REQUIRES.viewSchedule),
      item('/consultations', 'nav.consultations', Stethoscope, REQUIRES.viewConsultations),
      item('/prescriptions', 'nav.prescriptions', Pill, REQUIRES.viewPrescriptions),
      item('/investigations', 'nav.investigations', FlaskConical, REQUIRES.viewInvestigations),
      item('/billing', 'nav.billing', IndianRupee, REQUIRES.viewBilling),
      item('/reports', 'nav.reports', LineChart, REQUIRES.viewReports),
    ],
  },
  {
    label: 'nav.sectionAdmin',
    items: [
      item('/branches', 'nav.branches', Building2, REQUIRES.manageBranches),
      item('/staff', 'nav.staff', Users, REQUIRES.manageStaff),
      item('/roles', 'nav.roles', KeyRound, REQUIRES.managePermissions),
      item('/audit', 'nav.audit', ScrollText, REQUIRES.viewAuditLogs),
      item('/settings', 'nav.settings', Settings, REQUIRES.manageSettings),
    ],
  },
];

const DOCTOR: NavSection[] = [
  {
    label: 'nav.sectionCare',
    items: [
      item('/', 'nav.doctorDashboard', LayoutDashboard, undefined, true),
      item('/appointments', 'nav.todaysAppointments', CalendarDays, REQUIRES.viewSchedule),
      item('/patients', 'nav.patients', UsersRound, REQUIRES.viewPatients),
      item('/consultations', 'nav.consultations', Stethoscope, REQUIRES.viewConsultations),
      item('/examinations', 'nav.examinations', Leaf, REQUIRES.viewExaminations),
      item('/prescriptions', 'nav.prescriptions', Pill, REQUIRES.viewPrescriptions),
      item('/investigations', 'nav.investigations', FlaskConical, REQUIRES.viewInvestigations),
      item('/follow-ups', 'nav.followUps', CalendarCheck2, REQUIRES.viewFollowUps),
      item('/reports', 'nav.clinicalReports', LineChart, 'reports.clinical'),
      item('/profile', 'nav.myProfile', UserRound),
    ],
  },
  {
    label: 'nav.sectionAdmin',
    items: [
      item('/branches', 'nav.branches', Building2, REQUIRES.manageBranches),
      item('/staff', 'nav.staff', Users, REQUIRES.manageStaff),
      item('/roles', 'nav.roles', KeyRound, REQUIRES.managePermissions),
      item('/billing', 'nav.billing', IndianRupee, REQUIRES.viewBilling),
      item('/audit', 'nav.audit', ScrollText, REQUIRES.viewAuditLogs),
    ],
  },
];

/** Staff see only what their effective permissions allow, in front-desk order. */
const STAFF: NavSection[] = [
  {
    label: 'nav.sectionWork',
    items: [
      item('/', 'nav.dashboard', LayoutDashboard, undefined, true),
      item('/appointments', 'nav.appointments', CalendarDays, REQUIRES.viewSchedule),
      item('/patients', 'nav.patients', UsersRound, REQUIRES.viewPatients),
      item('/follow-ups', 'nav.followUps', CalendarCheck2, REQUIRES.viewFollowUps),
      item('/consultations', 'nav.consultations', Stethoscope, REQUIRES.viewConsultations),
      item('/prescriptions', 'nav.prescriptions', Pill, REQUIRES.viewPrescriptions),
      item('/investigations', 'nav.investigations', FlaskConical, REQUIRES.viewInvestigations),
      item('/billing', 'nav.billing', IndianRupee, REQUIRES.viewBilling),
      item('/reports', 'nav.reports', LineChart, REQUIRES.viewReports),
    ],
  },
  {
    label: 'nav.sectionAdmin',
    items: [
      item('/branches', 'nav.branches', Building2, REQUIRES.manageBranches),
      item('/staff', 'nav.staff', Users, REQUIRES.manageStaff),
      item('/roles', 'nav.roles', KeyRound, REQUIRES.managePermissions),
      item('/audit', 'nav.audit', ScrollText, REQUIRES.viewAuditLogs),
      item('/settings', 'nav.settings', Settings, REQUIRES.manageSettings),
    ],
  },
];

/** Navigation for an account; items are then filtered by effective permission. */
export function navigationFor(account: AccountType): NavSection[] {
  return account === 'primary_doctor' ? DOCTOR : account === 'admin' ? ADMIN : STAFF;
}
