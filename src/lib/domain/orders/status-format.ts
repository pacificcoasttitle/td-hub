export const ORDER_STATUSES = [
  'open',
  'in_process',
  'completed',
  'closed',
  'canceled',
  'duplicate',
] as const;

export type OrderStatus = typeof ORDER_STATUSES[number];

const STATUS_LABELS: Record<OrderStatus, string> = {
  open: 'Open',
  in_process: 'In Process',
  completed: 'Completed',
  closed: 'Closed',
  canceled: 'Canceled',
  duplicate: 'Duplicate',
};

// Canonical semantic palette for order statuses:
// open=blue, in_process=amber, completed=teal, closed=green, canceled=red, duplicate=gray.
const STATUS_COLORS: Record<OrderStatus, string> = {
  open: 'bg-blue-50 text-blue-700 border-blue-200',
  in_process: 'bg-amber-50 text-amber-700 border-amber-200',
  completed: 'bg-teal-50 text-teal-700 border-teal-200',
  closed: 'bg-green-50 text-green-700 border-green-200',
  canceled: 'bg-red-50 text-red-700 border-red-200',
  duplicate: 'bg-gray-100 text-gray-600 border-gray-200',
};

const UNKNOWN_COLOR = 'bg-gray-100 text-gray-600 border-gray-200';

export const STATUS_FILTER_OPTIONS = ORDER_STATUSES.map((value) => ({
  value,
  label: STATUS_LABELS[value],
}));

export function isOrderStatus(status: string | null | undefined): status is OrderStatus {
  return ORDER_STATUSES.includes(status as OrderStatus);
}

function fallbackLabel(status: string): string {
  return status
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function statusLabel(status: string | null | undefined): string {
  if (!status) return '—';
  return isOrderStatus(status) ? STATUS_LABELS[status] : fallbackLabel(status);
}

export function statusColor(status: string | null | undefined): string {
  return isOrderStatus(status) ? STATUS_COLORS[status] : UNKNOWN_COLOR;
}

export function statusBadge(status: string | null | undefined) {
  return {
    label: statusLabel(status),
    color: statusColor(status),
  };
}
