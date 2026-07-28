/**
 * Confident SiteX match for OC-1 pre-init trigger.
 * Requires APN + county + legal — the fields Tax/LV CreateService need.
 */
export function isConfidentSiteXMatch(property: {
  apn?: string | null;
  county?: string | null;
  legalDescription?: string | null;
}): boolean {
  return !!(
    property.apn?.trim()
    && property.county?.trim()
    && property.legalDescription?.trim()
  );
}
