/**
 * Map client open-order wizard payload → createAndSendToSoftPro input.
 * Preserves OC-1 fields: titlePointSessionId + siteXSnapshot.
 */

const ORDER_TYPE_MAP: Record<string, string> = {
  title_only: 'Title only',
  title_escrow: 'Title & Escrow',
  escrow_only: 'Escrow only',
  'Title only': 'Title only',
  'Title & Escrow': 'Title & Escrow',
  'Escrow only': 'Escrow only',
  'Sub Escrow': 'Sub Escrow',
  'Title Search': 'Title Search',
};

function num(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v !== 'string') return 0;
  const n = parseFloat(v.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function person(p: unknown): { firstName: string; middleName?: string; lastName: string } {
  const o = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>;
  return {
    firstName: typeof o.firstName === 'string' && o.firstName.trim() ? o.firstName : 'TBD',
    middleName: typeof o.middleName === 'string' && o.middleName.trim() ? o.middleName : undefined,
    lastName: typeof o.lastName === 'string' && o.lastName.trim() ? o.lastName : 'TBD',
  };
}

function partyContact(c: unknown): { name?: string; email?: string; phone?: string; companyName?: string } | undefined {
  if (!c || typeof c !== 'object') return undefined;
  const o = c as Record<string, unknown>;
  const name = typeof o.name === 'string' ? o.name : '';
  const company = typeof o.company === 'string' ? o.company : (typeof o.companyName === 'string' ? o.companyName : '');
  if (!name && !company) return undefined;
  return {
    name: name || undefined,
    email: typeof o.email === 'string' && o.email ? o.email : undefined,
    phone: typeof o.phone === 'string' && o.phone ? o.phone : undefined,
    companyName: company || undefined,
  };
}

/** True when payload already looks like create-order input (Hub shape). */
export function isCreateOrderShaped(raw: Record<string, unknown>): boolean {
  const property = raw.property;
  return !!property && typeof property === 'object' && typeof (property as { address?: unknown }).address === 'string';
}

/**
 * Normalize client wizard (or already-shaped) body for createAndSendToSoftPro.
 * Always forwards titlePointSessionId + siteXSnapshot when present.
 */
export function normalizeClientCreateBody(raw: Record<string, unknown>): Record<string, unknown> {
  const titlePointSessionId = typeof raw.titlePointSessionId === 'string' && raw.titlePointSessionId.trim()
    ? raw.titlePointSessionId.trim()
    : undefined;
  const siteXSnapshot = raw.siteXSnapshot && typeof raw.siteXSnapshot === 'object'
    ? raw.siteXSnapshot
    : undefined;

  if (isCreateOrderShaped(raw)) {
    return {
      ...raw,
      ...(titlePointSessionId ? { titlePointSessionId } : {}),
      ...(siteXSnapshot ? { siteXSnapshot } : {}),
    };
  }

  const clientDetails = (raw.clientDetails && typeof raw.clientDetails === 'object'
    ? raw.clientDetails
    : {}) as Record<string, unknown>;
  const property = (raw.property && typeof raw.property === 'object'
    ? raw.property
    : {}) as Record<string, unknown>;
  const seller = (raw.seller && typeof raw.seller === 'object'
    ? raw.seller
    : {}) as Record<string, unknown>;
  const transaction = (raw.transaction && typeof raw.transaction === 'object'
    ? raw.transaction
    : {}) as Record<string, unknown>;
  const parties = (raw.parties && typeof raw.parties === 'object'
    ? raw.parties
    : {}) as Record<string, unknown>;

  const sellerPrimary = person(seller.primary);
  const sellerSecondary = person(seller.secondary);
  const borrowerPrimary = person(transaction.primaryBorrower);
  const borrowerSecondary = person(transaction.secondaryBorrower);

  const orderTypeRaw = typeof transaction.orderType === 'string' ? transaction.orderType : 'title_only';
  const orderType = ORDER_TYPE_MAP[orderTypeRaw] ?? 'Title only';

  return {
    orderType,
    isRushOrder: false,
    property: {
      address: typeof property.street === 'string' && property.street.trim()
        ? property.street
        : (typeof property.address === 'string' ? property.address : 'TBD'),
      city: typeof property.city === 'string' && property.city.trim() ? property.city : 'Unknown',
      state: typeof property.state === 'string' && property.state.trim() ? property.state : 'CA',
      zip: typeof property.zip === 'string' && property.zip.trim() ? property.zip : '00000',
      apn: typeof property.apn === 'string' && property.apn ? property.apn : undefined,
      legalDescription: typeof property.legalDescription === 'string' && property.legalDescription
        ? property.legalDescription
        : undefined,
      county: typeof property.county === 'string' && property.county ? property.county : undefined,
      unitNumber: typeof property.unitNumber === 'string' && property.unitNumber
        ? property.unitNumber
        : undefined,
    },
    seller: {
      ...sellerPrimary,
      secondaryFirstName: seller.hasSecondary ? sellerSecondary.firstName : undefined,
      secondaryMiddleName: seller.hasSecondary ? sellerSecondary.middleName : undefined,
      secondaryLastName: seller.hasSecondary ? sellerSecondary.lastName : undefined,
      isOrganization: seller.isOrg === true,
      organizationType: seller.isOrg === true && typeof seller.orgType === 'string'
        ? seller.orgType
        : undefined,
    },
    buyer: {
      ...borrowerPrimary,
      secondaryFirstName: transaction.hasSecondaryBorrower ? borrowerSecondary.firstName : undefined,
      secondaryMiddleName: transaction.hasSecondaryBorrower ? borrowerSecondary.middleName : undefined,
      secondaryLastName: transaction.hasSecondaryBorrower ? borrowerSecondary.lastName : undefined,
      isOrganization: transaction.borrowerIsOrg === true,
      organizationType: transaction.borrowerIsOrg === true && typeof transaction.borrowerOrgType === 'string'
        ? transaction.borrowerOrgType
        : undefined,
    },
    transaction: {
      type: typeof transaction.transactionType === 'string' && transaction.transactionType
        ? transaction.transactionType
        : 'Purchase',
      product: typeof transaction.productType === 'string' && transaction.productType
        ? transaction.productType
        : 'Residential Resale',
      escrowNumber: typeof transaction.escrowNumber === 'string' ? transaction.escrowNumber : undefined,
      salesAmount: num(transaction.salesAmount),
      loanNumber: typeof transaction.loanNumber === 'string' ? transaction.loanNumber : undefined,
      loanAmount: num(transaction.loanAmount),
      coverageAmount: num(transaction.coverageAmount),
      branchCode: 'PCT',
      salesRep: typeof transaction.salesRep === 'string' ? transaction.salesRep : undefined,
      titleOfficer: typeof transaction.titleOfficer === 'string' ? transaction.titleOfficer : undefined,
      escrowOfficer: typeof parties.escrowOfficer === 'string' ? parties.escrowOfficer : undefined,
    },
    contacts: {
      buyerAgent: parties.showAgents ? partyContact(parties.buyerAgent) : undefined,
      listingAgent: parties.showAgents ? partyContact(parties.listingAgent) : undefined,
      lender: parties.showLender ? partyContact(parties.lender) : undefined,
      escrowCompany: parties.showEscrow ? partyContact(parties.escrow) : undefined,
    },
    clientType: typeof clientDetails.clientType === 'string' ? clientDetails.clientType : undefined,
    ...(titlePointSessionId ? { titlePointSessionId } : {}),
    ...(siteXSnapshot ? { siteXSnapshot } : {}),
  };
}
