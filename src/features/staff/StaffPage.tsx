import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, UserPlus, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { DataTable, type Column } from '@/components/data-display/DataTable';
import { Avatar } from '@/components/data-display/Avatar';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/feedback/States';
import { notify } from '@/components/feedback/toast';
import { FormField } from '@/components/forms/FormField';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { ConfirmDialog, Modal } from '@/components/ui/Dialog';
import { Input, SearchInput, Select } from '@/components/ui/Input';
import { PageHeader, Toolbar } from '@/components/ui/PageHeader';
import { useAccess } from '@/features/access/AccessProvider';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { formatDate, formatDateTime } from '@/lib/formatters';
import { qk } from '@/lib/query/keys';
import { requiredText } from '@/lib/validation/schemas';
import { useFieldError } from '@/lib/validation/useFieldError';
import { useI18n } from '@/locales/i18n';
import { fetchAdministrators } from '@/services/organization';
import { fetchStaffLastActivity, inviteAdministrator, listRoleTemplates, listStaff, setAdministratorActive } from '@/services/staff';
import type { Profile, StaffMember, StaffStatus } from '@/types/domain';
import { AddStaffWizard } from './AddStaffWizard';

const STATUS_TONES: Record<StaffStatus, string> = { active: 'completed', invited: 'scheduled', inactive: 'cancelled' };

const adminSchema = z.object({ fullName: requiredText(120, 2), email: z.string().trim().toLowerCase().email() });

