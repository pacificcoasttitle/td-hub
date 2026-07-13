import { db } from '@/lib/db/client';
import { contacts, companies } from '@/lib/db/schema';
import { and, eq, or, sql } from 'drizzle-orm';
import { getLookupTable, getSalesReps } from '@/lib/integrations/softpro';
import type { SoftProLookupItem } from '@/lib/integrations/softpro';
import { COMPANY_TYPE_MAP } from '@/lib/domain/contacts/company-constants';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SyncContactsPayload {
  entityType: string;
}

export interface SyncContactsResult {
  entityType: string;
  totalFetched: number;
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ lookupCode: string; error: string }>;
}

type SyncRow = SoftProLookupItem;

export const SYNC_CONTACT_ENTITY_TYPES = [
  'Order Contact - Person',
  'Title Officer',
  'Escrow Officer',
  'Sales Rep',
  'Escrow Company',
  'Lender',
  'Mortgage Broker',
  'SellingAgentBroker',
  'Underwriter',
] as const;

export type SyncContactEntityType = typeof SYNC_CONTACT_ENTITY_TYPES[number];

interface SyncContactRowsOptions {
  deactivateExistingSalesReps?: boolean;
}

function str(item: SyncRow, key: string): string | null {
  const v = item[key];
  return v && v.trim() ? v.trim() : null;
}

function emptyResult(entityType: string, error?: string): SyncContactsResult {
  return {
    entityType, totalFetched: 0, created: 0, updated: 0, skipped: 0,
    errors: error ? [{ lookupCode: '*', error }] : [],
  };
}

export function isSyncContactEntityType(entityType: string): entityType is SyncContactEntityType {
  return (SYNC_CONTACT_ENTITY_TYPES as readonly string[]).includes(entityType);
}

// ─── Sync 1: Open Contacts (userType=Order Contact - Person) ─────────────

async function syncOpenContacts(items: SyncRow[]): Promise<SyncContactsResult> {
  let created = 0, updated = 0, skipped = 0;
  const errors: SyncContactsResult['errors'] = [];

  for (const item of items) {
    const code = str(item, 'LookupCode');
    if (!code) { skipped++; continue; }
    if (!str(item, 'Email')) { skipped++; continue; }

    try {
      const [existing] = await db.select({ id: contacts.id })
        .from(contacts).where(eq(contacts.lookupCode, code)).limit(1);

      const vals = {
        lookupCode: code,
        flookupCode: str(item, 'Filter: LookupCode') ?? str(item, 'FLookupCode'),
        courtesyTitle: str(item, 'CourtesyTitle'),
        firstName: str(item, 'FirstName'),
        middleName: str(item, 'MiddleName'),
        lastName: str(item, 'LastName'),
        email: str(item, 'Email'),
        phone: str(item, 'Phone'),
        phoneExt: str(item, 'PhoneExt'),
        suffix: str(item, 'Suffix'),
        title: str(item, 'Title'),
        fax: str(item, 'Fax'),
        cell: str(item, 'Cell'),
        pager: str(item, 'Pager'),
        genderId: str(item, 'GenderID'),
        address1: str(item, 'Address1'),
        address2: str(item, 'Address2'),
        city: str(item, 'City'),
        state: str(item, 'State'),
        zip: str(item, 'Zip'),
        note: str(item, 'Note'),
        licenseNo: str(item, 'License No'),
        userType: 'open_contact' as const,
        isActive: true,
        updatedAt: new Date(),
      };

      if (existing) {
        await db.update(contacts).set(vals).where(eq(contacts.id, existing.id));
        updated++;
      } else {
        await db.insert(contacts).values({ ...vals, sourceSystem: 'softpro' });
        created++;
      }
    } catch (err) {
      errors.push({ lookupCode: code, error: err instanceof Error ? err.message : 'Unknown' });
    }
  }
  return { entityType: 'Order Contact - Person', totalFetched: items.length, created, updated, skipped, errors };
}

// ─── Sync 2: Title Officers (userType=Title Officer) ─────────────────────

