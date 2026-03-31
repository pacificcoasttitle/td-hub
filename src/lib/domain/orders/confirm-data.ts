import { db } from '@/lib/db/client';
import {
  orders, orderProperties, orderParties, contacts, profiles,
  titlePointData, documents,
} from '@/lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { getSignedUrl } from '@/lib/integrations/s3/client';

const salesRepContact = alias(contacts, 'sales_rep');
const titleOfficerContact = alias(contacts, 'title_officer');

function contactName(c: { fullName: string | null; officerName: string | null; firstName: string | null; lastName: string | null } | null): string | null {
  if (!c) return null;
  if (c.fullName) return c.fullName;
  if (c.officerName) return c.officerName;
  return [c.firstName, c.lastName].filter(Boolean).join(' ') || null;
}

export async function loadConfirmationData(fileNumber: string) {
  const [row] = await db
    .select({
      id: orders.id,
      fileNumber: orders.fileNumber,
      status: orders.operationalStatus,
      createdAt: orders.createdAt,
      productType: orders.productType,
      transactionType: orders.transactionType,
      salesPrice: orders.salesPrice,
      loanAmount: orders.loanAmount,
      createdBy: orders.createdBy,
      propAddress: orderProperties.address,
      propCity: orderProperties.city,
      propState: orderProperties.state,
      propZip: orderProperties.zip,
      propCounty: orderProperties.county,
      propApn: orderProperties.apn,
      propLegal: orderProperties.legalDescription,
      propPrimaryOwner: orderProperties.primaryOwner,
      propSecondaryOwner: orderProperties.secondaryOwner,
      srName: salesRepContact.fullName,
      srFirst: salesRepContact.firstName,
      srLast: salesRepContact.lastName,
      srOfficer: salesRepContact.officerName,
      toName: titleOfficerContact.fullName,
      toFirst: titleOfficerContact.firstName,
      toLast: titleOfficerContact.lastName,
      toOfficer: titleOfficerContact.officerName,
    })
    .from(orders)
    .leftJoin(orderProperties, eq(orders.id, orderProperties.orderId))
    .leftJoin(salesRepContact, eq(orders.salesRepId, salesRepContact.id))
    .leftJoin(titleOfficerContact, eq(orders.titleOfficerId, titleOfficerContact.id))
    .where(eq(orders.fileNumber, fileNumber))
    .limit(1);

  if (!row) return null;

  const opener = await loadOpener(row.createdBy);
  const parties = await loadParties(row.id);
  const docUrls = await loadDocumentUrls(row.id);
  const tpData = await loadTitlePointData(row.id, docUrls);

  return {
    order: {
      fileNumber: row.fileNumber,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      productType: row.productType,
      transactionType: row.transactionType,
      salesPrice: row.salesPrice,
      loanAmount: row.loanAmount,
      loanNumber: null,
      escrowNumber: null,
    },
    opener,
    property: {
      address: row.propAddress,
      city: row.propCity,
      state: row.propState,
      zip: row.propZip,
      county: row.propCounty,
      apn: row.propApn,
      legalDescription: row.propLegal,
    },
    titlePoint: tpData,
    seller: {
      primaryOwner: row.propPrimaryOwner ?? null,
      secondaryOwner: row.propSecondaryOwner ?? null,
    },
    transaction: {
      salesRep: contactName({ fullName: row.srName, officerName: row.srOfficer, firstName: row.srFirst, lastName: row.srLast }),
      titleOfficer: contactName({ fullName: row.toName, officerName: row.toOfficer, firstName: row.toFirst, lastName: row.toLast }),
    },
    parties: {
      buyerAgent: parties.find((p) => p.role === 'buyer_agent')?.data ?? null,
      listingAgent: parties.find((p) => p.role === 'listing_agent')?.data ?? null,
      lender: parties.find((p) => p.role === 'lender')?.data ?? null,
      escrow: parties.find((p) => p.role === 'escrow_company')?.data ?? null,
    },
  };
}

async function loadOpener(createdBy: string | null) {
  if (!createdBy) return null;
  const [p] = await db.select({ name: profiles.displayName, email: profiles.email })
    .from(profiles).where(eq(profiles.id, createdBy)).limit(1);
  return p ? { name: p.name, email: p.email, phone: null, company: null } : null;
}

async function loadParties(orderId: number) {
  const rows = await db.select({
    role: orderParties.role,
    externalName: orderParties.externalName,
    externalEmail: orderParties.externalEmail,
    externalPhone: orderParties.externalPhone,
    externalCompany: orderParties.externalCompany,
    cName: contacts.fullName,
    cEmail: contacts.email,
    cPhone: contacts.phone,
    cCompany: contacts.companyName,
  })
    .from(orderParties)
    .leftJoin(contacts, eq(orderParties.contactId, contacts.id))
    .where(eq(orderParties.orderId, orderId));

  return rows.map((r) => ({
    role: r.role,
    data: {
      name: r.cName ?? r.externalName ?? null,
      email: r.cEmail ?? r.externalEmail ?? null,
      phone: r.cPhone ?? r.externalPhone ?? null,
      company: r.cCompany ?? r.externalCompany ?? null,
    },
  }));
}

