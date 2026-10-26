import { getSupabase } from '@/lib/supabase/client';
import type { Invoice, InvoiceDetail, InvoiceItemType, InvoiceStatus, Page, Paise, PaymentMethod, Timestamp, UUID } from '@/types/domain';
import { unwrap, unwrapPage } from './_helpers';

const LIST = 'id, clinic_id, patient_id, appointment_id, invoice_no, status, issue_date, subtotal_paise, tax_paise, discount_paise, total_paise, amount_paid_paise, amount_refunded_paise, notes, void_reason, created_at, patient:patients(id, first_name, last_name, patient_code, phone)';

export interface InvoiceListParams {
  page: number;
  pageSize: number;
  status?: InvoiceStatus | 'outstanding';
  patientId?: UUID;
  search?: string;
}

export async function listInvoices(clinicId: UUID, params: InvoiceListParams): Promise<Page<Invoice>> {
  let q = getSupabase().from('invoices').select(LIST, { count: 'exact' }).eq('clinic_id', clinicId);
  if (params.status === 'outstanding') q = q.in('status', ['issued', 'partially_paid']);
  else if (params.status) q = q.eq('status', params.status);
  if (params.patientId) q = q.eq('patient_id', params.patientId);
  if (params.search) q = q.ilike('invoice_no', `%${params.search.replace(/[%_]/g, '')}%`);
  const from = (params.page - 1) * params.pageSize;
  return unwrapPage<Invoice>(await q.order('issue_date', { ascending: false }).order('created_at', { ascending: false }).range(from, from + params.pageSize - 1));
}

export async function getInvoice(clinicId: UUID, id: UUID): Promise<InvoiceDetail> {
  const inv = unwrap<InvoiceDetail>(
    await getSupabase().from('invoices').select(`${LIST}, items:invoice_items(*), payments(*), refunds(*)`).eq('clinic_id', clinicId).eq('id', id).single(),
  );
  return {
    ...inv,
    items: [...inv.items].sort((a, b) => a.position - b.position),
    payments: [...inv.payments].sort((a, b) => a.paid_at.localeCompare(b.paid_at)),
    refunds: [...(inv.refunds ?? [])].sort((a, b) => a.refunded_at.localeCompare(b.refunded_at)),
  };
}

export interface InvoiceLineInput {
  description: string;
  item_type: InvoiceItemType;
  quantity: number;
  unit_price_paise: Paise;
  tax_rate: number;
}

export async function createInvoice(
  clinicId: UUID,
  input: { patientId: UUID; items: InvoiceLineInput[]; discountPaise: Paise; notes: string | null; appointmentId?: UUID | null },
): Promise<Invoice> {
  return unwrap<Invoice>(
    await getSupabase().rpc('create_invoice', {
      p_clinic: clinicId,
      p_patient: input.patientId,
      p_items: input.items,
      p_discount_paise: input.discountPaise,
      p_notes: input.notes,
      p_appointment: input.appointmentId ?? null,
    }),
  );
}

export async function recordPayment(input: { invoiceId: UUID; amountPaise: Paise; method: PaymentMethod; reference: string | null; paidAt: Timestamp; notes: string | null }): Promise<void> {
  unwrap(
    await getSupabase().rpc('record_payment', {
      p_invoice: input.invoiceId,
      p_amount_paise: input.amountPaise,
      p_method: input.method,
      p_reference: input.reference,
      p_paid_at: input.paidAt,
      p_notes: input.notes,
    }),
  );
}

export async function recordRefund(input: { invoiceId: UUID; amountPaise: Paise; method: PaymentMethod; reason: string; paymentId: UUID | null; reference: string | null }): Promise<void> {
  unwrap(
    await getSupabase().rpc('record_refund', {
      p_invoice: input.invoiceId,
      p_amount_paise: input.amountPaise,
      p_method: input.method,
      p_reason: input.reason,
      p_payment: input.paymentId,
      p_reference: input.reference,
    }),
  );
}

export async function voidInvoice(id: UUID, reason: string): Promise<void> {
  unwrap(await getSupabase().rpc('void_invoice', { p_invoice: id, p_reason: reason }));
}

/** Client-side preview of totals using the same rounding as create_invoice(). */
export function previewTotals(items: Pick<InvoiceLineInput, 'quantity' | 'unit_price_paise' | 'tax_rate'>[], discountPaise: Paise) {
  let subtotal = 0;
  let tax = 0;
  for (const item of items) {
    const qty = Number.isFinite(item.quantity) ? item.quantity : 0;
    const price = Number.isFinite(item.unit_price_paise) ? item.unit_price_paise : 0;
    const line = Math.round(qty * price);
    subtotal += line;
    tax += Math.round((line * (Number.isFinite(item.tax_rate) ? item.tax_rate : 0)) / 100);
  }
  const discount = Number.isFinite(discountPaise) ? discountPaise : 0;
  return { subtotal, tax, discount, total: subtotal + tax - discount };
}
