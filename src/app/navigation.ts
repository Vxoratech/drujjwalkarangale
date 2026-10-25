import { CalendarDays, IndianRupee, LayoutDashboard, LineChart, ScrollText, Settings, Stethoscope, Users, UsersRound, type LucideIcon } from 'lucide-react';
import { CAN_VIEW_PATIENTS, CAN_VIEW_SCHEDULE, type PermissionRequirement } from '@/lib/permissions/permissions';
import type { TranslationKey } from '@/locales/i18n';

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

/** Single source of truth for navigation; items are filtered by permission. */
export const NAV_SECTIONS: NavSection[] = [
  {
    label: 'nav.sectionClinic',
    items: [
      { to: '/', label: 'nav.dashboard', icon: LayoutDashboard, end: true },
      { to: '/appointments', label: 'nav.appointments', icon: CalendarDays, requirement: CAN_VIEW_SCHEDULE },
      { to: '/patients', label: 'nav.patients', icon: UsersRound, requirement: CAN_VIEW_PATIENTS },
    ],
  },
  {
    label: 'nav.sectionCare',
    items: [
      { to: '/consultations', label: 'nav.consultations', icon: Stethoscope, requirement: 'clinical.write' },
      { to: '/billing', label: 'nav.billing', icon: IndianRupee, requirement: 'billing.read' },
      { to: '/reports', label: 'nav.reports', icon: LineChart, requirement: 'reports.read' },
    ],
  },
  {
    label: 'nav.sectionAdmin',
    items: [
      { to: '/staff', label: 'nav.staff', icon: Users, requirement: ['users.read', 'users.manage'] },
      { to: '/settings', label: 'nav.settings', icon: Settings, requirement: 'settings.manage' },
      { to: '/audit', label: 'nav.audit', icon: ScrollText, requirement: 'audit.read' },
    ],
  },
];

