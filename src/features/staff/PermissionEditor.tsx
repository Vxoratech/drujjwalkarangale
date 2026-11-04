import { Lock, ShieldAlert, Stethoscope } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { cn } from '@/lib/cn';
import { useI18n, type TranslationKey } from '@/locales/i18n';
import type { Overrides } from '@/services/staff';
import type { PermissionDefinition } from '@/types/domain';

/** Module display order; unknown modules follow in catalogue order. */
const MODULE_ORDER = ['patients', 'consents', 'appointments', 'follow_ups', 'consultations', 'examinations', 'prescriptions', 'investigations', 'documents', 'billing', 'payments', 'reports', 'staff', 'branches', 'settings', 'audit'];

export function groupByModule(catalog: PermissionDefinition[]): [string, PermissionDefinition[]][] {
  const groups = new Map<string, PermissionDefinition[]>();
  for (const p of [...catalog].sort((a, b) => a.position - b.position)) groups.set(p.module, [...(groups.get(p.module) ?? []), p]);
  return [...groups.entries()].sort(([a], [b]) => (MODULE_ORDER.indexOf(a) + 1 || 99) - (MODULE_ORDER.indexOf(b) + 1 || 99));
}

/** Effective permissions of a template plus overrides (mirrors private.staff_permissions). */
export function effectiveSet(template: readonly string[], overrides: Overrides, catalog: PermissionDefinition[]): Set<string> {
  const doctorOnly = new Set(catalog.filter((p) => p.doctor_only).map((p) => p.key));
  const out = new Set<string>();
  for (const k of template) if (overrides[k] !== 'deny') out.add(k);
  for (const [k, v] of Object.entries(overrides)) if (v === 'grant') out.add(k);
  for (const k of doctorOnly) out.delete(k);
  return out;
}

function Switch({ checked, disabled, onChange, label }: { checked: boolean; disabled?: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-fast',
        'focus-visible:outline-none focus-visible:shadow-focus disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-forest' : 'bg-line-strong',
      )}
    >
      <span className={cn('inline-block size-5 rounded-full bg-surface shadow-sm transition-transform duration-fast', checked ? 'translate-x-[22px]' : 'translate-x-0.5')} />
    </button>
  );
}

export interface PermissionEditorProps {
  catalog: PermissionDefinition[];
  /** Keys granted by the template (staff mode) or the template's own keys (template mode). */
  template: readonly string[];
  /** Staff mode: per-staff grant/deny overrides. Omit for template mode. */
  overrides?: Overrides;
  onChange: (next: { template: string[]; overrides: Overrides }) => void;
  /** Keys the current user may grant (their authority); others are locked. */
  grantable: (key: string) => boolean;
  readOnly?: boolean;
}

/**
 * Module-by-module permission switches. In staff mode, switching a template
 * permission off records a deny and switching any other on records a grant.
 * Turning on a sensitive or clinical permission asks for confirmation.
 * Doctor-only permissions are shown locked: they can never be given to staff.
 */
export function PermissionEditor({ catalog, template, overrides, onChange, grantable, readOnly }: PermissionEditorProps) {
  const { t } = useI18n();
  const staffMode = overrides !== undefined;
  const groups = useMemo(() => groupByModule(catalog), [catalog]);
  const effective = useMemo(() => (staffMode ? effectiveSet(template, overrides!, catalog) : new Set(template)), [staffMode, template, overrides, catalog]);
  const [pending, setPending] = useState<PermissionDefinition | null>(null);

  function apply(p: PermissionDefinition, on: boolean) {
    if (!staffMode) {
      const next = on ? [...new Set([...template, p.key])] : template.filter((k) => k !== p.key);
      onChange({ template: next, overrides: {} });
      return;
    }
    const next: Overrides = { ...overrides };
    const inTemplate = template.includes(p.key);
    delete next[p.key];
    if (inTemplate && !on) next[p.key] = 'deny';
    if (!inTemplate && on) next[p.key] = 'grant';
    onChange({ template: [...template], overrides: next });
  }

  function toggle(p: PermissionDefinition, on: boolean) {
    if (on && p.sensitivity !== 'normal') setPending(p);
    else apply(p, on);
  }

  return (
    <div className="space-y-4">
      {groups.map(([module, perms]) => (
        <fieldset key={module} className="rounded-lg border border-line">
          <legend className="ml-3 px-1.5 font-display text-sm font-semibold">{t(`permModule.${module}` as TranslationKey)}</legend>
          <ul className="divide-y divide-line">
            {perms.map((p) => {
              const on = effective.has(p.key);
              const override = overrides?.[p.key];
              const locked = p.doctor_only || !grantable(p.key);
              return (
                <li key={p.key} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                      {p.label}
                      {p.doctor_only && (
                        <Badge tone="forest">
                          <Stethoscope className="size-3" aria-hidden /> {t('permissions.doctorOnly')}
                        </Badge>
                      )}
                      {!p.doctor_only && p.sensitivity === 'clinical' && <Badge tone="info">{t('permissions.clinical')}</Badge>}
                      {p.sensitivity === 'sensitive' && <Badge tone="warning">{t('permissions.sensitive')}</Badge>}
                      {override === 'grant' && <Badge tone="success">{t('permissions.granted')}</Badge>}
                      {override === 'deny' && <Badge tone="danger">{t('permissions.denied')}</Badge>}
                    </p>
                    <p className="text-xs text-ink-muted">{p.description}</p>
                  </div>
                  {locked && !p.doctor_only && <Lock className="size-4 shrink-0 text-ink-muted" aria-label={t('permissions.outsideAuthority')} />}
                  <Switch checked={on} disabled={readOnly || locked} onChange={(v) => toggle(p, v)} label={p.label} />
                </li>
              );
            })}
          </ul>
        </fieldset>
      ))}
      <ConfirmDialog
        open={Boolean(pending)}
        onOpenChange={(o) => !o && setPending(null)}
        title={t('permissions.confirmTitle')}
        body={
          pending && (
            <span className="flex gap-2">
              <ShieldAlert className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
              <span>{t(pending.sensitivity === 'clinical' ? 'permissions.confirmClinical' : 'permissions.confirmSensitive', { permission: pending.label })}</span>
            </span>
          )
        }
        confirmLabel={t('permissions.confirmGrant')}
        cancelLabel={t('common.cancel')}
        tone="danger"
        onConfirm={() => {
          if (pending) apply(pending, true);
          setPending(null);
        }}
      />
    </div>
  );
}
