import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Plus, Save, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ErrorState, SkeletonRows } from '@/components/feedback/States';
import { notify } from '@/components/feedback/toast';
import { FormField } from '@/components/forms/FormField';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { ConfirmDialog, Modal } from '@/components/ui/Dialog';
import { Input, Textarea } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { useAccess } from '@/features/access/AccessProvider';
import { cn } from '@/lib/cn';
import { qk } from '@/lib/query/keys';
import { useI18n } from '@/locales/i18n';
import { deleteRoleTemplate, fetchPermissionCatalog, listRoleTemplates, listStaff, saveRoleTemplate } from '@/services/staff';
import type { RoleTemplate } from '@/types/domain';
import { PermissionEditor } from './PermissionEditor';

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^(\d)/, 'r_$1')
    .slice(0, 40) || 'custom_role';

/**
 * Staff role templates. Changing a template changes every staff member who
 * uses it (their individual overrides still apply). The doctor and admin
 * account roles are fixed and shown for reference only.
 */
export function RolesPage() {
  const { t } = useI18n();
  const { allBranches, permissions } = useAccess();
  const queryClient = useQueryClient();
  const roles = useQuery({ queryKey: qk.roles(), queryFn: listRoleTemplates });
  const catalog = useQuery({ queryKey: qk.permissionCatalog(), queryFn: fetchPermissionCatalog, staleTime: 30 * 60_000 });
  const staff = useQuery({ queryKey: qk.staff(), queryFn: listStaff });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [confirmSave, setConfirmSave] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const all = roles.data ?? [];
  const selected = all.find((r) => r.id === selectedId) ?? all.find((r) => r.scope === 'staff') ?? null;
  useEffect(() => setDraft(selected?.permissions ?? []), [selected]);
  const usage = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of staff.data ?? []) if (s.status !== 'inactive') m.set(s.role_id, (m.get(s.role_id) ?? 0) + 1);
    return m;
  }, [staff.data]);
  const editable = selected?.scope === 'staff';
  const dirty = editable && JSON.stringify([...draft].sort()) !== JSON.stringify([...(selected?.permissions ?? [])].sort());
  // Doctor and admin may place any non-doctor-only permission in a template.
  const grantable = (key: string) => allBranches || permissions.has(key as never);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: qk.roles() });
  const save = useMutation({
    mutationFn: (r: RoleTemplate) => saveRoleTemplate({ id: r.id, key: r.key, name: r.name, description: r.description, permissions: draft }),
    onSuccess: async () => {
      notify.success(t('roles.saved'));
      await invalidate();
    },
    onError: (e) => notify.error(e),
  });
  const create = useMutation({
    mutationFn: () => saveRoleTemplate({ key: slug(newName), name: newName.trim(), description: newDescription.trim() || null, permissions: [] }),
    onSuccess: async () => {
      notify.success(t('roles.created'));
      setCreating(false);
      setNewName('');
      setNewDescription('');
      await invalidate();
    },
    onError: (e) => notify.error(e),
  });

  return (
    <>
      <PageHeader
        title={t('roles.title')}
        description={t('roles.subtitle')}
        actions={
          <Button leftIcon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            {t('roles.newTemplate')}
          </Button>
        }
      />
      {roles.isLoading || catalog.isLoading ? (
        <SkeletonRows rows={8} />
      ) : roles.isError || catalog.isError ? (
        <ErrorState onRetry={() => void (roles.refetch(), catalog.refetch())} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <Card className="self-start">
            <CardHeader title={t('roles.templates')} />
            <ul className="divide-y divide-line">
              {all.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(r.id)}
                    className={cn('flex w-full items-start gap-3 px-5 py-3 text-left hover:bg-ivory', selected?.id === r.id && 'bg-sage/50')}
                    aria-current={selected?.id === r.id ? 'true' : undefined}
                  >
                    <KeyRound className="mt-0.5 size-4 shrink-0 text-forest" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{r.name}</span>
                      <span className="block text-xs text-ink-muted">
                        {r.scope === 'account' ? t('roles.accountRole') : t('roles.inUse', { count: usage.get(r.id) ?? 0 })} · {t('staff.permissionCount', { count: r.permissions.length })}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
          {selected && (
            <Card>
              <CardHeader
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    {selected.name}
                    {selected.is_system && <Badge>{t('roles.builtIn')}</Badge>}
                    {selected.scope === 'account' && <Badge tone="forest">{t('roles.fixed')}</Badge>}
                  </span>
                }
                description={selected.description ?? undefined}
                actions={
                  editable && (
                    <span className="flex gap-2">
                      {!selected.is_system && (
                        <Button size="sm" variant="ghost" leftIcon={<Trash2 className="size-4" />} onClick={() => setConfirmDelete(true)}>
                          {t('roles.delete')}
                        </Button>
                      )}
                      <Button size="sm" leftIcon={<Save className="size-4" />} disabled={!dirty} loading={save.isPending} onClick={() => setConfirmSave(true)}>
                        {t('common.save')}
                      </Button>
                    </span>
                  )
                }
              />
              <CardBody>
                {selected.scope === 'account' && <p className="mb-4 text-sm text-ink-muted">{t('roles.accountRoleHint')}</p>}
                <PermissionEditor catalog={catalog.data!} template={draft} onChange={(n) => setDraft(n.template)} grantable={grantable} readOnly={!editable} />
              </CardBody>
            </Card>
          )}
        </div>
      )}
      <Modal
        open={creating}
        onOpenChange={(o) => !create.isPending && setCreating(o)}
        title={t('roles.newTemplate')}
        closeLabel={t('common.close')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreating(false)} disabled={create.isPending}>
              {t('common.cancel')}
            </Button>
            <Button loading={create.isPending} disabled={newName.trim().length < 2} onClick={() => create.mutate()}>
              {t('roles.create')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <FormField label={t('roles.name')} required>
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={80} />
          </FormField>
          <FormField label={t('roles.description')}>
            <Textarea rows={2} value={newDescription} onChange={(e) => setNewDescription(e.target.value)} maxLength={300} />
          </FormField>
        </div>
      </Modal>
      <ConfirmDialog
        open={confirmSave}
        onOpenChange={setConfirmSave}
        title={t('roles.confirmSaveTitle')}
        body={t('roles.confirmSaveBody', { count: selected ? usage.get(selected.id) ?? 0 : 0 })}
        confirmLabel={t('staff.applyChanges')}
        onConfirm={() => (selected ? save.mutateAsync(selected) : undefined)}
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('roles.delete')}
        body={t('roles.confirmDeleteBody', { name: selected?.name ?? '' })}
        confirmLabel={t('roles.delete')}
        tone="danger"
        onConfirm={async () => {
          try {
            await deleteRoleTemplate(selected!.id);
            notify.success(t('roles.deleted'));
            setSelectedId(null);
            await invalidate();
          } catch (e) {
            notify.error(e);
            throw e;
          }
        }}
      />
    </>
  );
}