async function loadTitlePointData(
  orderId: number,
  docUrls: Record<string, string | null>,
) {
  const tpRows = await db.select({
    searchType: titlePointData.searchType,
    status: titlePointData.status,
    metadata: titlePointData.metadata,
    createdAt: titlePointData.createdAt,
  })
    .from(titlePointData)
    .where(eq(titlePointData.orderId, orderId));

  const latestByType = new Map<string, (typeof tpRows)[number]>();
  for (const row of tpRows) {
    if (!row.searchType) continue;

    const current = latestByType.get(row.searchType);
    if (!current) {
      latestByType.set(row.searchType, row);
      continue;
    }

    const rowCompleted = row.status === 'completed';
    const currentCompleted = current.status === 'completed';
    if (rowCompleted && !currentCompleted) {
      latestByType.set(row.searchType, row);
      continue;
    }
    if (rowCompleted === currentCompleted && row.createdAt > current.createdAt) {
      latestByType.set(row.searchType, row);
    }
  }

  const lvRow = latestByType.get('legal_vesting');
  const taxRow = latestByType.get('tax');
  const gdRow = latestByType.get('grant_deed');

  const lvMeta = (lvRow?.metadata as Record<string, unknown>) ?? {};
  const lvResult = (lvMeta.resultData as Record<string, unknown>) ?? {};
  const taxMeta = (taxRow?.metadata as Record<string, unknown>) ?? {};
  const taxResult = (taxMeta.resultData as Record<string, unknown>) ?? {};
  const taxReport = extractObject(taxResult, 'TaxReport', 'taxReport') ?? taxResult;

  return {
    legalDescription: extractString(lvResult, 'LegalDescription', 'legalDescription', 'BriefLegal', 'briefLegal') ?? null,
    vestingInformation: extractString(lvResult, 'VestingInformation', 'vestingInformation', 'Vesting') ?? null,
    taxRateArea: extractString(taxReport, 'TaxRateArea', 'taxRateArea') ?? null,
    useCode: extractString(taxReport, 'UseCode', 'useCode') ?? null,
    landValue: extractString(taxReport, 'LandValue', 'landValue', 'LandValuation', 'landValuation') ?? null,
    improvementsValue: extractString(taxReport, 'ImprovementsValue', 'improvementsValue', 'ImprovementsValuation', 'improvementsValuation') ?? null,
    taxRate: extractString(taxReport, 'TaxRate', 'taxRate') ?? null,
    issueDate: extractString(taxReport, 'IssueDate', 'issueDate') ?? null,
    firstInstallment: pickInstallment(taxReport, '1st') ?? extractObject(taxReport, 'FirstInstallment', 'firstInstallment') ?? null,
    secondInstallment: pickInstallment(taxReport, '2nd') ?? extractObject(taxReport, 'SecondInstallment', 'secondInstallment') ?? null,
    documents: {
      lv: { status: lvRow?.status ?? 'not_started', s3Url: docUrls.legal_vesting ?? null },
      grantDeed: { status: gdRow?.status ?? 'not_started', s3Url: docUrls.grant_deed ?? null },
      tax: { status: taxRow?.status ?? 'not_started', s3Url: docUrls.tax ?? null },
    },
  };
}

async function loadDocumentUrls(orderId: number) {
  const cats = ['legal_vesting', 'tax', 'grant_deed'] as const;
  const docRows = await db.select({
    category: documents.category,
    storageKey: documents.storageKey,
  })
    .from(documents)
    .where(and(
      eq(documents.orderId, orderId),
      inArray(documents.category, [...cats]),
      eq(documents.status, 'active'),
    ));

  const urls: Record<string, string | null> = { legal_vesting: null, tax: null, grant_deed: null };
  for (const doc of docRows) {
    try {
      const result = await getSignedUrl(doc.storageKey, 3600);
      if (result.success && result.data) urls[doc.category] = result.data;
    } catch { /* signed URL failure returns null */ }
  }
  return urls;
}

function extractString(obj: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const val = obj[k];
    if (typeof val === 'string' && val.trim()) return val.trim();
  }
  return null;
}

function extractObject(obj: Record<string, unknown>, ...keys: string[]): Record<string, unknown> | null {
  for (const k of keys) {
    const val = obj[k];
    if (val && typeof val === 'object' && !Array.isArray(val)) return val as Record<string, unknown>;
  }
  return null;
}

function pickInstallment(
  taxReport: Record<string, unknown>,
  ordinal: '1st' | '2nd',
): Record<string, unknown> | null {
  const installments = extractObject(taxReport, 'Installments', 'installments');
  if (!installments) return null;

  const rawItems = installments.Item ?? installments.items;
  const items = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];
  const match = items.find((item) => {
    if (!item || typeof item !== 'object') return false;
    const number = extractString(item as Record<string, unknown>, 'Number', 'number');
    return number === ordinal;
  });

  return match && typeof match === 'object' && !Array.isArray(match)
    ? (match as Record<string, unknown>)
    : null;
}
