import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Clock, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/feedback/States';
import { notify } from '@/components/feedback/toast';
import { FormField, FormGrid } from '@/components/forms/FormField';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { ConfirmDialog, Modal } from '@/components/ui/Dialog';
import { Checkbox, Input, Select } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { useAccess } from '@/features/access/AccessProvider';
import { useBranches } from '@/hooks/useBranches';
import { qk } from '@/lib/query/keys';
import { optionalEmail, optionalPhone, optionalText, requiredText } from '@/lib/validation/schemas';
import { useFieldError } from '@/lib/validation/useFieldError';
import { useI18n, type TranslationKey } from '@/locales/i18n';
import { fetchBranchHours, saveBranch, saveBranchHours } from '@/services/organization';
import { listStaff } from '@/services/staff';
import type { Branch, WorkingHours } from '@/types/domain';

const branchSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,10}$/, 'range:2:10'),
  name: requiredText(120, 2),
  address_line: optionalText(240),
  city: optionalText(80),
  state: optionalText(80),
  pincode: z.string().trim().regex(/^[1-9][0-9]{5}$/, 'pincode').optional().or(z.literal('')),
  phone: optionalPhone,
  email: optionalEmail,
  is_active: z.boolean(),
  manager_staff_id: z.string().optional(),
});
type BranchForm = z.infer<typeof branchSchema>;
const blank = (v: string | undefined) => (v && v.trim() ? v.trim() : null);

