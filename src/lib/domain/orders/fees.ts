import { getOrderByIdSimple } from '@/lib/domain/orders/service';
import { getFees } from '@/lib/integrations/softpro';
import type { SoftProInvoice } from '@/lib/integrations/softpro/types';
import type { OrderSubresourceVisibility } from './subresource-visibility';

export interface OrderFeeLine {
  description: string;
  amount: number;
}

/** M5 / DetailModal invoice shape (body.data.invoices). */
export interface OrderFeeInvoice {
  invoiceNumber: string;
  /** Staff-only; omitted for client visibility. */
  invoiceDate?: string | null;
  fees: OrderFeeLine[];
  total: number;
}

export interface OrderFeesData {
  invoices: OrderFeeInvoice[];
  grandTotal: number;
}

export type GetOrderFeesResult =
  | { ok: true; success: true; data: OrderFeesData }
  | { ok: true; success: false; error: string }
  | { ok: false; notFound: true };

function mapInvoice(inv: SoftProInvoice, visibility: OrderSubresourceVisibility): OrderFeeInvoice {
  const fees = inv.Fees.map((f) => ({
    description: f.Description,
    amount: f.Amount,
  }));
  const total = inv.Total.Amount;
  const base: OrderFeeInvoice = {
    invoiceNumber: inv.InvoiceNumber,
    fees,
    total,
  };

  if (visibility === 'staff') {
    const dated = inv as SoftProInvoice & {
      InvoiceDate?: string | null;
      Date?: string | null;
      CreatedDate?: string | null;
    };
    base.invoiceDate = dated.InvoiceDate ?? dated.Date ?? dated.CreatedDate ?? null;
  }

  return base;
}

/**
 * Canonical SoftPro fees loader (live vendor call — not part of getOrderReadModel).
 * Returns the M5 envelope shape: success + data.invoices / grandTotal.
 */
export async function getOrderFees(
  orderId: number,
  visibility: OrderSubresourceVisibility,
): Promise<GetOrderFeesResult> {
  const order = await getOrderByIdSimple(orderId);
  if (!order) {
    return { ok: false, notFound: true };
  }

  const result = await getFees(order.fileNumber);
  if (!result.success || !result.data) {
    return {
      ok: true,
      success: false,
      error: visibility === 'client'
        ? 'Fee information is not available at this time'
        : (result.error?.message ?? 'Failed to retrieve fees'),
    };
  }

  const invoices = result.data.map((inv) => mapInvoice(inv, visibility));
  const grandTotal = invoices.reduce((sum, inv) => sum + inv.total, 0);

  return {
    ok: true,
    success: true,
    data: { invoices, grandTotal },
  };
}
