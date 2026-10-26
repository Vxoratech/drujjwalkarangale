import type { FieldError } from 'react-hook-form';
import { useI18n } from '@/locales/i18n';

/**
 * Translate Zod/RHF issues into localized messages. Custom refinements encode
 * parameters in the message (e.g. "range:20:250").
 */
export function useFieldError() {
  const { t } = useI18n();
  return (error: FieldError | undefined): string | undefined => {
    if (!error) return undefined;
    const msg = error.message ?? '';
    if (msg.startsWith('range:')) {
      const [, min, max] = msg.split(':');
      return t('validation.range', { min: min ?? '', max: max ?? '' });
    }
    if (msg === 'passwordsMatch') return t('validation.passwordsMatch');
    if (msg === 'pastDate') return t('validation.pastDate');
    if (msg === 'pincode') return t('validation.pincode');
    if (msg === 'gstin') return t('validation.gstin');
    if (msg === 'bpBoth') return t('validation.bpBoth');
    if (msg === 'bpOrder') return t('validation.bpOrder');
    if (msg === 'dobOrAge') return t('validation.dobOrAge');
    if (msg === 'slugFormat') return t('validation.slugFormat');
    switch (error.type) {
      case 'too_small':
        return msg.includes('at least 1 character') || msg.includes('Required') ? t('validation.required') : t('validation.tooShort', { min: /\d+/.exec(msg)?.[0] ?? '' });
      case 'too_big':
        return t('validation.tooLong', { max: /\d+/.exec(msg)?.[0] ?? '' });
      case 'invalid_string':
        if (msg.toLowerCase().includes('email')) return t('validation.email');
        return t('validation.phone');
      case 'invalid_type':
        return t('validation.required');
      default:
        return msg || t('validation.required');
    }
  };
}
