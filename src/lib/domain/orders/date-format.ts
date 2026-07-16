const ORDER_TIME_ZONE = 'America/Los_Angeles';
const EMPTY_DATE = '—';

const ORDER_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: ORDER_TIME_ZONE,
});

const ORDER_DATE_TIME_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: ORDER_TIME_ZONE,
});

export function formatOrderDate(value: string | Date | null | undefined): string {
  const date = parseOrderDate(value);
  return date ? ORDER_DATE_FORMATTER.format(date) : EMPTY_DATE;
}

export function formatOrderDateTime(value: string | Date | null | undefined): string {
  const date = parseOrderDate(value);
  return date ? ORDER_DATE_TIME_FORMATTER.format(date) : EMPTY_DATE;
}

function parseOrderDate(value: string | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;

  const normalized = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T12:00:00.000Z`
    : value;
  const date = normalized instanceof Date ? normalized : new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}
