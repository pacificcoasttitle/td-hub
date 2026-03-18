import { db } from '@/lib/db/client';
import { contacts, companies } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { getLookupTable, getSalesReps } from '@/lib/integrations/softpro';
import type { SoftProLookupItem } from '@/lib/integrations/softpro';

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
        .from(contacts).where(eq(contacts.closerExaminer, examiner)).limit(1);

      const vals = {
        closerExaminer: examiner,
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
      const [existing] = await db.select({ id: contacts.id })
        .from(contacts).where(eq(contacts.closerExaminer, examiner)).limit(1);

      const vals = {
        closerExaminer: examiner,
        officeLookupCode: str(item, 'Office LookupCode'),
        lookupCode: str(item, 'Office LookupCode'),
        officerName: str(item, 'Officer Name'),
        email: str(item, 'Email'),
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

async function syncSalesReps(): Promise<SyncContactsResult> {
  const entityType = 'Sales Rep';

  let result;
  try {
    result = await getSalesReps();
  } catch (err) {
    return emptyResult(entityType, `GetOrderMarketingRep failed: ${err instanceof Error ? err.message : 'timeout/hang'}`);
  }

  if (!result.success || !result.data) {
    return emptyResult(entityType, result.error?.message ?? 'GetOrderMarketingRep returned no data');
  }

  const items = result.data;
  let created = 0, updated = 0, skipped = 0;
  const errors: SyncContactsResult['errors'] = [];

  await db.update(contacts)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(contacts.isSalesRep, true));

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
  contactFlag: 'isEscrow' | 'isLender' | 'isMortgageBroker' | 'isSellingAgent' | 'isUnderwriter';
  companyFlag: 'isEscrowCompany' | 'isLender' | 'isMortgageBroker' | 'isSellingAgent' | 'isUnderwriter';
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

      const contactVals = {
        flookupCode: code,
        companyName: str(item, f.name),
        [config.contactFlag]: true,
        isActive: true,
        updatedAt: new Date(),
      };

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

// ─── Sync configs ────────────────────────────────────────────────────────

const COMPANY_CONFIGS: Record<string, CompanySyncConfig> = {
  'Escrow Company': {
    entityType: 'Escrow Company',
    userType: 'Escrow Company',
    contactFlag: 'isEscrow',
    companyFlag: 'isEscrowCompany',
    useSpacedFields: true,
  },
  'Lender': {
    entityType: 'Lender',
    userType: 'Lender',
    contactFlag: 'isLender',
    companyFlag: 'isLender',
    useSpacedFields: false,
  },
  'Mortgage Broker': {
    entityType: 'Mortgage Broker',
    userType: 'Mortgage Broker',
    contactFlag: 'isMortgageBroker',
    companyFlag: 'isMortgageBroker',
    useSpacedFields: true,
  },
  'Selling Agent/Broker': {
    entityType: 'Selling Agent/Broker',
    userType: 'Selling Agent/Broker',
    contactFlag: 'isSellingAgent',
    companyFlag: 'isSellingAgent',
    useSpacedFields: true,
    extraCompanyFields: (item) => ({
      homePhone: str(item, 'Home Phone'),
      represents: str(item, 'Represents'),
      licenseNo: str(item, 'License No'),
    }),
  },
  'Underwriter': {
    entityType: 'Underwriter',
    userType: 'Underwriter',
    contactFlag: 'isUnderwriter',
    companyFlag: 'isUnderwriter',
    useSpacedFields: true,
  },
};

// ─── Main Handler ────────────────────────────────────────────────────────

const VALID_ENTITY_TYPES = [
  'Order Contact - Person',
  'Title Officer',
  'Escrow Officer',
  'Sales Rep',
  'Escrow Company',
  'Lender',
  'Mortgage Broker',
  'Selling Agent/Broker',
  'Underwriter',
];

export async function handleSyncContacts(
  payload: SyncContactsPayload
): Promise<SyncContactsResult> {
  const { entityType } = payload;

  if (!VALID_ENTITY_TYPES.includes(entityType)) {
    return emptyResult(entityType, `Invalid entity type: ${entityType}`);
  }

  if (entityType === 'Sales Rep') {
    return syncSalesReps();
  }

  const userType = entityType;
  const adapterResult = await getLookupTable(userType);

  if (!adapterResult.success || !adapterResult.data) {
    return emptyResult(entityType, adapterResult.error?.message ?? 'Failed to fetch lookup table');
  }

  const items = adapterResult.data;

  switch (entityType) {
    case 'Order Contact - Person':
      return syncOpenContacts(items);
    case 'Title Officer':
      return syncTitleOfficers(items);
    case 'Escrow Officer':
      return syncEscrowOfficers(items);
    default: {
      const config = COMPANY_CONFIGS[entityType];
      if (config) return syncCompanyType(config, items);
      return emptyResult(entityType, `No handler for: ${entityType}`);
    }
  }
}