async function syncTitleOfficers(items: SyncRow[]): Promise<SyncContactsResult> {
  let created = 0, updated = 0, skipped = 0;
  const errors: SyncContactsResult['errors'] = [];

  for (const item of items) {
    const examiner = str(item, 'Title officer/Examiner');
    if (!examiner) { skipped++; continue; }

    try {
      const [existing] = await db.select({ id: contacts.id })
        .from(contacts)
        .where(or(eq(contacts.closerExaminer, examiner), eq(contacts.softproLookupCode, examiner)))
        .limit(1);

      const vals = {
        closerExaminer: examiner,
        softproLookupCode: examiner,
        officeLookupCode: str(item, 'Office LookupCode'),
        lookupCode: str(item, 'Office LookupCode'),
        officerName: str(item, 'Officer Name'),
        email: str(item, 'Email'),
        isTitleOfficer: true,
        isActive: true,
        updatedAt: new Date(),
      };

      if (existing) {
        await db.update(contacts).set(vals).where(eq(contacts.id, existing.id));
        updated++;
      } else {
        await db.insert(contacts).values({
          ...vals,
          sourceSystem: 'softpro',
          fullName: str(item, 'Officer Name'),
        });
        created++;
      }
    } catch (err) {
      errors.push({ lookupCode: examiner, error: err instanceof Error ? err.message : 'Unknown' });
    }
  }
  return { entityType: 'Title Officer', totalFetched: items.length, created, updated, skipped, errors };
}

// ─── Sync 3: Escrow Officers (userType=Escrow Officer) ───────────────────

async function syncEscrowOfficers(items: SyncRow[]): Promise<SyncContactsResult> {
  let created = 0, updated = 0, skipped = 0;
  const errors: SyncContactsResult['errors'] = [];

  for (const item of items) {
    const examiner = str(item, 'Escrow officer/Closer');
    if (!examiner) { skipped++; continue; }

    try {
      // Dedupe guard: if this row is a PCT\ login-code entry and a
      // canonical (non-PCT\ source_id) contact already exists with the
      // same email, skip the insert/update entirely to avoid resurrecting
      // the duplicate-officer problem.
      const email = str(item, 'Email');
      if (examiner.startsWith('PCT\\') && email) {
        const canonical = await db.select({ id: contacts.id })
          .from(contacts)
          .where(and(
            eq(contacts.email, email),
            sql`(${contacts.sourceId} IS NOT NULL AND ${contacts.sourceId} NOT LIKE 'PCT\\%')`,
          ))
          .limit(1);

        if (canonical.length > 0) {
          skipped++;
          continue;
        }
      }

      const [existing] = await db.select({ id: contacts.id })
        .from(contacts)
        .where(or(eq(contacts.closerExaminer, examiner), eq(contacts.softproLookupCode, examiner)))
        .limit(1);

      const vals = {
        closerExaminer: examiner,
        softproLookupCode: examiner,
        officeLookupCode: str(item, 'Office LookupCode'),
        lookupCode: str(item, 'Office LookupCode'),
        officerName: str(item, 'Officer Name'),
        email,
        isEscrowOfficer: true,
        isActive: true,
        updatedAt: new Date(),
      };

      if (existing) {
        await db.update(contacts).set(vals).where(eq(contacts.id, existing.id));
        updated++;
      } else {
        await db.insert(contacts).values({
          ...vals,
          sourceSystem: 'softpro',
          fullName: str(item, 'Officer Name'),
        });
        created++;
      }
    } catch (err) {
      errors.push({ lookupCode: examiner, error: err instanceof Error ? err.message : 'Unknown' });
    }
  }
  return { entityType: 'Escrow Officer', totalFetched: items.length, created, updated, skipped, errors };
}

// ─── Sync 4: Sales Reps (DIFFERENT ENDPOINT) ────────────────────────────

