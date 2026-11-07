import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Lock, MailOpen, ShieldQuestion } from 'lucide-react';
import { AuthLayout } from '@/app/layouts/AuthLayout';
import { Alert } from '@/components/feedback/States';
import { notify } from '@/components/feedback/toast';
import { Button } from '@/components/ui/Button';
import { useCurrentUser } from '@/features/auth/AuthProvider';
import { qk } from '@/lib/query/keys';
import { useI18n } from '@/locales/i18n';
import { signOut } from '@/services/auth';
import { acceptStaffInvitation, type AccessResult } from '@/services/organization';

function SignOutLink() {
  const { t } = useI18n();
  return (
    <button type="button" className="font-medium text-forest hover:underline" onClick={() => void signOut()}>
      {t('common.signOut')}
    </button>
  );
}

function InvitationScreen() {
  const { t } = useI18n();
  const user = useCurrentUser();
  const queryClient = useQueryClient();
  const accept = useMutation({
    mutationFn: acceptStaffInvitation,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.access(user.id) }),
    onError: (e) => notify.error(e),
  });
  return (
    <AuthLayout title={t('access.invitationTitle')} footer={<SignOutLink />}>
      <div className="space-y-6">
        <div className="flex gap-3 rounded-lg border border-line bg-surface p-4">
          <MailOpen className="mt-0.5 size-5 shrink-0 text-forest" aria-hidden />
          <p className="text-sm">{t('access.invitationBody')}</p>
        </div>
        <Button size="lg" fullWidth loading={accept.isPending} onClick={() => accept.mutate()}>
          {t('access.acceptInvitation')}
        </Button>
      </div>
    </AuthLayout>
  );
}

/** Shown when the signed-in account has no access: deactivated, or never given access. */
export function NoAccessScreen({ reason }: { reason: Extract<AccessResult, { account_type: null }>['reason'] }) {
  const { t } = useI18n();
  if (reason === 'invited') return <InvitationScreen />;
  const deactivated = reason === 'deactivated';
  return (
    <AuthLayout title={t(deactivated ? 'access.deactivatedTitle' : 'access.noAccessTitle')} footer={<SignOutLink />}>
      <Alert tone={deactivated ? 'warning' : 'info'} icon={deactivated ? <Lock /> : <ShieldQuestion />}>
        {t(deactivated ? 'access.deactivatedBody' : 'access.noAccessBody')}
      </Alert>
    </AuthLayout>
  );
}
