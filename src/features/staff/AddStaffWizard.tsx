import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronLeft, ChevronRight, Send } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { Alert, SkeletonRows } from '@/components/feedback/States';
import { notify } from '@/components/feedback/toast';
import { FormField, FormGrid } from '@/components/forms/FormField';
import { Button } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Dialog';
import { Checkbox, DateInput, Input, Select } from '@/components/ui/Input';
import { useAccess } from '@/features/access/AccessProvider';
import { cn } from '@/lib/cn';
import { qk } from '@/lib/query/keys';
import { optionalPhone, optionalText, requiredText } from '@/lib/validation/schemas';
import { useFieldError } from '@/lib/validation/useFieldError';
import { useI18n } from '@/locales/i18n';
import { createStaffMember, fetchPermissionCatalog, listRoleTemplates, sendStaffInvitation, type Overrides } from '@/services/staff';
import { EMPLOYMENT_TYPES, STAFF_DESIGNATIONS, type StaffDesignation } from '@/types/domain';
import { effectiveSet, PermissionEditor } from './PermissionEditor';

export const staffProfileSchema = z
  .object({
    full_name: requiredText(120, 2),
    email: z.string().trim().toLowerCase().email(),
    mobile: optionalPhone,
    designation: z.enum(STAFF_DESIGNATIONS),
    designation_label: optionalText(80),
    employee_code: z.string().trim().regex(/^[A-Za-z0-9-]{1,20}$/, 'range:1:20').optional().or(z.literal('')),
    employment_type: z.enum(EMPLOYMENT_TYPES),
    joined_on: z.string().optional().or(z.literal('')),
  })
  .refine((v) => v.designation !== 'other' || Boolean(v.designation_label?.trim()), { path: ['designation_label'], message: 'required' });
export type StaffProfileValues = z.infer<typeof staffProfileSchema>;

const STEPS = ['details', 'branches', 'role', 'permissions', 'review'] as const;
type Step = (typeof STEPS)[number];

/** Templates whose key matches the designation are suggested first. */
const TEMPLATE_FOR: Partial<Record<StaffDesignation, string>> = {
  receptionist: 'receptionist',
  clinic_coordinator: 'clinic_coordinator',
  accountant: 'accountant',
  billing_executive: 'billing_executive',
  assistant: 'assistant',
  branch_manager: 'branch_manager',
  other: 'custom',
};