async function syncSalesRepRows(
  items: SyncRow[],
  options: SyncContactRowsOptions = {}
): Promise<SyncContactsResult> {
  const entityType = 'Sales Rep';

  let created = 0, updated = 0, skipped = 0;
  const errors: SyncContactsResult['errors'] = [];

  if (options.deactivateExistingSalesReps) {
    await db.update(contacts)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(contacts.isSalesRep, true));
  }

  for (const item of items) {
    const code = str(item, 'LookUpCode') ?? str(item, 'LookupCode');
    if (!code) { skipped++; continue; }

    try {
      const [existing] = await db.select({ id: contacts.id })
        .from(contacts).where(eq(contacts.lookupCode, code)).limit(1);

      const rawFullName = str(item, 'FullName') ?? '';
      const parts = rawFullName.split(/\s*,\s*/);
      const lastName = parts[0] || null;
      const firstName = parts[1] || null;
      const rawPhone = str(item, 'Phone');
      const phone = rawPhone ? rawPhone.replace(/\D/g, '') : null;

      const vals = {
        lookupCode: code,
        fullName: rawFullName || null,
        firstName,
        lastName,
        email: str(item, 'Email'),
        phone,
        isSalesRep: true,
        isActive: true,
        updatedAt: new Date(),
      };

      if (existing) {
        await db.update(contacts).set(vals).where(eq(contacts.id, existing.id));
        updated++;
      } else {
        await db.insert(contacts).values({ ...vals, sourceSystem: 'softpro' });
        created++;
      }
    } catch (err) {
      errors.push({ lookupCode: code, error: err instanceof Error ? err.message : 'Unknown' });
    }
  }

  return { entityType, totalFetched: items.length, created, updated, skipped, errors };
}

// ─── Company sync helpers (Syncs 5-9) ────────────────────────────────────

interface CompanySyncConfig {
  entityType: string;
  userType: string;
  companyType: string;
  contactFlag?: 'isEscrow' | 'isLender' | 'isMortgageBroker' | 'isRealEstateAgent' | 'isUnderwriter';
  companyFlag: 'isEscrowCompany' | 'isLender' | 'isMortgageBroker' | 'isRealEstateCompany' | 'isUnderwriter';
  useSpacedFields: boolean;
  extraCompanyFields?: (item: SyncRow) => Record<string, string | null>;
}

const SPACED = {
  lookupCode: 'Lookup Code',
  name: 'Name',
  payeeName: 'Payee Name',
  address1: 'Address (line 1)',
  address2: 'Address (line 2)',
  city: 'City',
  state: 'State',
  zip: 'Zip',
  phone: 'Phone',
  fax: 'Fax',
  email: 'Email',
  signatureLine: 'Signature Line',
  feeTransferLedger: 'Fee Transfer Ledger',
  stateOfIncorporation: 'State Of Incorporation',
  marketingRep: 'Marketing Rep',
  specialInstructions: 'Special Instructions',
};

const CAMEL = {
  lookupCode: 'LookupCode',
  name: 'Name',
  payeeName: 'PayeeName',
  address1: 'Address1',
  address2: 'Address2',
  city: 'City',
  state: 'State',
  zip: 'Zip',
  phone: 'Phone',
  fax: 'Fax',
  email: 'Email',
  feeTransferLedger: 'FeeTransferLedger',
  stateOfIncorporation: 'StateOfIncorporation',
  marketingRep: 'MarketingRep',
  legalName: 'LegalName',
  fundingAddress1: 'FundingAddress1',
  fundingAddress2: 'FundingAddress2',
  fundingCity: 'FundingCity',
  fundingState: 'FundingState',
  fundingZip: 'FundingZip',
  fundingPhone: 'FundingPhone',
  fundingFax: 'FundingFax',
};

