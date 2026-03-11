'use client';

interface OrderDetail {
  fileNumber: string;
  operationalStatus: string;
  softproStatus: string | null;
  transactionType: string | null;
  productType: string | null;
  orderType: string | null;
  source: string;
  openedAt: string;
  completedAt: string | null;
  closedAt: string | null;
  salesPrice: string | null;
  loanAmount: string | null;
}

const SOURCE_LABELS: Record<string, string> = {
  softpro_sync: 'SoftPro Sync',
  manual: 'Manual',
  system: 'System',
  webhook: 'Webhook',
  manual_entry: 'Manual Entry',
  web_form: 'Web Form',
};

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-blue-100 text-blue-800',
  in_process: 'bg-amber-100 text-amber-800',
  completed: 'bg-green-100 text-green-800',
  closed: 'bg-slate-100 text-slate-800',
  canceled: 'bg-red-100 text-red-800',
  duplicate: 'bg-gray-100 text-gray-600',
};

export function OrderOverviewTab({ order }: { order: OrderDetail }) {
  return (
    <div className="p-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-12 gap-y-6">
        <div className="space-y-5">
          <SectionHeading>Order Details</SectionHeading>
          <FieldRow label="File Number" value={order.fileNumber} />
          <FieldRow label="Status">
            <StatusBadge status={order.operationalStatus} />
          </FieldRow>
          {order.softproStatus && <FieldRow label="SoftPro Status" value={order.softproStatus} />}
          <FieldRow label="Transaction Type" value={order.transactionType} />
          {order.productType && <FieldRow label="Product Type" value={order.productType} />}
          {order.orderType && <FieldRow label="Order Type" value={order.orderType} />}
          <FieldRow label="Source" value={SOURCE_LABELS[order.source] ?? order.source} />
        </div>
        <div className="space-y-5">
          <SectionHeading>Key Dates</SectionHeading>
          <FieldRow label="Opened" value={formatDate(order.openedAt)} />
          <FieldRow label="Completed" value={order.completedAt ? formatDate(order.completedAt) : null} />
          <FieldRow label="Closed" value={order.closedAt ? formatDate(order.closedAt) : null} />
          <div className="pt-2"><SectionHeading>Financials</SectionHeading></div>
          <FieldRow label="Sales Price" value={order.salesPrice ? formatCurrency(order.salesPrice) : null} />
          <FieldRow label="Loan Amount" value={order.loanAmount ? formatCurrency(order.loanAmount) : null} />
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? 'bg-gray-100 text-gray-600';
  return <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${color}`}>{status.replace(/_/g, ' ')}</span>;
}

export function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">{children}</h2>;
}

export function FieldRow({ label, value, children }: { label: string; value?: string | null; children?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4">
      <dt className="w-36 shrink-0 text-sm text-[#6B7280]">{label}</dt>
      <dd className="text-sm text-[#1A1A2E] font-medium">
        {children ?? value ?? <span className="text-[#6B7280] font-normal">—</span>}
      </dd>
    </div>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return '—'; }
}

function formatCurrency(value: string): string {
  const num = parseFloat(value);
  if (isNaN(num)) return value;
  return num.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}
