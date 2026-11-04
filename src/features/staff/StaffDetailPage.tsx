import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Mail, Pencil, Power, RotateCcw, Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useParams } from 'react-router-dom';
import { AUDIT_ICONS, describeMetadata, humanizeEntity } from '@/components/data-display/AuditEvent';
import { Avatar } from '@/components/data-display/Avatar';
import { Alert, ErrorState, FullPageSpinner, PermissionDenied, SkeletonRows } from '@/components/feedback/States';
import { notify } from '@/components/feedback/toast';
import { FormField, FormGrid } from '@/components/forms/FormField';
import { StatusBadge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { ConfirmDialog, Modal } from '@/components/ui/Dialog';
import { Checkbox, DateInput, Input, Select, Textarea } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { useAccess } from '@/features/access/AccessProvider';
import { isPermissionError, toUserMessage } from '@/lib/errors';
import { formatDate, formatDateTime } from '@/lib/formatters';
import { qk } from '@/lib/query/keys';
import { useFieldError } from '@/lib/validation/useFieldError';
import { useI18n, type TranslationKey } from '@/locales/i18n';
import { listAuditEvents } from '@/services/audit';
import {
  fetchPermissionCatalog,
  fetchStaffPermissionMatrix,
  getStaffMember,
  listRoleTemplates,
  sendStaffInvitation,
  sendStaffPasswordReset,
  setStaffAccess,
  setStaffBranches,
  setStaffStatus,
  updateStaffMember,
  type Overrides,
} from '@/services/staff';
import { EMPLOYMENT_TYPES, STAFF_DESIGNATIONS, type StaffMember } from '@/types/domain';
import { staffProfileSchema, type StaffProfileValues } from './AddStaffWizard';
import { PermissionEditor } from './PermissionEditor';

const STATUS_TONES = { active: 'completed', invited: 'scheduled', inactive: 'cancelled' } as const;

function ProfileModal({ staff, open, onOpenChange }: { staff: StaffMember; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const fieldError = useFieldError();
  const form = useForm<StaffProfileValues>({ resolver: zodResolver(staffProfileSchema) });
  const designation = useWatch({ control: form.control, name: 'designation' });
  useEffect(() => {
    if (open)
      form.reset({
        full_name: staff.full_name,
        email: staff.email,
        mobile: staff.mobile ?? '',
        designation: staff.designation,
        designation_label: staff.designation_label ?? '',
        employee_code: staff.employee_code ?? '',
        employment_type: staff.employment_type,
        joined_on: staff.joined_on ?? '',
      });
  }, [open, staff, form]);
  const save = useMutation({
    mutationFn: (v: StaffProfileValues) =>
      updateStaffMember(staff.id, {
        full_name: v.full_name,
        email: v.email,
        mobile: v.mobile || null,
        designation: v.designation,
        designation_label: v.designation === 'other' ? v.designation_label || null : null,
        employee_code: v.employee_code || null,
        employment_type: v.employment_type,
        joined_on: v.joined_on || null,
      }),
    onSuccess: async () => {
      notify.success(t('staff.updated'));
      await queryClient.invalidateQueries({ queryKey: qk.staff() });
      onOpenChange(false);
    },
    onError: (e) => notify.error(e),
  });
  const e = form.formState.errors;
  return (
    <Modal
      open={open}
      onOpenChange={(o) => !save.isPending && onOpenChange(o)}
      title={t('staff.editProfile')}
      closeLabel={t('common.close')}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="staff-profile" loading={save.isPending}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form id="staff-profile" noValidate onSubmit={form.handleSubmit((v) => save.mutate(v))}>
        <FormGrid>
          <FormField label={t('staff.fullName')} error={fieldError(e.full_name)} required>
            <Input {...form.register('full_name')} />
          </FormField>
          <FormField label={t('staff.email')} hint={staff.user_id ? t('staff.emailLocked') : undefined} error={fieldError(e.email)} required>
            <Input type="email" disabled={Boolean(staff.user_id)} {...form.register('email')} />
          </FormField>
          <FormField label={t('staff.mobile')} error={fieldError(e.mobile)}>
            <Input type="tel" {...form.register('mobile')} />
          </FormField>
          <FormField label={t('staff.designation')}>
            <Select options={STAFF_DESIGNATIONS.map((d) => ({ value: d, label: t(`designation.${d}`) }))} {...form.register('designation')} />
          </FormField>
          {designation === 'other' && (
            <FormField label={t('staff.designationLabel')} error={fieldError(e.designation_label)} required>
              <Input {...form.register('designation_label')} />
            </FormField>
          )}
          <FormField label={t('staff.employeeCode')} error={fieldError(e.employee_code)}>
            <Input {...form.register('employee_code')} />
          </FormField>
          <FormField label={t('staff.employmentType')}>
            <Select options={EMPLOYMENT_TYPES.map((d) => ({ value: d, label: t(`employmentType.${d}`) }))} {...form.register('employment_type')} />
          </FormField>
          <FormField label={t('staff.joinedOn')}>
            <DateInput {...form.register('joined_on')} />
          </FormField>
        </FormGrid>
      </form>
    </Modal>
  );
}

function BranchesCard({ staff, canManage }: { staff: StaffMember; canManage: boolean }) {
  const { t } = useI18n();
  const { branches, branchName } = useAccess();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [ids, setIds] = useState<string[]>(staff.branch_ids);
  useEffect(() => setIds(staff.branch_ids), [staff.branch_ids]);
  const save = useMutation({
    mutationFn: () => setStaffBranches(staff.id, ids),
    onSuccess: async () => {
      notify.success(t('staff.branchesSaved'));
      setEditing(false);
      await queryClient.invalidateQueries({ queryKey: qk.staff() });
    },
    onError: (e) => notify.error(e),
  });
  return (
    <Card>
      <CardHeader title={t('staff.branches')} description={t('staff.branchesSeparate')} actions={canManage && !editing && <IconButton label={t('common.edit')} icon={<Pencil />} onClick={() => setEditing(true)} />} />
      <CardBody>
        {editing ? (
          <div className="space-y-3">
            {branches.map((b) => (
              <Checkbox key={b.id} label={b.name} checked={ids.includes(b.id)} onChange={(ev) => setIds((x) => (ev.target.checked ? [...x, b.id] : x.filter((id) => id !== b.id)))} />
            ))}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" size="sm" onClick={() => { setIds(staff.branch_ids); setEditing(false); }}>
                {t('common.cancel')}
              </Button>
              <Button size="sm" loading={save.isPending} disabled={ids.length === 0} onClick={() => save.mutate()}>
                {t('common.save')}
              </Button>
            </div>
          </div>
        ) : (
          <ul className="space-y-1 text-sm">{staff.branch_ids.length === 0 ? <li className="text-ink-muted">—</li> : staff.branch_ids.map((id) => <li key={id}>{branchName(id)}</li>)}</ul>
        )}
      </CardBody>
    </Card>
  );
}

function PermissionsCard({ staff, canEdit }: { staff: StaffMember; canEdit: boolean }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const roles = useQuery({ queryKey: qk.roles(), queryFn: listRoleTemplates });
  const catalog = useQuery({ queryKey: qk.permissionCatalog(), queryFn: fetchPermissionCatalog, staleTime: 30 * 60_000 });
  const matrix = useQuery({ queryKey: qk.staffPermissions(staff.id), queryFn: () => fetchStaffPermissionMatrix(staff.id) });
  const saved = useMemo(() => Object.fromEntries((matrix.data ?? []).filter((r) => r.override).map((r) => [r.permission_key, r.override!])) as Overrides, [matrix.data]);
  const [roleId, setRoleId] = useState(staff.role_id);
  const [overrides, setOverrides] = useState<Overrides>({});
  const [confirm, setConfirm] = useState(false);
  useEffect(() => setOverrides(saved), [saved]);
  useEffect(() => setRoleId(staff.role_id), [staff.role_id]);
  const grantable = useMemo(() => new Set((matrix.data ?? []).filter((r) => r.grantable).map((r) => r.permission_key)), [matrix.data]);
  const templates = (roles.data ?? []).filter((r) => r.scope === 'staff');
  const role = templates.find((r) => r.id === roleId);
  const dirty = roleId !== staff.role_id || JSON.stringify(overrides) !== JSON.stringify(saved);

  const save = useMutation({
    mutationFn: () => setStaffAccess(staff.id, roleId, overrides),
    onSuccess: async () => {
      notify.success(t('staff.permissionsSaved'));
      await Promise.all([queryClient.invalidateQueries({ queryKey: qk.staffPermissions(staff.id) }), queryClient.invalidateQueries({ queryKey: qk.staff() })]);
    },
    onError: (e) => notify.error(e),
  });

  if (matrix.isError && isPermissionError(matrix.error)) return null;
  return (
    <Card>
      <CardHeader
        title={t('staff.permissions')}
        description={t('staff.permissionsHint')}
        actions={
          canEdit && (
            <Button size="sm" leftIcon={<Save className="size-4" />} disabled={!dirty} loading={save.isPending} onClick={() => setConfirm(true)}>
              {t('common.save')}
            </Button>
          )
        }
      />
      <CardBody className="space-y-4">
        {roles.isLoading || catalog.isLoading || matrix.isLoading ? (
          <SkeletonRows rows={6} className="p-0" />
        ) : (
          <>
            <FormField label={t('staff.template')} hint={t('staff.templateChangeHint')}>
              <Select
                disabled={!canEdit}
                value={roleId}
                onChange={(e) => {
                  setRoleId(e.target.value);
                  setOverrides({});
                }}
                options={templates.map((r) => ({ value: r.id, label: r.name }))}
              />
            </FormField>
            {role && catalog.data && (
              <PermissionEditor catalog={catalog.data} template={role.permissions} overrides={overrides} onChange={(n) => setOverrides(n.overrides)} grantable={(k) => grantable.has(k)} readOnly={!canEdit} />
            )}
          </>
        )}
      </CardBody>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('staff.confirmPermissionsTitle')}
        body={t('staff.confirmPermissionsBody', { name: staff.full_name })}
        confirmLabel={t('staff.applyChanges')}
        onConfirm={() => save.mutateAsync()}
      />
    </Card>
  );
}

function ActivityCard({ staff }: { staff: StaffMember }) {
  const { t } = useI18n();
  const params = { page: 1, pageSize: 15, entityType: 'staff_members' };
  const q = useQuery({ queryKey: qk.audit({ ...params, staff: staff.id }), queryFn: () => listAuditEvents(params) });
  const rows = (q.data?.rows ?? []).filter((e) => e.entity_id === staff.id);
  return (
    <Card>
      <CardHeader title={t('staff.history')} description={t('staff.historyHint')} />
      {q.isLoading ? (
        <SkeletonRows rows={3} />
      ) : q.isError ? (
        isPermissionError(q.error) ? <p className="px-5 py-4 text-sm text-ink-muted">{t('staff.historyNoAccess')}</p> : <ErrorState compact onRetry={() => void q.refetch()} />
      ) : rows.length === 0 ? (
        <p className="px-5 py-4 text-sm text-ink-muted">{t('audit.emptyTitle')}</p>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((e) => {
            const Icon = AUDIT_ICONS[e.action];
            const granted = (e.metadata.granted as string[] | undefined) ?? [];
            const revoked = (e.metadata.revoked as string[] | undefined) ?? [];
            return (
              <li key={e.id} className="flex items-start gap-3 px-5 py-2.5 text-sm">
                <Icon className="mt-0.5 size-4 shrink-0 text-ink-muted" aria-hidden />
                <div className="min-w-0">
                  <p>
                    {t(`audit.event.${e.event_type.replace('.', '_')}` as TranslationKey) !== `audit.event.${e.event_type.replace('.', '_')}`
                      ? t(`audit.event.${e.event_type.replace('.', '_')}` as TranslationKey)
                      : `${t(`audit.${e.action}` as TranslationKey)} · ${humanizeEntity(e.entity_type)}`}
                    {describeMetadata(e.metadata) && <span className="text-ink-muted"> · {describeMetadata(e.metadata)}</span>}
                  </p>
                  {granted.length > 0 && <p className="text-xs text-success">+ {granted.join(', ')}</p>}
                  {revoked.length > 0 && <p className="text-xs text-danger">− {revoked.join(', ')}</p>}
                  <p className="tabular text-xs text-ink-muted">{formatDateTime(e.created_at)}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

export function StaffDetailPage() {
  const { staffId = '' } = useParams();
  const { t } = useI18n();
  const { can, staffId: myStaffId } = useAccess();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [reason, setReason] = useState('');
  const query = useQuery({ queryKey: qk.staffMember(staffId), queryFn: () => getStaffMember(staffId) });
  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: qk.staff() })]);

  const invite = useMutation({ mutationFn: () => sendStaffInvitation(staffId), onSuccess: async () => { notify.success(t('staff.inviteSent')); await refresh(); }, onError: (e) => notify.error(e) });
  const reset = useMutation({ mutationFn: () => sendStaffPasswordReset(staffId), onSuccess: () => notify.success(t('staff.resetSent')), onError: (e) => notify.error(e) });
  const reactivate = useMutation({ mutationFn: () => setStaffStatus(staffId, 'active'), onSuccess: async () => { notify.success(t('staff.reactivated')); await refresh(); }, onError: (e) => notify.error(e) });

  if (query.isLoading) return <FullPageSpinner />;
  if (query.isError) {
    if (isPermissionError(query.error) || (query.error as { code?: string }).code === 'PGRST116') return <PermissionDenied />;
    return <ErrorState message={toUserMessage(query.error)} onRetry={() => void query.refetch()} />;
  }
  const s = query.data!;
  const isSelf = s.id === myStaffId;
  // The server also refuses self-management and staff outside the caller's branches.
  const canManage = can('staff.manage') && !isSelf;
  const canPermissions = can('staff.permissions') && !isSelf;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: t('nav.staff'), to: '/staff' }, { label: s.full_name }]}
        title={
          <span className="flex items-center gap-3">
            <Avatar name={s.full_name} />
            <span>
              <span className="block">{s.full_name}</span>
              <span className="block text-sm font-normal text-ink-muted">{s.designation === 'other' && s.designation_label ? s.designation_label : t(`designation.${s.designation}`)}</span>
            </span>
          </span>
        }
        meta={<StatusBadge status={STATUS_TONES[s.status]} label={t(`staffStatus.${s.status}`)} />}
        actions={
          canManage && (
            <>
              <Button variant="secondary" leftIcon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>
                {t('common.edit')}
              </Button>
              {s.status === 'invited' && (
                <Button variant="secondary" leftIcon={<Mail className="size-4" />} loading={invite.isPending} onClick={() => invite.mutate()}>
                  {s.user_id ? t('staff.resendInvite') : t('staff.sendInviteShort')}
                </Button>
              )}
              {s.status === 'active' && (
                <Button variant="secondary" leftIcon={<KeyRound className="size-4" />} loading={reset.isPending} onClick={() => reset.mutate()}>
                  {t('staff.resetPassword')}
                </Button>
              )}
              {s.status === 'inactive' ? (
                s.accepted_at && (
                  <Button leftIcon={<RotateCcw className="size-4" />} loading={reactivate.isPending} onClick={() => reactivate.mutate()}>
                    {t('staff.reactivate')}
                  </Button>
                )
              ) : (
                <Button variant="danger" leftIcon={<Power className="size-4" />} onClick={() => setDeactivating(true)}>
                  {t('staff.deactivate')}
                </Button>
              )}
            </>
          )
        }
      />
      {isSelf && (
        <div className="mb-4">
          <Alert tone="info">{t('staff.selfNotice')}</Alert>
        </div>
      )}
      {s.status === 'inactive' && s.deactivation_reason && (
        <div className="mb-4">
          <Alert tone="warning" title={t('staff.deactivatedOn', { date: formatDate(s.deactivated_at) })}>
            {s.deactivation_reason}
          </Alert>
        </div>
      )}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <PermissionsCard staff={s} canEdit={canPermissions} />
        <div className="space-y-6">
          <Card>
            <CardHeader title={t('staff.details')} />
            <CardBody>
              <dl className="space-y-3 text-sm">
                {(
                  [
                    ['staff.email', s.email],
                    ['staff.mobile', s.mobile],
                    ['staff.employeeCode', s.employee_code],
                    ['staff.employmentType', t(`employmentType.${s.employment_type}`)],
                    ['staff.joinedOn', s.joined_on && formatDate(s.joined_on)],
                    ['staff.invitedOn', s.invited_at && formatDateTime(s.invited_at)],
                    ['staff.acceptedOn', s.accepted_at && formatDateTime(s.accepted_at)],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-xs text-ink-muted">{t(label)}</dt>
                    <dd>{value || '—'}</dd>
                  </div>
                ))}
              </dl>
            </CardBody>
          </Card>
          <BranchesCard staff={s} canManage={canManage} />
          <ActivityCard staff={s} />
        </div>
      </div>
      {canManage && <ProfileModal staff={s} open={editing} onOpenChange={setEditing} />}
      <ConfirmDialog
        open={deactivating}
        onOpenChange={(o) => {
          setDeactivating(o);
          if (!o) setReason('');
        }}
        title={t('staff.deactivateTitle', { name: s.full_name })}
        body={t('staff.deactivateBody')}
        confirmLabel={t('staff.deactivate')}
        tone="danger"
        confirmDisabled={reason.trim().length === 0}
        onConfirm={async () => {
          try {
            await setStaffStatus(s.id, 'inactive', reason.trim());
            notify.success(t('staff.deactivated'));
            await refresh();
          } catch (e) {
            notify.error(e);
            throw e;
          }
        }}
      >
        <FormField label={t('staff.deactivateReason')} required>
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </FormField>
      </ConfirmDialog>
    </>
  );
}