async function syncCompanyType(config: CompanySyncConfig, items: SyncRow[]): Promise<SyncContactsResult> {
  let created = 0, updated = 0, skipped = 0;
  const errors: SyncContactsResult['errors'] = [];
  const f = config.useSpacedFields ? SPACED : CAMEL;

  for (const item of items) {
    const code = str(item, f.lookupCode);
    if (!code) { skipped++; continue; }

    try {
      // Table 1: contacts (lightweight, match on flookup_code)
      const [existingContact] = await db.select({ id: contacts.id })
        .from(contacts).where(eq(contacts.flookupCode, code)).limit(1);

      const contactVals: Record<string, unknown> = {
        flookupCode: code,
        companyName: str(item, f.name),
        isActive: true,
        updatedAt: new Date(),
      };
      if (config.contactFlag) {
        contactVals[config.contactFlag] = true;
      }

      if (existingContact) {
        await db.update(contacts).set(contactVals).where(eq(contacts.id, existingContact.id));
      } else {
        await db.insert(contacts).values({
          ...contactVals,
          sourceSystem: 'softpro',
          type: 'company_contact' as const,
        });
      }

      // Table 2: companies (full record, match on lookup_code)
      const [existingCompany] = await db.select({ id: companies.id })
        .from(companies).where(eq(companies.lookupCode, code)).limit(1);

      const companyVals: Record<string, unknown> = {
        lookupCode: code,
        name: str(item, f.name) ?? code,
        payeeName: str(item, f.payeeName),
        companyType: config.companyType,
        address1: str(item, f.address1),
        address2: str(item, f.address2),
        city: str(item, f.city),
        state: str(item, f.state),
        zip: str(item, f.zip),
        phone: str(item, f.phone),
        fax: str(item, f.fax),
        email: str(item, f.email),
        signatureLine: config.useSpacedFields ? str(item, SPACED.signatureLine) : null,
        feeTransferLedger: str(item, f.feeTransferLedger),
        stateOfIncorporation: str(item, f.stateOfIncorporation),
        marketingRep: str(item, f.marketingRep),
        specialInstructions: config.useSpacedFields ? str(item, SPACED.specialInstructions) : null,
        [config.companyFlag]: true,
        isActive: true,
        updatedAt: new Date(),
      };

      if (!config.useSpacedFields) {
        companyVals.legalName = str(item, CAMEL.legalName);
        companyVals.fundingAddress1 = str(item, CAMEL.fundingAddress1);
        companyVals.fundingAddress2 = str(item, CAMEL.fundingAddress2);
        companyVals.fundingCity = str(item, CAMEL.fundingCity);
        companyVals.fundingState = str(item, CAMEL.fundingState);
        companyVals.fundingZip = str(item, CAMEL.fundingZip);
        companyVals.fundingPhone = str(item, CAMEL.fundingPhone);
        companyVals.fundingFax = str(item, CAMEL.fundingFax);
      }

      if (config.extraCompanyFields) {
        Object.assign(companyVals, config.extraCompanyFields(item));
      }

      if (existingCompany) {
        await db.update(companies).set(companyVals).where(eq(companies.id, existingCompany.id));
        updated++;
      } else {
        await db.insert(companies).values({ ...companyVals, sourceSystem: 'softpro', name: (companyVals.name as string) ?? code });
        created++;
      }
    } catch (err) {
      errors.push({ lookupCode: code, error: err instanceof Error ? err.message : 'Unknown' });
    }
  }

  return { entityType: config.entityType, totalFetched: items.length, created, updated, skipped, errors };
}

/** Flag contacts assigned on any order as escrow officers (covers external SoftPro persons). Idempotent. */
async function reconcileEscrowOfficerFlagsFromOrders(): Promise<void> {
  await db.execute(sql`
    UPDATE contacts AS c
    SET is_escrow_officer = true
    WHERE EXISTS (
      SELECT 1 FROM orders AS o
      WHERE o.escrow_officer_id = c.id
    )
      AND c.is_escrow_officer = false
  `);
}

// ─── Sync configs ────────────────────────────────────────────────────────

const COMPANY_CONFIGS: Record<string, CompanySyncConfig> = {
  'Escrow Company': {
    entityType: 'Escrow Company',
    userType: 'Escrow Company',
    companyType: 'escrow_company',
    contactFlag: 'isEscrow',
    companyFlag: 'isEscrowCompany',
    useSpacedFields: true,
  },
  'Lender': {
    entityType: 'Lender',
    userType: 'Lender',
    companyType: 'lender',
    contactFlag: 'isLender',
    companyFlag: 'isLender',
    useSpacedFields: false,
  },
  'Mortgage Broker': {
    entityType: 'Mortgage Broker',
    userType: 'Mortgage Broker',
    companyType: 'mortgage_broker',
    contactFlag: 'isMortgageBroker',
    companyFlag: 'isMortgageBroker',
    useSpacedFields: true,
  },
  'SellingAgentBroker': {
    entityType: 'SellingAgentBroker',
    userType: COMPANY_TYPE_MAP.real_estate_company,
    companyType: 'real_estate_company',
    contactFlag: 'isRealEstateAgent',
    companyFlag: 'isRealEstateCompany',
    useSpacedFields: true,
  },
  'Underwriter': {
    entityType: 'Underwriter',
    userType: 'Underwriter',
    companyType: 'underwriter',
    contactFlag: 'isUnderwriter',
    companyFlag: 'isUnderwriter',
    useSpacedFields: true,
  },
};

