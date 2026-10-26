import { z } from 'zod';

/** Indian mobile/landline — mirrors the DB check `^\+?[0-9 -]{7,20}$`. */
export const phoneRegex = /^\+?[0-9 -]{7,20}$/;

export const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(''));
export const requiredText = (max: number, min = 1) => z.string().trim().min(min).max(max);
export const optionalPhone = z.string().trim().regex(phoneRegex).optional().or(z.literal(''));
export const optionalEmail = z.string().trim().email().max(254).optional().or(z.literal(''));

/** Numeric input that may be blank. Produces number | null. */
export const optionalNumber = (min: number, max: number) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => (v === '' || v === null ? null : Number(v)))
    .refine((v) => v === null || (Number.isFinite(v) && v >= min && v <= max), { message: `range:${min}:${max}` });

export const passwordSchema = z
  .string()
  .min(10)
  .max(72)
  .regex(/[a-z]/)
  .regex(/[A-Z]/)
  .regex(/[0-9]/);

export const signInSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

export const signUpSchema = z.object({
  fullName: requiredText(120, 2),
  email: z.string().trim().email(),
  password: passwordSchema,
});

export const setPasswordSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'passwordsMatch' });

export const createClinicSchema = z.object({
  name: requiredText(120, 2),
  city: optionalText(80),
  phone: optionalPhone,
  isPractitioner: z.boolean(),
});
