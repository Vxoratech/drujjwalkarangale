import { PageHeader } from '@/components/ui/PageHeader';
import { useI18n } from '@/locales/i18n';
import { FollowUpsCard } from './FollowUpsCard';

export function FollowUpsPage() {
  const { t } = useI18n();
  return (
    <>
      <PageHeader title={t('nav.followUps')} description={t('followUps.subtitle')} />
      <FollowUpsCard days={null} />
    </>
  );
}
