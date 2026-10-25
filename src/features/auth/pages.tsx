import { zodResolver } from '@hookform/resolvers/zod';
import { Eye, EyeOff, Mail } from 'lucide-react';
import { forwardRef, useState, type ComponentProps } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { AuthLayout } from '@/app/layouts/AuthLayout';
import { Alert } from '@/components/feedback/States';
import { notify } from '@/components/feedback/toast';
import { FormField } from '@/components/forms/FormField';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { toUserMessage } from '@/lib/errors';
import { setPasswordSchema, signInSchema, signUpSchema } from '@/lib/validation/schemas';
import { useFieldError } from '@/lib/validation/useFieldError';
import { useI18n } from '@/locales/i18n';
import { requestPasswordReset, signIn, signUp, updatePassword } from '@/services/auth';
import { useAuth } from './AuthProvider';

const PasswordInput = forwardRef<HTMLInputElement, ComponentProps<typeof Input>>(function PasswordInput(props, ref) {
  const [visible, setVisible] = useState(false);
  return (
    <Input
      ref={ref}
      {...props}
      type={visible ? 'text' : 'password'}
      trailing={
        <button type="button" className="rounded p-1 hover:bg-sage" onClick={() => setVisible((v) => !v)} aria-label={visible ? 'Hide password' : 'Show password'} aria-pressed={visible}>
          {visible ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
        </button>
      }
    />
  );
});

export function SignInPage() {
  const { t } = useI18n();
  const { state } = useAuth();
  const location = useLocation();
  const fieldError = useFieldError();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<z.infer<typeof signInSchema>>({ resolver: zodResolver(signInSchema), defaultValues: { email: '', password: '' } });
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  if (state.status === 'signed_in') return <Navigate to={from} replace />;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await signIn(values.email, values.password);
    } catch (error) {
      setFormError(toUserMessage(error, 'Invalid login credentials.'));
    }
  });

  return (
    <AuthLayout
      title={t('auth.signInTitle')}
      subtitle={t('auth.signInSubtitle')}
      footer={
        <>
          {t('auth.noAccount')}{' '}
          <Link to="/auth/sign-up" className="font-medium text-forest hover:underline">
            {t('auth.createAccount')}
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && <Alert tone="danger">{formError}</Alert>}
        <FormField label={t('auth.email')} error={fieldError(form.formState.errors.email)} required>
          <Input type="email" autoComplete="email" inputMode="email" leading={<Mail />} {...form.register('email')} />
        </FormField>
        <FormField label={t('auth.password')} error={fieldError(form.formState.errors.password)} required>
          <PasswordInput autoComplete="current-password" {...form.register('password')} />
        </FormField>
        <div className="flex justify-end">
          <Link to="/auth/forgot" className="text-sm font-medium text-forest hover:underline">
            {t('auth.forgotPassword')}
          </Link>
        </div>
        <Button type="submit" fullWidth size="lg" loading={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? t('auth.signingIn') : t('auth.signIn')}
        </Button>
      </form>
    </AuthLayout>
  );
}

export function SignUpPage() {
  const { t } = useI18n();
  const fieldError = useFieldError();
  const navigate = useNavigate();
  const [message, setMessage] = useState<{ tone: 'danger' | 'success'; text: string } | null>(null);
  const form = useForm<z.infer<typeof signUpSchema>>({ resolver: zodResolver(signUpSchema), defaultValues: { fullName: '', email: '', password: '' } });

  const onSubmit = form.handleSubmit(async (values) => {
    setMessage(null);
    try {
      const { needsConfirmation } = await signUp(values.email, values.password, values.fullName);
      if (needsConfirmation) setMessage({ tone: 'success', text: t('auth.checkEmail') });
      else navigate('/onboarding');
    } catch (error) {
      setMessage({ tone: 'danger', text: toUserMessage(error) });
    }
  });

  return (
    <AuthLayout
      title={t('auth.signUpTitle')}
      footer={
        <Link to="/auth/sign-in" className="font-medium text-forest hover:underline">
          {t('auth.backToSignIn')}
        </Link>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {message && <Alert tone={message.tone}>{message.text}</Alert>}
        <FormField label={t('auth.fullName')} error={fieldError(form.formState.errors.fullName)} required>
          <Input autoComplete="name" {...form.register('fullName')} />
        </FormField>
        <FormField label={t('auth.email')} error={fieldError(form.formState.errors.email)} required>
          <Input type="email" autoComplete="email" {...form.register('email')} />
        </FormField>
        <FormField label={t('auth.password')} hint={t('auth.passwordHint')} error={form.formState.errors.password ? t('auth.passwordHint') : undefined} required>
          <PasswordInput autoComplete="new-password" {...form.register('password')} />
        </FormField>
        <Button type="submit" fullWidth size="lg" loading={form.formState.isSubmitting}>
          {t('auth.signUp')}
        </Button>
      </form>
    </AuthLayout>
  );
}

const forgotSchema = z.object({ email: z.string().trim().email() });

export function ForgotPasswordPage() {
  const { t } = useI18n();
  const fieldError = useFieldError();
  const [sent, setSent] = useState(false);
  const form = useForm<z.infer<typeof forgotSchema>>({ resolver: zodResolver(forgotSchema), defaultValues: { email: '' } });

  const onSubmit = form.handleSubmit(async ({ email }) => {
    try {
      await requestPasswordReset(email);
      setSent(true);
    } catch (error) {
      notify.error(error);
    }
  });

  return (
    <AuthLayout
      title={t('auth.resetTitle')}
      subtitle={t('auth.resetSubtitle')}
      footer={
        <Link to="/auth/sign-in" className="font-medium text-forest hover:underline">
          {t('auth.backToSignIn')}
        </Link>
      }
    >
      {sent ? (
        <Alert tone="success">{t('auth.linkSent')}</Alert>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <FormField label={t('auth.email')} error={fieldError(form.formState.errors.email)} required>
            <Input type="email" autoComplete="email" {...form.register('email')} />
          </FormField>
          <Button type="submit" fullWidth size="lg" loading={form.formState.isSubmitting}>
            {t('auth.sendLink')}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}

export function SetPasswordPage() {
  const { t } = useI18n();
  const { state, clearRecovery } = useAuth();
  const navigate = useNavigate();
  const fieldError = useFieldError();
  const form = useForm<z.infer<typeof setPasswordSchema>>({ resolver: zodResolver(setPasswordSchema), defaultValues: { password: '', confirm: '' } });

  if (state.status === 'signed_out') return <Navigate to="/auth/forgot" replace />;

  const onSubmit = form.handleSubmit(async ({ password }) => {
    try {
      await updatePassword(password);
      clearRecovery();
      notify.success(t('auth.passwordUpdated'));
      navigate('/', { replace: true });
    } catch (error) {
      notify.error(error);
    }
  });

  return (
    <AuthLayout title={t('auth.setPasswordTitle')} subtitle={t('auth.passwordHint')}>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormField label={t('auth.newPassword')} error={form.formState.errors.password ? t('auth.passwordHint') : undefined} required>
          <PasswordInput autoComplete="new-password" {...form.register('password')} />
        </FormField>
        <FormField label={t('auth.confirmPassword')} error={fieldError(form.formState.errors.confirm)} required>
          <PasswordInput autoComplete="new-password" {...form.register('confirm')} />
        </FormField>
        <Button type="submit" fullWidth size="lg" loading={form.formState.isSubmitting}>
          {t('common.save')}
        </Button>
      </form>
    </AuthLayout>
  );
}
