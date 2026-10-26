import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Building2, ChevronRight, Lock, MailOpen } from 'lucide-react';
import { AuthLayout } from '@/app/layouts/AuthLayout';
import { Alert } from '@/components/feedback/States';
import { notify } from '@/components/feedback/toast';
import { Button } from '@/components/ui/Button';
import { useCurrentUser } from '@/features/auth/AuthProvider';
import { qk } from '@/lib/query/keys';
import { useI18n } from '@/locales/i18n';
import { signOut } from '@/services/auth';
import { acceptInvitation } from '@/services/clinic';
import type { Membership } from '@/types/domain';

function SignOutLink() {
  const { t } = useI18n();
  return (
    <button type="button" className="font-medium text-forest hover:underline" onClick={() => void signOut()}>
      {t('common.signOut')}
    </button>
  );
}

function OtherClinics({ memberships, choose }: { memberships: Membership[]; choose: (id: string) => void }) {
  const { t } = useI18n();
  if (memberships.length === 0) return null;
  return (
    <div className="mt-8">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-muted">{t('common.switchClinic')}</p>
      <ClinicList memberships={memberships} choose={choose} />
    </div>
  );
}

function ClinicList({ memberships, choose }: { memberships: Membership[]; choose: (id: string) => void }) {
  const { t } = useI18n();
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
      {memberships.map((m) => (
        <li key={m.id}>
          <button type="button" onClick={() => choose(m.clinic_id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-ivory">
            <Building2 className="size-5 shrink-0 text-forest" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{m.clinic?.name ?? '—'}</span>
              <span className="block text-xs text-ink-muted">
                {m.roles.map((r) => t(`roles.${r}`)).join(' · ')}
                {m.status === 'invited' && ` · ${t('onboarding.pendingInvitation')}`}
                {m.clinic && m.clinic.status !== 'active' && ` · ${t('onboarding.suspendedTitle')}`}
              </span>
            </span>
            <ChevronRight className="size-4 text-ink-muted" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}

export function ClinicPickerScreen({ memberships, choose }: { memberships: Membership[]; choose: (id: string) => void }) {
  const { t } = useI18n();
  return (
    <AuthLayout title={t('onboarding.pickClinicTitle')} subtitle={t('onboarding.pickClinicBody')} footer={<SignOutLink />}>
      <ClinicList memberships={memberships} choose={choose} />
    </AuthLayout>
  );
}

export function InvitationScreen({ membership, others, choose }: { membership: Membership; others: Membership[]; choose: (id: string) => void }) {
  const { t } = useI18n();
  const user = useCurrentUser();
  const queryClient = useQueryClient();
  const accept = useMutation({
    mutationFn: () => acceptInvitation(membership.clinic_id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.memberships(user.id) }),
    onError: (e) => notify.error(e),
  });
  return (
    <AuthLayout title={t('onboarding.invitationTitle')} footer={<SignOutLink />}>
      <div className="space-y-6">
        <div className="flex gap-3 rounded-lg border border-line bg-surface p-4">
          <MailOpen className="mt-0.5 size-5 shrink-0 text-forest" aria-hidden />
          <p className="text-sm">
            {t('onboarding.invitationBody', { clinic: membership.clinic?.name ?? '—', roles: membership.roles.map((r) => t(`roles.${r}`)).join(' + ') })}
          </p>
        </div>
        <Button size="lg" fullWidth loading={accept.isPending} onClick={() => accept.mutate()}>
          {t('onboarding.acceptInvitation')}
        </Button>
        <OtherClinics memberships={others} choose={choose} />
      </div>
    </AuthLayout>
  );
}

export function SuspendedScreen({ membership, others, choose }: { membership: Membership; others: Membership[]; choose: (id: string) => void }) {
  const { t } = useI18n();
  return (
    <AuthLayout title={t('onboarding.suspendedTitle')} footer={<SignOutLink />}>
      <Alert tone="warning" icon={<Lock />}>
        {t('onboarding.suspendedBody', { clinic: membership.clinic?.name ?? '—' })}
      </Alert>
      <OtherClinics memberships={others} choose={choose} />
    </AuthLayout>
  );
}
