import { getOrderDetails } from '@/lib/integrations/softpro';
import type { SoftProOrderDetailItem } from '@/lib/integrations/softpro/types';

/**
 * Shared operator contract for "SoftPro created the file, hub does not have a
 * proper create row."
 *
 * Two entry points, one treatment:
 *   1. SoftPro returned 200 (varchar / hub-insert fail) — we already have the
 *      file number. Do not create again. Persist the hub row if we can; if we
 *      cannot, tell the operator the file number and lock Create.
 *   2. SoftPro create aborted (timeout) — we do not know if the file exists.
 *      Ask SoftPro via GetOrderDetails (address is on that payload; GetOrders
 *      only returns number/status/dates) before any operator message.
 *
 * Copy is Gerard's, 2026-09-01.
 */
export function softProCreatedDoNotReenter(fileNumber: string): string {
  return `SoftPro created this file: ${fileNumber}. Do not re-enter. Repair it.`;
}

export const ORDER_NOT_CREATED_SAFE_TO_RETRY = 'The order was not created. Safe to try again.';

export const CREATE_TIMEOUT_LOOKUP_FAILED =
  'The create timed out and SoftPro could not be queried. Do not re-enter until this address is checked.';

export type FoundCreatedFile = { kind: 'found'; fileNumber: string };
export type NotFoundCreatedFile = { kind: 'not_found' };
export type LookupFailedCreatedFile = { kind: 'lookup_failed' };
export type CreatedFileLookup = FoundCreatedFile | NotFoundCreatedFile | LookupFailedCreatedFile;

export function normalizeAddressKey(raw: string | null | undefined): string {
  return (raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function addressesMatch(
  vendor: { Address?: string | null; City?: string | null },
  input: { address: string; city?: string },
): boolean {
  const vendorStreet = normalizeAddressKey(vendor.Address);
  const inputStreet = normalizeAddressKey(input.address);
  if (!vendorStreet || !inputStreet) return false;
  const streetHit = vendorStreet.includes(inputStreet) || inputStreet.includes(vendorStreet);
  if (!streetHit) return false;
  const inputCity = normalizeAddressKey(input.city);
  const vendorCity = normalizeAddressKey(vendor.City);
  if (!inputCity || !vendorCity) return true;
  return vendorCity === inputCity;
}

function pacificDateMdY(d: Date, dayOffset: number): string {
  const shifted = new Date(d.getTime() + dayOffset * 86_400_000);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(shifted);
  const month = parts.find((p) => p.type === 'month')?.value ?? '01';
  const day = parts.find((p) => p.type === 'day')?.value ?? '01';
  const year = parts.find((p) => p.type === 'year')?.value ?? '1970';
  return `${month}-${day}-${year}`;
}

function newestDetail(rows: SoftProOrderDetailItem[]): SoftProOrderDetailItem | undefined {
  return [...rows].sort((a, b) => {
    const at = Date.parse(a.ReceivedDate || a.ModifiedDate || '') || 0;
    const bt = Date.parse(b.ReceivedDate || b.ModifiedDate || '') || 0;
    return bt - at;
  })[0];
}

/**
 * Ask SoftPro whether a just-attempted create landed. GetOrderDetails is the
 * same read enrich/verify already use — there is no GetOrders-by-address API.
 */
export async function findCreatedSoftProFile(input: {
  address: string;
  city?: string;
  now?: Date;
}): Promise<CreatedFileLookup> {
  const now = input.now ?? new Date();
  const dateFrom = pacificDateMdY(now, -1);
  const dateTo = pacificDateMdY(now, 0);

  const result = await getOrderDetails({ dateFrom, dateTo });
  if (!result.success || !result.data) return { kind: 'lookup_failed' };

  const matches = result.data.filter((row) => addressesMatch(row, input) && row.OrderNumber);
  if (matches.length === 0) return { kind: 'not_found' };

  const chosen = newestDetail(matches);
  if (!chosen?.OrderNumber) return { kind: 'not_found' };
  return { kind: 'found', fileNumber: chosen.OrderNumber };
}
