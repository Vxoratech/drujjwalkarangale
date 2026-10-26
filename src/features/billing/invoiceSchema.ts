import { z } from 'zod';
import { rupeesToPaise } from '@/lib/formatters';
import { INVOICE_ITEM_TYPES, PAYMENT_METHODS } from '@/types/domain';

const rupees = (max: number) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => (v === '' ? Number.NaN : rupeesToPaise(v)))
    .refine((p) => Number.isFinite(p) && p >= 0 && p <= max * 100, { message: `range:0:${max}` });

export const invoiceLineSchema = z.object({
  description: z.string().trim().min(1).max(200),
  item_type: z.enum(INVOICE_ITEM_TYPES),
  quantity: z.union([z.string(), z.number()]).pipe(z.coerce.number().positive().max(10000)),
  unit_price: rupees(1_000_000),
  tax_rate: z.union([z.string(), z.number()]).pipe(z.coerce.number().min(0).max(28)),
});

export const invoiceSchema = z.object({
  patient_id: z.string().uuid({ message: 'required' }),
  items: z.array(invoiceLineSchema).min(1).max(100),
  discount: z
    .union([z.string(), z.number()])
    .transform((v) => (v === '' ? 0 : rupeesToPaise(v)))
    .refine((p) => Number.isFinite(p) && p >= 0, { message: 'range:0:10000000' }),
  notes: z.string().trim().max(1000).optional().or(z.literal('')),
});

export type InvoiceFormInput = z.input<typeof invoiceSchema>;
export type InvoiceFormValues = z.output<typeof invoiceSchema>;

export const paymentSchema = z.object({
  amount: rupees(10_000_000).refine((p) => p > 0, { message: 'range:0.01:10000000' }),
  method: z.enum(PAYMENT_METHODS),
  reference: z.string().trim().max(80).optional().or(z.literal('')),
  paid_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().trim().max(500).optional().or(z.literal('')),
});
export type PaymentFormInput = z.input<typeof paymentSchema>;
export type PaymentFormValues = z.output<typeof paymentSchema>;

export const refundSchema = z.object({
  amount: rupees(10_000_000).refine((p) => p > 0, { message: 'range:0.01:10000000' }),
  method: z.enum(PAYMENT_METHODS),
  reason: z.string().trim().min(1).max(500),
  payment_id: z.string().uuid().optional().or(z.literal('')),
  reference: z.string().trim().max(80).optional().or(z.literal('')),
});
export type RefundFormInput = z.input<typeof refundSchema>;
export type RefundFormValues = z.output<typeof refundSchema>;
