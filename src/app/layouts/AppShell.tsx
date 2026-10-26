import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Building2, Check, ChevronsLeft, ChevronsRight, Languages, LogOut, Menu, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import * as RadixDialog from '@radix-ui/react-dialog';
import { NAV_SECTIONS } from '@/app/navigation';
import { Avatar } from '@/components/data-display/Avatar';
import { BrandLockup, BrandMark } from '@/components/ui/BrandMark';
import { IconButton } from '@/components/ui/Button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/DropdownMenu';
import { Tooltip } from '@/components/ui/Tooltip';
import { useCurrentUser } from '@/features/auth/AuthProvider';
import { useClinic } from '@/features/clinic/ClinicProvider';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/formatters';
import { qk } from '@/lib/query/keys';
import { useI18n } from '@/locales/i18n';
import { signOut } from '@/services/auth';
import { listNotifications, markNotificationsRead } from '@/services/reports';

const COLLAPSE_KEY = 'vaidyora.sidebarCollapsed';

function SidebarNav({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const { t } = useI18n();
  const { can } = useClinic();
  return (
    <nav aria-label={t('nav.main')} className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
      {NAV_SECTIONS.map((section) => {
        const items = section.items.filter((i) => can(i.requirement));
        if (items.length === 0) return null;
        return (
          <div key={section.label}>
            {!collapsed && <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-sage/60">{t(section.label)}</p>}
            <ul className="space-y-0.5">
              {items.map((item) => {
                const link = (
                  <NavLink
                    to={item.to}
                    end={item.end}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn(
                        'group flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors duration-fast',
                        'focus-visible:shadow-[0_0_0_2px_var(--color-gold)]',
                        isActive ? 'bg-forest text-ink-inverse' : 'text-sage/85 hover:bg-forest/50 hover:text-ink-inverse',
                        collapsed && 'justify-center px-0',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <item.icon className={cn('size-[18px] shrink-0', isActive ? 'text-gold' : 'text-sage/70 group-hover:text-sage')} aria-hidden />
                        <span className={cn(collapsed && 'sr-only')}>{t(item.label)}</span>
                      </>
                    )}
                  </NavLink>
                );
                return <li key={item.to}>{collapsed ? <Tooltip content={t(item.label)} side="right">{link}</Tooltip> : link}</li>;
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function NotificationsMenu() {
  const { t } = useI18n();
  const { clinicId } = useClinic();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data = [] } = useQuery({ queryKey: qk.notifications(clinicId), queryFn: () => listNotifications(clinicId), refetchInterval: 60_000 });
  const unread = data.filter((n) => !n.read_at);

  async function markAll() {
    await markNotificationsRead(unread.map((n) => n.id));
    await queryClient.invalidateQueries({ queryKey: qk.notifications(clinicId) });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="relative inline-flex size-10 items-center justify-center rounded-md text-ink hover:bg-sage/70"
          aria-label={`${t('common.notifications')}${unread.length ? ` (${unread.length})` : ''}`}
        >
          <Bell className="size-[18px]" aria-hidden />
          {unread.length > 0 && <span aria-hidden className="absolute right-2 top-2 size-2 rounded-full bg-danger ring-2 ring-surface" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-80">
        <div className="flex items-center justify-between px-2.5 py-1.5">
          <DropdownMenuLabel>{t('common.notifications')}</DropdownMenuLabel>
          {unread.length > 0 && (
            <button type="button" className="text-xs font-medium text-forest hover:underline" onClick={markAll}>
              {t('common.markAllRead')}
            </button>
          )}
        </div>
        <DropdownMenuSeparator />
        {data.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-ink-muted">{t('common.noNotifications')}</p>
        ) : (
          data.slice(0, 8).map((n) => (
            <DropdownMenuItem
              key={n.id}
              onSelect={() => {
                void markNotificationsRead([n.id]).then(() => queryClient.invalidateQueries({ queryKey: qk.notifications(clinicId) }));
                if (n.link) navigate(n.link);
              }}
            >
              <span className="flex w-full items-start gap-2">
                <span aria-hidden className={cn('mt-1.5 size-2 shrink-0 rounded-full', n.read_at ? 'bg-transparent' : 'bg-forest')} />
                <span className="min-w-0">
                  <span className={cn('block', !n.read_at && 'font-medium')}>{n.title}</span>
                  <span className="tabular block text-xs text-ink-muted">{formatDateTime(n.created_at)}</span>
                </span>
              </span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserMenu() {
  const { t, locale, setLocale, bilingual, setBilingualChoice } = useI18n();
  const user = useCurrentUser();
  const { roles, memberships, clinicId, switchClinic } = useClinic();
  const navigate = useNavigate();
  const name = (user.user_metadata.full_name as string | undefined) || user.email || '';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="flex items-center gap-2 rounded-md py-1 pl-1 pr-2 hover:bg-sage/70" aria-label={t('nav.accountMenu', { name })}>
          <Avatar name={name} size="sm" tone="gold" />
          <span className="hidden text-left leading-tight md:block">
            <span className="block max-w-[10rem] truncate text-sm font-medium">{name}</span>
            <span className="block text-xs text-ink-muted">{roles.map((r) => t(`roles.${r}`)).join(' · ')}</span>
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-64">
        <DropdownMenuLabel>{user.email}</DropdownMenuLabel>
        <DropdownMenuItem icon={<UserRound />} onSelect={() => navigate('/profile')}>
          {t('settings.myProfile')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t('common.language')}</DropdownMenuLabel>
        <DropdownMenuItem icon={locale === 'en' ? <Check /> : <Languages />} onSelect={() => setLocale('en')}>
          English
        </DropdownMenuItem>
        <DropdownMenuItem icon={locale === 'mr' ? <Check /> : <Languages />} onSelect={() => setLocale('mr')}>
          मराठी
        </DropdownMenuItem>
        <DropdownMenuItem icon={bilingual ? <Check /> : <Languages />} onSelect={() => setBilingualChoice(!bilingual)}>
          {t('common.bilingualLabels')}
        </DropdownMenuItem>
        {memberships.length > 1 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{t('common.switchClinic')}</DropdownMenuLabel>
            {memberships.map((m) => (
              <DropdownMenuItem key={m.clinic_id} icon={m.clinic_id === clinicId ? <Check /> : <Building2 />} onSelect={() => switchClinic(m.clinic_id)}>
                {m.clinic?.name ?? "—"}
              </DropdownMenuItem>
            ))}
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem icon={<LogOut />} onSelect={() => void signOut().then(() => navigate('/auth/sign-in'))}>
          {t('common.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Visible reminder outside production that this is a development/demo/staging environment. */
function EnvironmentBanner() {
  const { t } = useI18n();
  const env = import.meta.env.VITE_APP_ENV ?? 'development';
  if (env === 'production') return null;
  return (
    <div role="note" className="no-print border-b border-gold bg-gold-soft px-4 py-1.5 text-center text-xs font-medium text-gold-ink">
      {t('common.demoEnvironment', { env: env.charAt(0).toUpperCase() + env.slice(1) })}
    </div>
  );
}

export function AppShell() {
  const { t } = useI18n();
  const { clinic } = useClinic();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => setMobileOpen(false), [location.pathname]);

  function toggleCollapsed() {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1');
      } catch {
        /* ignore */
      }
      return !c;
    });
  }

  return (
    <div className="min-h-dvh bg-ivory">
      <a href="#main" className="sr-only z-toast rounded bg-surface px-3 py-2 focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
        {t('nav.skipToContent')}
      </a>

      {/* Desktop sidebar */}
      <aside
        className={cn(
          'no-print fixed inset-y-0 left-0 z-sticky hidden flex-col bg-forest-deep transition-[width] duration-base lg:flex',
          collapsed ? 'w-sidebar-collapsed' : 'w-sidebar',
        )}
      >
        <div className={cn('flex h-header items-center border-b border-forest px-4', collapsed && 'justify-center px-0')}>
          {collapsed ? <BrandMark inverted /> : <BrandLockup tone="light" />}
        </div>
        <SidebarNav collapsed={collapsed} />
        <div className={cn('border-t border-forest p-3', collapsed && 'flex justify-center')}>
          <button
            type="button"
            onClick={toggleCollapsed}
            className="flex h-9 w-full items-center gap-2 rounded-md px-3 text-sm text-sage/80 hover:bg-forest/50 hover:text-ink-inverse"
            aria-label={collapsed ? t('nav.expand') : t('nav.collapse')}
          >
            {collapsed ? <ChevronsRight className="mx-auto size-4" aria-hidden /> : <ChevronsLeft className="size-4" aria-hidden />}
            {!collapsed && <span>{t('nav.collapse')}</span>}
          </button>
        </div>
      </aside>

      {/* Mobile / tablet drawer */}
      <RadixDialog.Root open={mobileOpen} onOpenChange={setMobileOpen}>
        <RadixDialog.Portal>
          <RadixDialog.Overlay className="fixed inset-0 z-drawer bg-forest-deep/40 lg:hidden" />
          <RadixDialog.Content aria-describedby={undefined} className="fixed inset-y-0 left-0 z-drawer flex w-72 max-w-[85vw] flex-col bg-forest-deep lg:hidden">
            <RadixDialog.Title className="sr-only">{t('nav.openMenu')}</RadixDialog.Title>
            <div className="flex h-header items-center border-b border-forest px-4">
              <BrandLockup tone="light" />
            </div>
            <SidebarNav collapsed={false} onNavigate={() => setMobileOpen(false)} />
          </RadixDialog.Content>
        </RadixDialog.Portal>
      </RadixDialog.Root>

      <div className={cn('flex min-h-dvh flex-col transition-[padding] duration-base', collapsed ? 'lg:pl-[var(--layout-sidebar-collapsed)]' : 'lg:pl-[var(--layout-sidebar)]')}>
        <header className="no-print sticky top-0 z-sticky flex h-header items-center gap-2 border-b border-line bg-surface/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-surface/85 sm:px-4">
          <IconButton className="lg:hidden" label={t('nav.openMenu')} icon={<Menu />} onClick={() => setMobileOpen(true)} />
          <Link to="/" className="flex min-w-0 items-center gap-2 rounded lg:hidden" aria-label={t('nav.home')}>
            <BrandMark className="size-7" />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-sm font-semibold text-ink sm:text-base">{clinic.name}</p>
          </div>
          <NotificationsMenu />
          <UserMenu />
        </header>
        <EnvironmentBanner />
        <main id="main" tabIndex={-1} className="page-x mx-auto w-full max-w-content flex-1 py-[var(--space-page-y)] focus:outline-none">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
