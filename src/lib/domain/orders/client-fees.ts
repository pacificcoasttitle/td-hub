export interface FeeItem {
  description: string;
  amount: number;
}

export interface FeeInvoice {
  id: string | number;
  label: string;
  items: FeeItem[];
  total: number;
}

export interface ClientFeesViewData {
  invoices: FeeInvoice[];
  grandTotal: number;
  fileNumber?: string;
}

interface ClientFeesApiInvoice {
  invoiceNumber?: string | null;
  fees?: FeeItem[] | null;
  total?: number | null;
}

interface ClientFeesApiData {
  invoices?: ClientFeesApiInvoice[] | null;
  grandTotal?: number | null;
  fileNumber?: string;
}

interface ClientFeesApiResponse {
  success?: boolean;
  data?: ClientFeesApiData | null;
  error?: string;
}

export function normalizeClientFeesResponse(body: ClientFeesApiResponse | null): ClientFeesViewData {
  if (!body) {
    throw new Error('Failed to load fee estimate');
  }

  if (body.success === false) {
    throw new Error(body.error ?? 'Fee information is not available at this time');
  }

  if (!body.data) {
    throw new Error('Fee information is not available at this time');
  }

  const invoices = (body.data.invoices ?? []).map((invoice, index) => {
    const items = invoice.fees ?? [];
    const invoiceNumber = invoice.invoiceNumber ?? null;
    return {
      id: invoiceNumber ?? `invoice-${index + 1}`,
      label: invoiceNumber ? `Invoice ${invoiceNumber}` : `Invoice ${index + 1}`,
      items,
      total: invoice.total ?? items.reduce((sum, item) => sum + item.amount, 0),
    };
  });

  return {
    invoices,
    grandTotal: body.data.grandTotal ?? invoices.reduce((sum, invoice) => sum + invoice.total, 0),
    fileNumber: body.data.fileNumber,
  };
}
