/**
 * The `userType` values SoftPro's lookup table accepts.
 *
 * MEASURED, not assumed — from every `get_lookup_table` call on record:
 *
 *   Escrow Officer          158 ok      Order Contact - Person   99 ok
 *   Title Officer           156 ok      Sales Representative     67 ok
 *   Escrow Company           18 ok      Mortgage Broker          14 ok
 *   Lender                   14 ok      Underwriter              12 ok
 *   Selling Agent/Broker      7 ok      Title Company             4 ok
 *
 * And the spellings SoftPro rejects outright — 100% failure, every call:
 *
 *   TitleCompany  TitleCompanies  Title Companies
 *   SellingAgentBroker  Selling Agent Broker  EscrowCompany  Branch
 *
 * Those 15 calls came from two exploration sessions (2026-07-14 and
 * 2026-08-25) through `/api/softpro/lookup`, which took `userType` as an
 * unvalidated string straight from a query parameter. No scheduled job has
 * ever sent one — `sync-contacts` translates `SellingAgentBroker` through
 * `COMPANY_CONFIGS` before sending, and `sync-new-users` only ever sends three
 * valid values. So this guard prevents a recurrence rather than fixing a live
 * defect.
 */
export const SOFTPRO_LOOKUP_USER_TYPES = [
  'Order Contact - Person',
  'Listing Agent/Broker',
  'Selling Agent/Broker',
  'Escrow Officer',
  'Title Officer',
  'Sales Representative',
  'Escrow Company',
  'Title Company',
  'Mortgage Broker',
  'Lender',
  'Underwriter',
] as const;

export type SoftProLookupUserType = typeof SOFTPRO_LOOKUP_USER_TYPES[number];

/** Concatenated spellings seen in the wild, mapped to what SoftPro accepts. */
const ALIASES: Record<string, SoftProLookupUserType> = {
  titlecompany: 'Title Company',
  titlecompanies: 'Title Company',
  sellingagentbroker: 'Selling Agent/Broker',
  sellingagentbrokers: 'Selling Agent/Broker',
  listingagentbroker: 'Listing Agent/Broker',
  escrowcompany: 'Escrow Company',
  mortgagebroker: 'Mortgage Broker',
  escrowofficer: 'Escrow Officer',
  titleofficer: 'Title Officer',
  salesrep: 'Sales Representative',
  salesrepresentative: 'Sales Representative',
  ordercontactperson: 'Order Contact - Person',
};

/**
 * The accepted spelling for a caller-supplied type, or null if there isn't one.
 *
 * Null means "do not call SoftPro" — a request it will reject is not worth a
 * round trip, and the caller can say which values are valid instead of relaying
 * a vendor error that names none of them.
 */
export function resolveLookupUserType(raw: string | null | undefined): SoftProLookupUserType | null {
  const v = (raw ?? '').trim();
  if (!v) return null;
  const exact = SOFTPRO_LOOKUP_USER_TYPES.find((t) => t.toLowerCase() === v.toLowerCase());
  if (exact) return exact;
  return ALIASES[v.toLowerCase().replace(/[^a-z]/g, '')] ?? null;
}
