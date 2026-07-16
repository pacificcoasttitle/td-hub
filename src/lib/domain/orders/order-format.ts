const EMPTY = '—';

export interface OrderAddressParts {
  address?: string | null;
  line1?: string | null;
  street?: string | null;
  propertyStreet?: string | null;
  line2?: string | null;
  unit?: string | null;
  city?: string | null;
  propertyCity?: string | null;
  state?: string | null;
  propertyState?: string | null;
  zip?: string | null;
  propertyZip?: string | null;
  fullAddress?: string | null;
  county?: string | null;
}

export function formatOrderMoney(amount: number | string | null | undefined): string {
  if (amount === null || amount === undefined || amount === '') return EMPTY;

  const numeric = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(numeric)) return EMPTY;

  return numeric.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

export function formatOrderAddress(property: OrderAddressParts | null | undefined): string {
  if (!property) return EMPTY;

  const line1 = firstPresent(property.address, property.line1, property.street, property.propertyStreet);
  const line2 = firstPresent(property.line2, property.unit);
  const city = firstPresent(property.city, property.propertyCity);
  const state = firstPresent(property.state, property.propertyState);
  const zip = firstPresent(property.zip, property.propertyZip);

  const streetLine = [line1, line2].filter(Boolean).join(' ');
  const stateZip = [state, zip].filter(Boolean).join(' ');
  const components = [streetLine, city, stateZip].filter(Boolean);

  if (components.length > 0) return components.join(', ');
  return clean(property.fullAddress) ?? EMPTY;
}

export function formatCounty(county: string | null | undefined): string {
  return clean(county) ?? EMPTY;
}

function firstPresent(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const cleaned = clean(value);
    if (cleaned) return cleaned;
  }
  return null;
}

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