// ─── Main Handler ────────────────────────────────────────────────────────

export async function fetchSyncContactRows(
  entityType: SyncContactEntityType
): Promise<{ items: SyncRow[]; error: string | null }> {
  if (entityType === 'Sales Rep') {
    try {
      const result = await getSalesReps();
      if (!result.success || !result.data) {
        return { items: [], error: result.error?.message ?? 'GetOrderMarketingRep returned no data' };
      }
      return { items: result.data, error: null };
    } catch (err) {
      return {
        items: [],
        error: `GetOrderMarketingRep failed: ${err instanceof Error ? err.message : 'timeout/hang'}`,
      };
    }
  }

  const adapterResult = await getLookupTable(COMPANY_CONFIGS[entityType]?.userType ?? entityType);
  if (!adapterResult.success || !adapterResult.data) {
    return { items: [], error: adapterResult.error?.message ?? 'Failed to fetch lookup table' };
  }

  return { items: adapterResult.data, error: null };
}

export function getSyncContactLookupCode(
  entityType: SyncContactEntityType,
  item: SyncRow
): string | null {
  switch (entityType) {
    case 'Order Contact - Person':
      return str(item, 'LookupCode');
    case 'Title Officer':
      return str(item, 'Title officer/Examiner');
    case 'Escrow Officer':
      return str(item, 'Escrow officer/Closer');
    case 'Sales Rep':
      return str(item, 'LookUpCode') ?? str(item, 'LookupCode');
    case 'Escrow Company':
    case 'SellingAgentBroker':
    case 'Mortgage Broker':
    case 'Underwriter':
      return str(item, CAMEL.lookupCode) ?? str(item, SPACED.lookupCode);
    case 'Lender':
      return str(item, CAMEL.lookupCode);
  }
}

export function sortSyncContactRows(
  entityType: SyncContactEntityType,
  items: SyncRow[]
): SyncRow[] {
  return [...items].sort((a, b) => {
    const aCode = getSyncContactLookupCode(entityType, a) ?? '';
    const bCode = getSyncContactLookupCode(entityType, b) ?? '';
    return aCode.localeCompare(bCode);
  });
}

export async function syncContactRows(
  entityType: SyncContactEntityType,
  items: SyncRow[],
  options: SyncContactRowsOptions = {}
): Promise<SyncContactsResult> {
  switch (entityType) {
    case 'Order Contact - Person':
      return syncOpenContacts(items);
    case 'Title Officer':
      return syncTitleOfficers(items);
    case 'Escrow Officer':
      return syncEscrowOfficers(items);
    case 'Sales Rep':
      return syncSalesRepRows(items, options);
    default: {
      const config = COMPANY_CONFIGS[entityType];
      if (config) {
        return syncCompanyType(config, items);
      }
      return emptyResult(entityType, `No handler for: ${entityType}`);
    }
  }
}

export async function handleSyncContacts(
  payload: SyncContactsPayload
): Promise<SyncContactsResult> {
  const { entityType } = payload;

  if (!isSyncContactEntityType(entityType)) {
    return emptyResult(entityType, `Invalid entity type: ${entityType}`);
  }

  const fetched = await fetchSyncContactRows(entityType);
  if (fetched.error) {
    return emptyResult(entityType, fetched.error);
  }

  const result = await syncContactRows(entityType, fetched.items, {
    deactivateExistingSalesReps: entityType === 'Sales Rep',
  });

  await reconcileEscrowOfficerFlagsFromOrders();
  return result;
}
