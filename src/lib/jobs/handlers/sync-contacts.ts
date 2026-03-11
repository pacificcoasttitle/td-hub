import { getLookupTable, mapLookupTableEntry } from '@/lib/integrations/softpro';
import type { SoftProLookupItem } from '@/lib/integrations/softpro';
import {
  upsertContactFromSoftPro,
  upsertCompanyFromSoftPro,
} from '@/lib/domain/contacts/service';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SyncContactsPayload {
  entityType: string;
}

export interface SyncContactsResult {
  entityType: string;
  totalFetched: number;
  created: number;
  updated: number;
  errors: Array<{ lookupCode: string; error: string }>;
}

// ─── Entity Type → Role Mapping ──────────────────────────────────────────────

const ENTITY_TYPE_ROLES: Record<string, string[]> = {
  'Order Contact - Person': ['contact'],
  'Escrow Officer': ['escrow_officer'],
  'Lender': ['lender'],
  'Mortgage Broker': ['mortgage_broker'],
  'Selling Agent/Broker': ['agent'],
  'Title Officer': ['title_officer'],
  'Sales Rep': ['sales_rep'],
};

const COMPANY_ENTITY_TYPES: Record<string, string> = {
  'Escrow Company': 'escrow_company',
  'Underwriter': 'underwriter',
};

const VALID_ENTITY_TYPES = [...Object.keys(ENTITY_TYPE_ROLES), ...Object.keys(COMPANY_ENTITY_TYPES)];

// GetOrderMarketingRep hangs in production — skip Sales Rep sync for now
const SKIP_ENTITY_TYPES = new Set(['Sales Rep']);

function isCompanyType(entityType: string): boolean {
  return entityType in COMPANY_ENTITY_TYPES;
}

// ─── Field extraction from dynamic lookup items ─────────────────────────────
// Real API field names have spaces and slashes. We try known field names
// first, then fall back to legacy camelCase names for forward compatibility.

function extractLookupCode(item: SoftProLookupItem): string {
  return (
    item['Title officer/Examiner'] ??
    item['LookupCode'] ??
    item['CompanyLookUpCode'] ??
    item['PersonLookupCode'] ??
    Object.values(item)[0] ??
    'unknown'
  );
}

function mapToContactUpsert(item: SoftProLookupItem, roles: string[]) {
  const mapped = mapLookupTableEntry(item);
  const lookupCode = extractLookupCode(item);

  return {
    softproLookupCode: lookupCode,
    softproFlookupCode: null,
    softproUserType: roles[0] ?? '',
    firstName: null,
    lastName: null,
    fullName: mapped.officerName ?? item['FullName'] ?? null,
    companyName: null,
    officerName: mapped.officerName ?? item['OfficerName'] ?? null,
    email: mapped.email ?? item['Email'] ?? null,
    phone: item['Phone'] ?? null,
    cell: item['Cell'] ?? null,
    fax: item['Fax'] ?? null,
    address1: item['Address1'] ?? null,
    address2: item['Address2'] ?? null,
    city: item['City'] ?? null,
    state: item['State'] ?? null,
    zip: item['Zip'] ?? null,
    assignmentClause: item['AssignmentClause'] ?? null,
    licenseNo: item['LicenseNo'] ?? null,
    roles,
  };
}

function mapToCompanyUpsert(item: SoftProLookupItem, companyType: string) {
  const lookupCode = extractLookupCode(item);

  return {
    lookupCode,
    name: item['CompanyName'] ?? item['Officer Name'] ?? item['FullName'] ?? lookupCode,
    companyType,
    email: item['Email'] ?? null,
    phone: item['Phone'] ?? null,
    fax: item['Fax'] ?? null,
    address1: item['Address1'] ?? null,
    address2: item['Address2'] ?? null,
    city: item['City'] ?? null,
    state: item['State'] ?? null,
    zip: item['Zip'] ?? null,
    assignmentClause: item['AssignmentClause'] ?? null,
  };
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export async function handleSyncContacts(
  payload: SyncContactsPayload
): Promise<SyncContactsResult> {
  const { entityType } = payload;

  if (!VALID_ENTITY_TYPES.includes(entityType)) {
    return {
      entityType,
      totalFetched: 0,
      created: 0,
      updated: 0,
      errors: [{ lookupCode: '*', error: `Invalid entity type: ${entityType}` }],
    };
  }

  if (SKIP_ENTITY_TYPES.has(entityType)) {
    return {
      entityType,
      totalFetched: 0,
      created: 0,
      updated: 0,
      errors: [{ lookupCode: '*', error: `Sync for ${entityType} is temporarily disabled (API hangs)` }],
    };
  }

  const adapterResult = await getLookupTable(entityType);

  if (!adapterResult.success || !adapterResult.data) {
    return {
      entityType,
      totalFetched: 0,
      created: 0,
      updated: 0,
      errors: [{
        lookupCode: '*',
        error: adapterResult.error?.message ?? 'Failed to fetch lookup table from SoftPro',
      }],
    };
  }

  const items = adapterResult.data;
  let created = 0;
  let updated = 0;
  const errors: Array<{ lookupCode: string; error: string }> = [];

  for (const item of items) {
    const lookupCode = extractLookupCode(item);
    try {
      if (isCompanyType(entityType)) {
        const companyType = COMPANY_ENTITY_TYPES[entityType]!;
        const result = await upsertCompanyFromSoftPro(mapToCompanyUpsert(item, companyType));
        if (result.created) created++;
        else updated++;
      } else {
        const roles = ENTITY_TYPE_ROLES[entityType] ?? [];
        const result = await upsertContactFromSoftPro(mapToContactUpsert(item, roles));
        if (result.created) created++;
        else updated++;
      }
    } catch (err) {
      errors.push({
        lookupCode,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  return { entityType, totalFetched: items.length, created, updated, errors };
}