export function AddStaffWizard({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const { can, branches, allBranches } = useAccess();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fieldError = useFieldError();
  const [step, setStep] = useState<Step>('details');
  const [branchIds, setBranchIds] = useState<string[]>([]);
  const [roleId, setRoleId] = useState('');
  const [overrides, setOverrides] = useState<Overrides>({});
  const [sendInvite, setSendInvite] = useState(true);
  const canCustomise = can('staff.permissions');

  const roles = useQuery({ queryKey: qk.roles(), queryFn: listRoleTemplates, enabled: open });
  const catalog = useQuery({ queryKey: qk.permissionCatalog(), queryFn: fetchPermissionCatalog, enabled: open, staleTime: 30 * 60_000 });
  const staffTemplates = (roles.data ?? []).filter((r) => r.scope === 'staff');
  const role = staffTemplates.find((r) => r.id === roleId);
  const own = useAccess().permissions;
  // Doctor and admin may grant anything that is not doctor-only; delegated managers only what they hold.
  const grantable = (key: string) => allBranches || own.has(key as never);

  const form = useForm<StaffProfileValues>({
    resolver: zodResolver(staffProfileSchema),
    defaultValues: { full_name: '', email: '', mobile: '', designation: 'receptionist', designation_label: '', employee_code: '', employment_type: 'full_time', joined_on: '' },
  });
  const designation = useWatch({ control: form.control, name: 'designation' });
  const e = form.formState.errors;

  useEffect(() => {
    if (open) {
      form.reset();
      setStep('details');
      setBranchIds(branches.length === 1 ? [branches[0]!.id] : []);
      setOverrides({});
      setRoleId('');
      setSendInvite(true);
    }
  }, [open, form, branches]);

  // Suggest the template matching the designation until the user picks one.
  useEffect(() => {
    const suggested = staffTemplates.find((r) => r.key === TEMPLATE_FOR[designation]);
    if (suggested && step === 'details') setRoleId(suggested.id);
  }, [designation, staffTemplates, step]);

  const effective = useMemo(() => (role && catalog.data ? effectiveSet(role.permissions, overrides, catalog.data) : new Set<string>()), [role, overrides, catalog.data]);

  const create = useMutation({
    mutationFn: async () => {
      const v = form.getValues();
      const staff = await createStaffMember({
        profile: {
          full_name: v.full_name.trim(),
          email: v.email,
          mobile: v.mobile || null,
          designation: v.designation,
          designation_label: v.designation === 'other' ? v.designation_label?.trim() || null : null,
          employee_code: v.employee_code || null,
          employment_type: v.employment_type,
          joined_on: v.joined_on || null,
        },
        roleId,
        branchIds,
        overrides,
      });
      let invited = false;
      if (sendInvite) {
        try {
          await sendStaffInvitation(staff.id);
          invited = true;
        } catch (err) {
          // The record exists; the invitation can be resent from the staff page.
          notify.error(err);
        }
      }
      return { staff, invited };
    },
    onSuccess: async ({ staff, invited }) => {
      notify.success(invited ? t('staff.invitedNamed', { name: staff.full_name }) : t('staff.createdNamed', { name: staff.full_name }));
      await queryClient.invalidateQueries({ queryKey: qk.staff() });
      onOpenChange(false);
      navigate(`/staff/${staff.id}`);
    },
    onError: (err) => notify.error(err),
  });

  const index = STEPS.indexOf(step);
  async function next() {
    if (step === 'details' && !(await form.trigger())) return;
    if (step === 'branches' && branchIds.length === 0) return notify.error({ message: t('staff.pickBranch') });
    if (step === 'role' && !roleId) return notify.error({ message: t('staff.pickTemplate') });
    // Without permission to customise, skip straight from the template to review.
    const nextStep = step === 'role' && !canCustomise ? 'review' : STEPS[index + 1]!;
    setStep(nextStep);
  }
  function back() {
    setStep(step === 'review' && !canCustomise ? 'role' : STEPS[index - 1]!);
  }

  const v = form.getValues();
  return (
    <Drawer
      open={open}
      onOpenChange={(o) => !create.isPending && onOpenChange(o)}
      title={t('staff.addTitle')}
      description={t(`staff.step.${step}`)}
      width="lg"
      closeLabel={t('common.close')}
      footer={
        <>
          {index > 0 && (
            <Button variant="secondary" leftIcon={<ChevronLeft className="size-4" />} onClick={back} disabled={create.isPending}>
              {t('common.back')}
            </Button>
          )}
          {step === 'review' ? (
            <Button leftIcon={sendInvite ? <Send className="size-4" /> : <Check className="size-4" />} loading={create.isPending} onClick={() => create.mutate()}>
              {sendInvite ? t('staff.createAndInvite') : t('staff.create')}
            </Button>
          ) : (
            <Button rightIcon={<ChevronRight className="size-4" />} onClick={() => void next()}>
              {t('common.next')}
            </Button>
          )}
        </>
      }
    >
      <ol className="mb-6 flex flex-wrap gap-2" aria-label={t('staff.steps')}>
        {STEPS.filter((s) => s !== 'permissions' || canCustomise).map((s, i) => (
          <li key={s} className={cn('flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium', s === step ? 'border-forest bg-sage text-forest-deep' : 'border-line text-ink-muted')} aria-current={s === step ? 'step' : undefined}>
            <span className="tabular">{i + 1}</span> {t(`staff.stepShort.${s}`)}
          </li>
        ))}
      </ol>

      {step === 'details' && (
        <form noValidate className="space-y-4" onSubmit={(ev) => ev.preventDefault()}>
          <FormGrid>
            <FormField label={t('staff.fullName')} error={fieldError(e.full_name)} required>
              <Input autoComplete="off" {...form.register('full_name')} />
            </FormField>
            <FormField label={t('staff.email')} hint={t('staff.emailHint')} error={fieldError(e.email)} required>
              <Input type="email" autoComplete="off" {...form.register('email')} />
            </FormField>
            <FormField label={t('staff.mobile')} error={fieldError(e.mobile)}>
              <Input type="tel" inputMode="tel" autoComplete="off" placeholder="+91 " {...form.register('mobile')} />
            </FormField>
            <FormField label={t('staff.designation')} required>
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
          <Alert tone="info">{t('staff.noDoctorAccounts')}</Alert>
        </form>
      )}

      {step === 'branches' && (
        <fieldset className="space-y-3">
          <legend className="mb-2 text-sm text-ink-muted">{t('staff.branchesHint')}</legend>
          {branches.map((b) => (
            <Checkbox
              key={b.id}
              label={b.name}
              description={b.is_primary ? t('branches.primary') : undefined}
              checked={branchIds.includes(b.id)}
              onChange={(ev) => setBranchIds((ids) => (ev.target.checked ? [...ids, b.id] : ids.filter((id) => id !== b.id)))}
            />
          ))}
        </fieldset>
      )}

      {step === 'role' &&
        (roles.isLoading ? (
          <SkeletonRows rows={4} />
        ) : (
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm text-ink-muted">{t('staff.templateHint')}</legend>
            {staffTemplates.map((r) => (
              <label key={r.id} className={cn('flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3', r.id === roleId ? 'border-forest bg-sage/40' : 'border-line hover:bg-ivory')}>
                <input type="radio" name="role" className="mt-1 accent-[var(--color-forest)]" checked={r.id === roleId} onChange={() => { setRoleId(r.id); setOverrides({}); }} />
                <span>
                  <span className="block font-medium">{r.name}</span>
                  <span className="block text-xs text-ink-muted">{r.description}</span>
                  <span className="mt-1 block text-xs text-ink-muted">{t('staff.permissionCount', { count: r.permissions.length })}</span>
                </span>
              </label>
            ))}
          </fieldset>
        ))}

      {step === 'permissions' && role && catalog.data && (
        <div className="space-y-4">
          <Alert tone="info">{t('staff.customiseHint', { template: role.name })}</Alert>
          <PermissionEditor catalog={catalog.data} template={role.permissions} overrides={overrides} onChange={(n) => setOverrides(n.overrides)} grantable={grantable} />
        </div>
      )}

      {step === 'review' && (
        <div className="space-y-5 text-sm">
          <dl className="grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-ink-muted">{t('staff.fullName')}</dt>
              <dd className="font-medium">{v.full_name}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-muted">{t('staff.email')}</dt>
              <dd>{v.email}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-muted">{t('staff.designation')}</dt>
              <dd>{v.designation === 'other' ? v.designation_label : t(`designation.${v.designation}`)}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-muted">{t('staff.branches')}</dt>
              <dd>{branches.filter((b) => branchIds.includes(b.id)).map((b) => b.name).join(', ')}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs text-ink-muted">{t('staff.template')}</dt>
              <dd>
                {role?.name}
                {Object.keys(overrides).length > 0 && ` · ${t('staff.customisations', { count: Object.keys(overrides).length })}`}
              </dd>
            </div>
          </dl>
          <div>
            <p className="mb-1 text-xs text-ink-muted">{t('staff.effectivePermissions', { count: effective.size })}</p>
            <p className="text-ink">{(catalog.data ?? []).filter((p) => effective.has(p.key)).map((p) => p.label).join(' · ') || t('staff.noPermissions')}</p>
          </div>
          <Checkbox label={t('staff.sendInvite')} description={t('staff.sendInviteHint')} checked={sendInvite} onChange={(ev) => setSendInvite(ev.target.checked)} />
        </div>
      )}
    </Drawer>
  );
}
