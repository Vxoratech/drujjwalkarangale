import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal, UserPlus, Users } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { Alert, EmptyState, ErrorState, SkeletonRows } from '@/components/feedback/States';
import { notify } from '@/components/feedback/toast';
import { FormField } from '@/components/forms/FormField';
import { PatientIdentity } from '@/components/data-display/Avatar';
import { DataTable, type Column } from '@/components/data-display/DataTable';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Drawer, Modal } from '@/components/ui/Dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/DropdownMenu';
import { Checkbox, Input } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { useCurrentUser } from '@/features/auth/AuthProvider';
import { useClinic } from '@/features/clinic/ClinicProvider';
import { formatDate } from '@/lib/formatters';
import { qk } from '@/lib/query/keys';
import { useFieldError } from '@/lib/validation/useFieldError';
import { useI18n } from '@/locales/i18n';
import { fetchStaff, inviteMember, updateMember } from '@/services/clinic';
import { ASSIGNABLE_ROLES, type AppRole, type StaffMember } from '@/types/domain';

const inviteSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().email(),
  roles: z.array(z.enum(ASSIGNABLE_ROLES)).min(1, 'required'),
});

function RolePicker({ value, onChange }: { value: AppRole[]; onChange: (v: AppRole[]) => void }) {
  const { t } = useI18n();
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 text-sm font-medium">{t('staff.roles')}</legend>
      {ASSIGNABLE_ROLES.map((r) => (
        <Checkbox
          key={r}
          label={t(`roles.${r}`)}
          checked={value.includes(r)}
          onChange={(e) => onChange(e.target.checked ? [...value, r] : value.filter((x) => x !== r))}
        />
      ))}
    </fieldset>
  );
}

function InviteDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const { clinicId } = useClinic();
  const queryClient = useQueryClient();
  const fieldError = useFieldError();
  const form = useForm<z.infer<typeof inviteSchema>>({ resolver: zodResolver(inviteSchema), defaultValues: { fullName: '', email: '', roles: ['doctor'] } });
  const mutation = useMutation({
    mutationFn: (v: z.infer<typeof inviteSchema>) => inviteMember({ clinicId, email: v.email, fullName: v.fullName, roles: v.roles }),
    onSuccess: async () => {
      notify.success(t('staff.invited'));
      await queryClient.invalidateQueries({ queryKey: qk.staff(clinicId) });
      await queryClient.invalidateQueries({ queryKey: qk.doctors(clinicId) });
      form.reset();
      onOpenChange(false);
    },
    onError: (e) => notify.error(e),
  });
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={t('staff.invite')}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="invite-form" loading={mutation.isPending}>
            {t('staff.invite')}
          </Button>
        </>
      }
    >
      <form id="invite-form" noValidate className="space-y-4" onSubmit={form.handleSubmit((v) => mutation.mutate(v))}>
        <FormField label={t('auth.fullName')} error={fieldError(form.formState.errors.fullName)} required>
          <Input autoComplete="off" {...form.register('fullName')} />
        </FormField>
        <FormField label={t('auth.email')} error={fieldError(form.formState.errors.email)} required>
          <Input type="email" autoComplete="off" {...form.register('email')} />
        </FormField>
        <Controller control={form.control} name="roles" render={({ field }) => <RolePicker value={field.value} onChange={field.onChange} />} />
        {form.formState.errors.roles && <p className="text-xs font-medium text-danger">{t('validation.required')}</p>}
        <Alert tone="info">{t('staff.futureRoles')}</Alert>
      </form>
    </Drawer>
  );
}

