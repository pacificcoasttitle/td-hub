import { getLookupTable } from '@/lib/integrations/softpro';
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

function isCompanyType(entityType: string): boolean {
  return entityType in COMPANY_ENTITY_TYPES;
}

// ─── Mappers ─────────────────────────────────────────────────────────────────

function mapToContactUpsert(item: SoftProLookupItem, roles: string[]) {
  return {
    softproLookupCode: item.LookupCode,
    softproFlookupCode: item.FlookupCode,
    softproUserType: item.UserType ?? '',
    firstName: item.FirstName,
    lastName: item.LastName,
    fullName: item.FullName,
    companyName: item.CompanyName,
    officerName: item.OfficerName,
    email: item.Email,
    phone: item.Phone,
    cell: item.Cell,
    fax: item.Fax,
    address1: item.Address1,
    address2: item.Address2,
    city: item.City,
    state: item.State,
    zip: item.Zip,
    assignmentClause: item.AssignmentClause,
    licenseNo: item.LicenseNo,
    roles,
  };
}

function mapToCompanyUpsert(item: SoftProLookupItem, companyType: string) {
  return {
    lookupCode: item.LookupCode,
    name: item.CompanyName ?? item.FullName ?? item.LookupCode,
    companyType,
    email: item.Email,
    phone: item.Phone,
    fax: item.Fax,
    address1: item.Address1,
    address2: item.Address2,
    city: item.City,
    state: item.State,
    zip: item.Zip,
    assignmentClause: item.AssignmentClause,
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
        lookupCode: item.LookupCode,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  return { entityType, totalFetched: items.length, created, updated, errors };
}
