import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { notify } from '@/components/feedback/toast';
import { FormField, FormGrid } from '@/components/forms/FormField';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Checkbox, Select } from '@/components/ui/Input';
import { useClinic } from '@/features/clinic/ClinicProvider';
import { qk } from '@/lib/query/keys';
import { useI18n, type TranslationKey } from '@/locales/i18n';
import { updateClinicSettings } from '@/services/clinic';
import { CONSULTATION_SECTIONS, type ClinicSettings, type ConsultationSection } from '@/types/domain';

const SECTION_LABELS: Record<ConsultationSection, TranslationKey> = {
  pain: 'history.vedanaVishesha',
  family_history: 'history.familyHistory',
  menstrual_history: 'history.rajoItihas',
  dinacharya: 'exam.lifestyleSection',
  general_examination: 'exam.generalExamination',
  dosha_assessment: 'exam.doshaAssessment',
  clinic_fields: 'exam.clinicFields',
};

/** Clinic-wide preferences stored in clinics.settings (validated server-side). */
export function PreferencesCard() {
  const { t } = useI18n();
  const { clinicId, clinic } = useClinic();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<ClinicSettings>(clinic.settings);
  const sections = draft.consultation_sections ?? {};
  const dirty = JSON.stringify(draft) !== JSON.stringify(clinic.settings);

  const save = useMutation({
    mutationFn: () => {
      // The demo flag is platform-managed; never send it back.
      const { demo: _demo, ...rest } = draft;
      return updateClinicSettings(clinicId, { ...rest, ...(clinic.settings.demo !== undefined ? { demo: clinic.settings.demo } : {}) });
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(qk.clinic(clinicId), saved);
      notify.success(t('settings.saved'));
    },
    onError: (e) => notify.error(e),
  });

  return (
    <Card>
      <CardHeader title={t('settings.preferences')} description={t('settings.preferencesHint')} />
      <CardBody className="space-y-5">
        <FormGrid cols={3}>
          <FormField label={t('settings.defaultDuration')}>
            <Select
              value={String(draft.default_appointment_minutes ?? 30)}
              onChange={(e) => setDraft({ ...draft, default_appointment_minutes: Number(e.target.value) })}
              options={[10, 15, 20, 30, 45, 60].map((m) => ({ value: String(m), label: t('appointments.minutes', { count: m }) }))}
            />
          </FormField>
          <FormField label={t('settings.rxLanguage')}>
            <Select
              value={draft.prescription_language ?? 'patient'}
              onChange={(e) => setDraft({ ...draft, prescription_language: e.target.value as ClinicSettings['prescription_language'] })}
              options={[
                { value: 'patient', label: t('settings.rxLanguagePatient') },
                { value: 'en', label: 'English' },
                { value: 'mr', label: 'मराठी' },
              ]}
            />
          </FormField>
        </FormGrid>
        <Checkbox
          label={t('settings.bilingualLabels')}
          description={t('settings.bilingualLabelsHint')}
          checked={draft.bilingual_labels ?? false}
          onChange={(e) => setDraft({ ...draft, bilingual_labels: e.target.checked })}
        />
        <fieldset>
          <legend className="mb-2 text-sm font-medium">{t('settings.consultationSections')}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {CONSULTATION_SECTIONS.map((key) => (
              <Checkbox
                key={key}
                label={t(SECTION_LABELS[key])}
                checked={sections[key] !== false}
                onChange={(e) => setDraft({ ...draft, consultation_sections: { ...sections, [key]: e.target.checked } })}
              />
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-muted">{t('settings.consultationSectionsHint')}</p>
        </fieldset>
        <div className="flex justify-end">
          <Button disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>
            {t('common.save')}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