function BranchModal({ branch, open, onOpenChange }: { branch: Branch | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const { can } = useAccess();
  const queryClient = useQueryClient();
  const fieldError = useFieldError();
  // Branch-settings holders edit contact details only; status, code and manager need branches.manage.
  const full = can('branches.manage');
  const staff = useQuery({ queryKey: qk.staff(), queryFn: listStaff, enabled: open && full && Boolean(branch) });
  const managers = (staff.data ?? []).filter((s) => s.status !== 'inactive' && branch && s.branch_ids.includes(branch.id));
  const form = useForm<BranchForm>({ resolver: zodResolver(branchSchema) });
  useEffect(() => {
    if (open)
      form.reset({
        code: branch?.code ?? '',
        name: branch?.name ?? '',
        address_line: branch?.address_line ?? '',
        city: branch?.city ?? '',
        state: branch?.state ?? '',
        pincode: branch?.pincode ?? '',
        phone: branch?.phone ?? '',
        email: branch?.email ?? '',
        is_active: branch?.is_active ?? true,
        manager_staff_id: branch?.manager_staff_id ?? '',
      });
  }, [open, branch, form]);
  const save = useMutation({
    mutationFn: (v: BranchForm) =>
      saveBranch(
        {
          code: v.code,
          name: v.name,
          address_line: blank(v.address_line),
          city: blank(v.city),
          state: blank(v.state),
          pincode: blank(v.pincode),
          phone: blank(v.phone),
          email: blank(v.email),
          is_active: v.is_active,
          ...(full && branch ? { manager_staff_id: v.manager_staff_id || null } : {}),
        },
        branch?.id,
      ),
    onSuccess: async () => {
      notify.success(t('branches.saved'));
      await Promise.all([queryClient.invalidateQueries({ queryKey: qk.branches() }), queryClient.invalidateQueries({ queryKey: ['access'] })]);
      onOpenChange(false);
    },
    onError: (e) => notify.error(e),
  });
  const e = form.formState.errors;
  return (
    <Modal
      open={open}
      onOpenChange={(o) => !save.isPending && onOpenChange(o)}
      title={branch ? branch.name : t('branches.add')}
      size="lg"
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="branch-form" loading={save.isPending}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form id="branch-form" noValidate className="space-y-4" onSubmit={form.handleSubmit((v) => save.mutate(v))}>
        <FormGrid>
          <FormField label={t('branches.name')} error={fieldError(e.name)} required>
            <Input {...form.register('name')} />
          </FormField>
          <FormField label={t('branches.code')} hint={t('branches.codeHint')} error={fieldError(e.code)} required>
            <Input className="uppercase" maxLength={10} disabled={!full} {...form.register('code')} />
          </FormField>
          <FormField label={t('settings.address')} error={fieldError(e.address_line)} className="sm:col-span-2">
            <Input {...form.register('address_line')} />
          </FormField>
        </FormGrid>
        <FormGrid cols={3}>
          <FormField label={t('settings.city')} error={fieldError(e.city)}>
            <Input {...form.register('city')} />
          </FormField>
          <FormField label={t('settings.state')} error={fieldError(e.state)}>
            <Input {...form.register('state')} />
          </FormField>
          <FormField label={t('settings.pincode')} error={fieldError(e.pincode)}>
            <Input inputMode="numeric" className="tabular" {...form.register('pincode')} />
          </FormField>
        </FormGrid>
        <FormGrid>
          <FormField label={t('settings.phone')} error={fieldError(e.phone)}>
            <Input type="tel" {...form.register('phone')} />
          </FormField>
          <FormField label={t('settings.email')} error={fieldError(e.email)}>
            <Input type="email" {...form.register('email')} />
          </FormField>
          {full && branch && (
            <FormField label={t('branches.manager')} hint={t('branches.managerHint')}>
              <Select placeholder={t('branches.noManager')} options={managers.map((s) => ({ value: s.id, label: s.full_name }))} {...form.register('manager_staff_id')} />
            </FormField>
          )}
        </FormGrid>
        {full && <Checkbox label={t('branches.active')} description={branch?.is_primary ? t('branches.primaryAlwaysActive') : t('branches.activeHint')} disabled={branch?.is_primary} {...form.register('is_active')} />}
      </form>
    </Modal>
  );
}

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

function HoursModal({ branch, onClose }: { branch: Branch; onClose: () => void }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const hours = useQuery({ queryKey: qk.branchHours(branch.id), queryFn: () => fetchBranchHours(branch.id) });
  const [rows, setRows] = useState<WorkingHours[]>([]);
  useEffect(() => setRows(hours.data ?? []), [hours.data]);
  const save = useMutation({
    mutationFn: () => saveBranchHours(branch.id, rows),
    onSuccess: async () => {
      notify.success(t('branches.hoursSaved'));
      await queryClient.invalidateQueries({ queryKey: qk.branchHours(branch.id) });
      onClose();
    },
    onError: (e) => notify.error(e),
  });
  const update = (i: number, patch: Partial<WorkingHours>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const invalid = rows.some((r) => r.closes_at <= r.opens_at);

  return (
    <Modal
      open
      onOpenChange={(o) => !o && !save.isPending && onClose()}
      title={t('branches.hoursTitle', { name: branch.name })}
      description={t('branches.hoursHint')}
      size="lg"
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            {t('common.cancel')}
          </Button>
          <Button loading={save.isPending} disabled={invalid} onClick={() => save.mutate()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      {hours.isLoading ? (
        <SkeletonRows rows={5} />
      ) : (
        <div className="space-y-3">
          {WEEKDAYS.map((day) => {
            const sessions = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.weekday === day);
            return (
              <div key={day} className="flex flex-wrap items-start gap-3 border-b border-line pb-3 last:border-0">
                <p className="w-28 pt-2 text-sm font-medium">{t(`weekday.${day}` as TranslationKey)}</p>
                <div className="flex flex-1 flex-col gap-2">
                  {sessions.length === 0 && <p className="pt-2 text-sm text-ink-muted">{t('branches.closed')}</p>}
                  {sessions.map(({ r, i }) => (
                    <div key={i} className="flex flex-wrap items-center gap-2">
                      <Input type="time" step={900} aria-label={t('branches.opens')} value={r.opens_at} onChange={(e) => update(i, { opens_at: e.target.value })} className="w-32" />
                      <span className="text-ink-muted">–</span>
                      <Input type="time" step={900} aria-label={t('branches.closes')} value={r.closes_at} onChange={(e) => update(i, { closes_at: e.target.value })} className="w-32" />
                      <Select
                        aria-label={t('branches.slot')}
                        value={String(r.slot_minutes)}
                        onChange={(e) => update(i, { slot_minutes: Number(e.target.value) })}
                        options={[10, 15, 20, 30, 45, 60].map((m) => ({ value: String(m), label: t('appointments.minutes', { count: m }) }))}
                      />
                      <IconButton label={t('branches.removeSession')} icon={<Trash2 />} onClick={() => setRows((x) => x.filter((_, j) => j !== i))} />
                    </div>
                  ))}
                </div>
                <Button size="sm" variant="ghost" leftIcon={<Plus className="size-4" />} onClick={() => setRows((x) => [...x, { weekday: day, opens_at: sessions.length ? '16:00' : '10:00', closes_at: sessions.length ? '20:00' : '14:00', slot_minutes: 15 }])}>
                  {t('branches.addSession')}
                </Button>
              </div>
            );
          })}
          {invalid && <p className="text-sm text-danger">{t('branches.hoursInvalid')}</p>}
        </div>
      )}
    </Modal>
  );
}

export function BranchesPage() {
  const { t } = useI18n();
  const { can, branches: mine, allBranches } = useAccess();
  const queryClient = useQueryClient();
  const { branches, isLoading, isError, refetch } = useBranches();
  const staff = useQuery({ queryKey: qk.staff(), queryFn: listStaff, enabled: can('staff.view') });
  const [modal, setModal] = useState<{ open: boolean; branch: Branch | null }>({ open: false, branch: null });
  const [hoursFor, setHoursFor] = useState<Branch | null>(null);
  const [toggling, setToggling] = useState<Branch | null>(null);
  const canManage = can('branches.manage');
  // Branch-settings holders see only their branches here.
  const visible = allBranches || canManage ? branches : branches.filter((b) => mine.some((m) => m.id === b.id));
  const staffCount = (id: string) => (staff.data ?? []).filter((s) => s.status !== 'inactive' && s.branch_ids.includes(id)).length;
  const managerName = (id: string | null) => (id ? (staff.data ?? []).find((s) => s.id === id)?.full_name ?? '—' : '—');

  return (
    <>
      <PageHeader
        title={t('branches.title')}
        description={t('branches.subtitle')}
        actions={
          canManage && (
            <Button leftIcon={<Plus className="size-4" />} onClick={() => setModal({ open: true, branch: null })}>
              {t('branches.add')}
            </Button>
          )
        }
      />
      <Card>
        <CardHeader title={t('branches.list')} description={t('branches.listHint')} />
        {isLoading ? (
          <SkeletonRows rows={4} />
        ) : isError ? (
          <ErrorState onRetry={refetch} />
        ) : visible.length === 0 ? (
          <EmptyState icon={<Building2 />} title={t('branches.empty')} />
        ) : (
          <ul className="divide-y divide-line">
            {visible.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                <Building2 className="size-5 shrink-0 text-forest" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {b.name}
                    <span className="tabular text-xs font-normal text-ink-muted">{b.code}</span>
                    {b.is_primary && <Badge tone="gold">{t('branches.primary')}</Badge>}
                    {!b.is_active && <Badge tone="danger">{t('branches.inactive')}</Badge>}
                  </p>
                  <p className="text-sm text-ink-muted">{[b.address_line, b.city, b.phone].filter(Boolean).join(' · ') || '—'}</p>
                  {staff.data && (
                    <p className="text-xs text-ink-muted">
                      {t('branches.staffCount', { count: staffCount(b.id) })} · {t('branches.manager')}: {managerName(b.manager_staff_id)}
                    </p>
                  )}
                </div>
                <span className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" leftIcon={<Clock className="size-4" />} onClick={() => setHoursFor(b)}>
                    {t('branches.workingHours')}
                  </Button>
                  <IconButton label={`${t('common.edit')} ${b.name}`} icon={<Pencil />} onClick={() => setModal({ open: true, branch: b })} />
                  {canManage && !b.is_primary && (
                    <Button size="sm" variant="ghost" onClick={() => setToggling(b)}>
                      {b.is_active ? t('branches.deactivate') : t('branches.activate')}
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <BranchModal open={modal.open} branch={modal.branch} onOpenChange={(o) => setModal((s) => ({ ...s, open: o }))} />
      {hoursFor && <HoursModal branch={hoursFor} onClose={() => setHoursFor(null)} />}
      <ConfirmDialog
        open={Boolean(toggling)}
        onOpenChange={(o) => !o && setToggling(null)}
        title={toggling?.is_active ? t('branches.deactivate') : t('branches.activate')}
        body={toggling?.is_active ? t('branches.deactivateBody', { name: toggling.name }) : t('branches.activateBody', { name: toggling?.name ?? '' })}
        confirmLabel={toggling?.is_active ? t('branches.deactivate') : t('branches.activate')}
        tone={toggling?.is_active ? 'danger' : 'primary'}
        onConfirm={async () => {
          const b = toggling!;
          try {
            await saveBranch({ code: b.code, name: b.name, address_line: b.address_line, city: b.city, state: b.state, pincode: b.pincode, phone: b.phone, email: b.email, is_active: !b.is_active }, b.id);
            notify.success(t('branches.saved'));
            await Promise.all([queryClient.invalidateQueries({ queryKey: qk.branches() }), queryClient.invalidateQueries({ queryKey: ['access'] })]);
          } catch (e) {
            notify.error(e);
            throw e;
          }
        }}
      />
    </>
  );
}