/** Doctor-only: administrators are appointed by the primary doctor, never through staff management. */
function AdministratorsCard() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const fieldError = useFieldError();
  const [inviting, setInviting] = useState(false);
  const [toggling, setToggling] = useState<Profile | null>(null);
  const admins = useQuery({ queryKey: qk.admins(), queryFn: fetchAdministrators });
  const form = useForm<z.infer<typeof adminSchema>>({ resolver: zodResolver(adminSchema), defaultValues: { fullName: '', email: '' } });

  const invite = useMutation({
    mutationFn: (v: z.infer<typeof adminSchema>) => inviteAdministrator(v.email, v.fullName),
    onSuccess: async () => {
      notify.success(t('staff.adminInvited'));
      form.reset();
      setInviting(false);
      await queryClient.invalidateQueries({ queryKey: qk.admins() });
    },
    onError: (e) => notify.error(e),
  });

  return (
    <Card>
      <CardHeader
        title={t('staff.administrators')}
        description={t('staff.administratorsHint')}
        actions={
          <Button size="sm" variant="secondary" leftIcon={<ShieldCheck className="size-4" />} onClick={() => setInviting(true)}>
            {t('staff.appointAdmin')}
          </Button>
        }
      />
      {admins.isLoading ? (
        <SkeletonRows rows={2} />
      ) : admins.isError ? (
        <ErrorState compact onRetry={() => void admins.refetch()} />
      ) : admins.data!.length === 0 ? (
        <EmptyState compact icon={<ShieldCheck />} title={t('staff.noAdmins')} />
      ) : (
        <ul className="divide-y divide-line">
          {admins.data!.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <Avatar name={a.full_name || a.email || '—'} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{a.full_name || '—'}</span>
                <span className="block truncate text-xs text-ink-muted">{a.email}</span>
              </span>
              {!a.is_active && <Badge tone="danger">{t('staffStatus.inactive')}</Badge>}
              <Button size="sm" variant="ghost" onClick={() => setToggling(a)}>
                {a.is_active ? t('staff.deactivate') : t('staff.reactivate')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Modal
        open={inviting}
        onOpenChange={(o) => !invite.isPending && setInviting(o)}
        title={t('staff.appointAdmin')}
        description={t('staff.appointAdminHint')}
        closeLabel={t('common.close')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setInviting(false)} disabled={invite.isPending}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" form="admin-form" loading={invite.isPending}>
              {t('staff.sendInviteShort')}
            </Button>
          </>
        }
      >
        <form id="admin-form" noValidate className="space-y-4" onSubmit={form.handleSubmit((v) => invite.mutate(v))}>
          <FormField label={t('staff.fullName')} error={fieldError(form.formState.errors.fullName)} required>
            <Input {...form.register('fullName')} />
          </FormField>
          <FormField label={t('staff.email')} error={fieldError(form.formState.errors.email)} required>
            <Input type="email" {...form.register('email')} />
          </FormField>
        </form>
      </Modal>
      <ConfirmDialog
        open={Boolean(toggling)}
        onOpenChange={(o) => !o && setToggling(null)}
        title={toggling?.is_active ? t('staff.deactivateAdminTitle') : t('staff.reactivate')}
        body={toggling?.is_active ? t('staff.deactivateAdminBody', { name: toggling.full_name }) : t('staff.reactivateAdminBody', { name: toggling?.full_name ?? '' })}
        confirmLabel={toggling?.is_active ? t('staff.deactivate') : t('staff.reactivate')}
        tone={toggling?.is_active ? 'danger' : 'primary'}
        onConfirm={async () => {
          try {
            await setAdministratorActive(toggling!.id, !toggling!.is_active);
            notify.success(t('staff.updated'));
            await queryClient.invalidateQueries({ queryKey: qk.admins() });
          } catch (e) {
            notify.error(e);
            throw e;
          }
        }}
      />
    </Card>
  );
}

export function StaffPage() {
  const { t } = useI18n();
  const { can, isDoctor, branches, branchName } = useAccess();
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StaffStatus | ''>('');
  const [branch, setBranch] = useState('');
  const debounced = useDebouncedValue(search).toLowerCase();

  const staff = useQuery({ queryKey: qk.staff(), queryFn: listStaff });
  const roles = useQuery({ queryKey: qk.roles(), queryFn: listRoleTemplates });
  const activity = useQuery({ queryKey: ['staff-last-activity'], queryFn: fetchStaffLastActivity });
  const roleName = useMemo(() => new Map((roles.data ?? []).map((r) => [r.id, r.name])), [roles.data]);

  const rows = (staff.data ?? []).filter(
    (s) =>
      (!status || s.status === status) &&
      (!branch || s.branch_ids.includes(branch)) &&
      (!debounced || s.full_name.toLowerCase().includes(debounced) || s.email.includes(debounced) || (s.mobile ?? '').includes(debounced)),
  );

  const designationLabel = (s: StaffMember) => (s.designation === 'other' && s.designation_label ? s.designation_label : t(`designation.${s.designation}`));
  const columns: Column<StaffMember>[] = [
    {
      key: 'name',
      header: t('staff.name'),
      cell: (s) => (
        <Link to={`/staff/${s.id}`} className="flex items-center gap-3 rounded" onClick={(e) => e.stopPropagation()}>
          <Avatar name={s.full_name} size="sm" />
          <span className="min-w-0">
            <span className="block truncate font-medium">{s.full_name}</span>
            <span className="block truncate text-xs text-ink-muted">{s.email}</span>
          </span>
        </Link>
      ),
    },
    { key: 'designation', header: t('staff.designation'), cell: (s) => designationLabel(s) },
    { key: 'template', header: t('staff.template'), hideBelow: 'lg', cell: (s) => <span className="text-ink-muted">{roleName.get(s.role_id) ?? '—'}</span> },
    { key: 'branches', header: t('staff.branches'), hideBelow: 'md', cell: (s) => <span className="text-ink-muted">{s.branch_ids.map((id) => branchName(id)).join(', ') || '—'}</span> },
    { key: 'status', header: t('staff.status'), cell: (s) => <StatusBadge status={STATUS_TONES[s.status]} label={t(`staffStatus.${s.status}`)} /> },
    {
      key: 'activity',
      header: t('staff.lastActivity'),
      hideBelow: 'lg',
      align: 'right',
      cell: (s) => <span className="tabular text-xs text-ink-muted">{activity.data?.get(s.id) ? formatDateTime(activity.data.get(s.id)!) : s.status === 'invited' ? `${t('staff.invitedOn')} ${formatDate(s.invited_at ?? s.created_at)}` : t('staff.noActivity')}</span>,
    },
  ];

  return (
    <>
      <PageHeader
        title={t('staff.title')}
        description={t('staff.subtitle')}
        actions={
          can('staff.manage') && (
            <Button leftIcon={<UserPlus className="size-4" />} onClick={() => setAdding(true)}>
              {t('staff.add')}
            </Button>
          )
        }
      />
      <div className="space-y-6">
        <Card>
          <Toolbar>
            <div className="w-full sm:max-w-xs">
              <SearchInput value={search} onValueChange={setSearch} placeholder={t('staff.searchPlaceholder')} aria-label={t('staff.searchPlaceholder')} clearLabel={t('common.clearFilters')} />
            </div>
            <div className="flex flex-wrap gap-3 sm:ml-auto">
              {branches.length > 1 && (
                <div className="min-w-[10rem]">
                  <Select aria-label={t('staff.branches')} value={branch} onChange={(e) => setBranch(e.target.value)} placeholder={t('branches.allBranches')} options={branches.map((b) => ({ value: b.id, label: b.name }))} />
                </div>
              )}
              <div className="min-w-[9rem]">
                <Select
                  aria-label={t('staff.status')}
                  value={status}
                  onChange={(e) => setStatus(e.target.value as StaffStatus | '')}
                  placeholder={t('common.all')}
                  options={(['active', 'invited', 'inactive'] as const).map((s) => ({ value: s, label: t(`staffStatus.${s}`) }))}
                />
              </div>
            </div>
          </Toolbar>
          {staff.isLoading ? (
            <SkeletonRows rows={6} />
          ) : staff.isError ? (
            <ErrorState onRetry={() => void staff.refetch()} />
          ) : (
            <DataTable
              caption={t('staff.title')}
              columns={columns}
              rows={rows}
              rowKey={(s) => s.id}
              onRowClick={(s) => navigate(`/staff/${s.id}`)}
              empty={<EmptyState icon={<Users />} title={t('staff.emptyTitle')} body={can('staff.manage') ? t('staff.emptyBody') : undefined} />}
              mobileCard={(s) => (
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{s.full_name}</span>
                    <span className="block truncate text-xs text-ink-muted">{designationLabel(s)}</span>
                  </span>
                  <StatusBadge status={STATUS_TONES[s.status]} label={t(`staffStatus.${s.status}`)} />
                </div>
              )}
            />
          )}
        </Card>
        {isDoctor && <AdministratorsCard />}
      </div>
      <AddStaffWizard open={adding} onOpenChange={setAdding} />
    </>
  );
}
