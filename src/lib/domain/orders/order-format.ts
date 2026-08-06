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

/**
 * True for a displayable money string that is not empty/dash/zero.
 *
 * Lives here (not in the confirmation template, where it started) so the email
 * and the order overview share ONE rule for "is there really a number here".
 * `confirmation-template` re-exports it for its existing callers.
 */
export function isMeaningfulMoney(value: string | null | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed === EMPTY || trimmed === '-' || trimmed.toLowerCase() === 'n/a') return false;
  const normalized = trimmed.replace(/[$,\s]/g, '');
  if (!normalized) return false;
  const n = Number(normalized);
  if (Number.isFinite(n) && n === 0) return false;
  return true;
}

/**
 * The single definition of "this is a refinance", shared by the confirmation
 * email (which picks Loan amount over Sales price) and the order overview
 * (which hides Sales Price / Seller).
 *
 * Why it matters: on a refinance SoftPro genuinely returns SalesPrice "0" and
 * Sellers: null — there is no sale and no seller — so those fields are
 * correct-empty, not missing data. Verified against production: 3,236 of 3,238
 * refis have no sales price and 451 of 453 recent ones have no seller party.
 */
export function isRefinanceTransaction(transactionType: string | null | undefined): boolean {
  return (transactionType?.toLowerCase().trim() ?? '') === 'refinance';
}

export function isPurchaseTransaction(transactionType: string | null | undefined): boolean {
  return (transactionType?.toLowerCase().trim() ?? '') === 'purchase';
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