export function StaffPage() {
  const { t } = useI18n();
  const user = useCurrentUser();
  const { clinicId, can } = useClinic();
  const queryClient = useQueryClient();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editing, setEditing] = useState<StaffMember | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const query = useQuery({ queryKey: qk.staff(clinicId), queryFn: () => fetchStaff(clinicId) });
  const canManage = can('users.manage');

  const update = useMutation({
    mutationFn: ({ id, values }: { id: string; values: { roles?: AppRole[]; status?: 'active' | 'suspended' } }) => updateMember(id, values),
    onSuccess: async () => {
      notify.success(t('staff.updated'));
      await queryClient.invalidateQueries({ queryKey: qk.staff(clinicId) });
      await queryClient.invalidateQueries({ queryKey: qk.doctors(clinicId) });
      setEditing(null);
    },
    onError: (e) => notify.error(e),
  });

  const columns: Column<StaffMember>[] = [
    {
      key: 'name',
      header: t('staff.name'),
      cell: (m) => (
        <span className="flex items-center gap-2">
          <PatientIdentity name={m.profile?.full_name || '—'} meta={m.profile?.qualification} />
          {m.user_id === user.id && <Badge tone="gold">{t('staff.you')}</Badge>}
        </span>
      ),
    },
    { key: 'roles', header: t('staff.roles'), cell: (m) => <span className="flex flex-wrap gap-1">{m.roles.map((r) => <Badge key={r} tone="forest">{t(`roles.${r}`)}</Badge>)}</span> },
    { key: 'status', header: t('staff.status'), cell: (m) => <StatusBadge status={m.status} label={t(`memberStatus.${m.status}`)} /> },
    { key: 'joined', header: t('staff.joined'), hideBelow: 'md', cell: (m) => <span className="tabular text-ink-muted">{formatDate(m.created_at)}</span> },
    {
      key: 'actions',
      header: <span className="sr-only">{t('common.actions')}</span>,
      align: 'right',
      cell: (m) =>
        canManage && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton size="sm" label={`${t('common.actions')}: ${m.profile?.full_name ?? ''}`} icon={<MoreHorizontal />} />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem
                onSelect={() => {
                  setEditing(m);
                  setRoles(m.roles.filter((r): r is AppRole => (ASSIGNABLE_ROLES as readonly string[]).includes(r)));
                }}
              >
                {t('staff.editAccess')}
              </DropdownMenuItem>
              {m.user_id !== user.id &&
                (m.status === 'suspended' ? (
                  <DropdownMenuItem onSelect={() => update.mutate({ id: m.id, values: { status: 'active' } })}>{t('staff.reactivate')}</DropdownMenuItem>
                ) : (
                  <DropdownMenuItem danger onSelect={() => update.mutate({ id: m.id, values: { status: 'suspended' } })}>
                    {t('staff.suspend')}
                  </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('staff.title')}
        description={t('staff.subtitle')}
        actions={
          canManage && (
            <Button leftIcon={<UserPlus className="size-4" />} onClick={() => setInviteOpen(true)}>
              {t('staff.invite')}
            </Button>
          )
        }
      />
      <Card>
        {query.isLoading ? (
          <SkeletonRows />
        ) : query.isError ? (
          <ErrorState onRetry={() => void query.refetch()} />
        ) : (
          <DataTable caption={t('staff.title')} columns={columns} rows={query.data!} rowKey={(m) => m.id} empty={<EmptyState icon={<Users />} />} />
        )}
      </Card>
      {canManage && <InviteDrawer open={inviteOpen} onOpenChange={setInviteOpen} />}
      <Modal
        open={Boolean(editing)}
        onOpenChange={(o) => !o && setEditing(null)}
        title={`${t('staff.editAccess')} — ${editing?.profile?.full_name ?? ''}`}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              {t('common.cancel')}
            </Button>
            <Button loading={update.isPending} disabled={roles.length === 0} onClick={() =>
                editing &&
                // Keep roles the UI cannot assign yet (e.g. receptionist) intact.
                update.mutate({ id: editing.id, values: { roles: [...roles, ...editing.roles.filter((r) => !(ASSIGNABLE_ROLES as readonly string[]).includes(r))] } })
              }>
              {t('common.save')}
            </Button>
          </>
        }
      >
        <RolePicker value={roles} onChange={setRoles} />
      </Modal>
    </>
  );
}
