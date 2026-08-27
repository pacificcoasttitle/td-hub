import type { CreateOrderInput } from './create-order';

const VALID_USER_TYPES = ['EscrowCompany', 'Lender', 'ListingAgentBroker', 'MortgageBroker'] as const;

const USER_TYPE_MAP: Record<string, string> = {
  escrow_company: 'EscrowCompany',
  escrow: 'EscrowCompany',
  lender: 'Lender',
  mortgage_broker: 'MortgageBroker',
  agent: 'ListingAgentBroker',
  realtor: 'ListingAgentBroker',
  listing_agent: 'ListingAgentBroker',
  real_estate_company: 'ListingAgentBroker',
};

/** SoftPro's internal user directory namespace, as in PCT\elasmarias. */
const SOFTPRO_USER_PREFIX = 'PCT\\';

/**
 * Title office used when the order has no title officer assigned at all. It is
 * the Glendale head office, not an inference about any person, and it is still
 * checked by assertKnownTitleOffice before the payload goes out.
 */
const DEFAULT_TITLE_OFFICE = 'GLT';

/** A payload that must not be sent, with a message an operator can act on. */
export class SoftProPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SoftProPayloadError';
  }
}

function stripPhone(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\D/g, '');
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

export interface ResolvedContact {
  id: number;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  companyName: string | null;
  lookupCode: string | null;
  flookupCode: string | null;
  officeLookupCode: string | null;
  /** SoftPro examiner person lookup (e.g. PCT\elasmarias). NOT the branch. */
  softproLookupCode?: string | null;
  /** Legacy alias for the examiner person lookup (same intent as softproLookupCode). */
  closerExaminer?: string | null;
  officerName: string | null;
  softproUserType: string | null;
  userType: string | null;
  address1: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

/**
 * SoftPro TitleOffice must be the examiner person lookup (PCT\user), never the
 * branch office code (GLT/OCT/…). Branch stays on LookUpCodeTitleOffice.
 *
 * Prefer softproLookupCode, then closerExaminer. Never fall back to lookupCode /
 * officeLookupCode — that was the bug that sent GLT as the examiner.
 */
export function resolveTitleExaminerLookup(titleOfficer?: ResolvedContact | null): string | null {
  const examiner = (titleOfficer?.softproLookupCode ?? titleOfficer?.closerExaminer ?? '').trim();
  if (!examiner) return null;

  const branch = (titleOfficer?.lookupCode ?? titleOfficer?.officeLookupCode ?? '').trim();
  if (branch && examiner.toLowerCase() === branch.toLowerCase()) {
    // softpro_lookup_code wrongly filled with the branch — omit rather than send invalid examiner
    return null;
  }

  return examiner;
}

export interface TitleOfficeFields {
  LookUpCodeTitleOffice: string;
  TitleOffice?: string;
}

/**
 * SoftPro's Title Officer feed carries the office code and the examiner code on
 * one row, and syncTitleOfficers stores both on the same contact. Reading them
 * from that single contact is what makes the pair unable to contradict itself.
 *
 * It used to be able to. For "Title & Escrow" the office came from the ESCROW
 * officer while the examiner came from the TITLE officer, so order 1077788 sent
 * office PRV with examiner PCT\cvirata. PRV is Anna Ballesteros' escrow branch
 * and is not a title office at all — the feed offers only GLT, OCT and TSG — and
 * SoftPro answered "One or more errors occurred."
 */
export function resolveTitleOfficeFields(titleOfficer?: ResolvedContact | null): TitleOfficeFields {
  if (!titleOfficer) return { LookUpCodeTitleOffice: DEFAULT_TITLE_OFFICE };

  const office = (titleOfficer.officeLookupCode ?? '').trim();
  if (!office) {
    const who = (titleOfficer.officerName ?? titleOfficer.fullName ?? `contact ${titleOfficer.id}`).trim();
    throw new SoftProPayloadError(
      `Title officer ${who} has no office code, so this order has no title office to send. `
      + 'Choose a different title officer, or ask an admin to re-run the contact sync so that officer gets one. '
      + 'The office code is never inferred from a name.',
    );
  }

  const examiner = resolveTitleExaminerLookup(titleOfficer);
  return examiner
    ? { LookUpCodeTitleOffice: office, TitleOffice: examiner }
    : { LookUpCodeTitleOffice: office };
}

/**
 * SoftPro matches this against its internal user directory — the same `PCT\user`
 * namespace as TitleOffice — not against the address book.
 *
 * The address-book code is not rejected, which is worse than being rejected:
 * staging accepted "AnnBalPaci" and created TEST-20002217-OCT with
 * EscrowCompanies null and no EscrowOfficer key at all, so every Title & Escrow
 * order created this way lost its escrow officer without saying so. Omitting the
 * field leaves an order an operator can fix; sending the wrong namespace leaves
 * one nobody knows is broken.
 */
export function resolveEscrowOfficerLookup(escrowOfficer?: ResolvedContact | null): string | null {
  const code = (escrowOfficer?.softproLookupCode ?? escrowOfficer?.closerExaminer ?? '').trim();
  if (!code.toUpperCase().startsWith(SOFTPRO_USER_PREFIX)) return null;
  return code;
}

/**
 * Last gate before the wire. LookUpCodeTitleOffice is the field behind every
 * createOrder rejection this system has had (PCT in March, PRV in August), and
 * SoftPro's reply to an unknown code is an unactionable "One or more errors
 * occurred." A named refusal here is worth more than that reply.
 *
 * knownTitleOffices is deliberately allowed to be empty. Empty means the caller
 * could not establish the valid set, and in that case this must wave the order
 * through: refusing everything when a lookup is unavailable would turn a Title &
 * Escrow bug into a total order-entry outage.
 */
export function assertKnownTitleOffice(
  payload: Record<string, unknown>,
  knownTitleOffices: readonly string[],
): void {
  const known = knownTitleOffices.map((c) => c.trim().toUpperCase()).filter(Boolean);
  if (known.length === 0) return;

  const tx = payload.transactionDetails as Record<string, unknown> | undefined;
  const code = typeof tx?.LookUpCodeTitleOffice === 'string' ? tx.LookUpCodeTitleOffice.trim() : '';

  if (!code) {
    throw new SoftProPayloadError(
      `This order has no title office. SoftPro accepts ${known.join(', ')} — assign a title officer whose office is one of those.`,
    );
  }
  if (!known.includes(code.toUpperCase())) {
    throw new SoftProPayloadError(
      `Not sending this order: "${code}" is not a title office. SoftPro accepts ${known.join(', ')}. `
      + 'That code comes from the assigned title officer, so check which officer is on the order and what office they belong to.',
    );
  }
}

export interface OpenerCompany {
  name: string;
  lookupCode: string;
  companyType: string | null;
  isEscrowCompany: boolean;
  isLender: boolean;
  isMortgageBroker: boolean;
  isRealEstateCompany: boolean;
  branchCode: string | null;
}

export interface ResolvedContacts {
  salesRep?: ResolvedContact;
  titleOfficer?: ResolvedContact;
  escrowOfficer?: ResolvedContact;
  opener?: ResolvedContact;
  openerCompany?: OpenerCompany;
  /**
   * Transaction parties the operator picked from the typeahead, for local
   * persistence only. buildSoftProPayload deliberately does not read this: the
   * wire format is the lookup codes on input.contacts and this branch does not
   * change what SoftPro receives. A key is absent when the party was typed as
   * free text, or when a company-first pick was a company rather than a person.
   */
  parties?: {
    escrowCompany?: ResolvedContact;
    lender?: ResolvedContact;
    buyerAgent?: ResolvedContact;
    listingAgent?: ResolvedContact;
    mortgageBroker?: ResolvedContact;
  };
}

function deriveUserType(
  company?: OpenerCompany,
  opener?: ResolvedContact,
  clientType?: string | null,
): string {
  if (company?.isEscrowCompany) return 'EscrowCompany';
  if (company?.isLender) return 'Lender';
  if (company?.isRealEstateCompany) return 'ListingAgentBroker';
  if (company?.isMortgageBroker) return 'MortgageBroker';

  if (company?.companyType) {
    const m = USER_TYPE_MAP[company.companyType.toLowerCase()];
    if (m) return m;
  }

  if (opener?.softproUserType) {
    const m = USER_TYPE_MAP[opener.softproUserType.toLowerCase()];
    if (m) return m;
  }

  if (clientType) {
    const m = USER_TYPE_MAP[clientType.toLowerCase()];
    if (m) return m;
  }

  return 'EscrowCompany';
}

function buildSellerDetails(input: CreateOrderInput): Record<string, string> {
  const isPurchase = input.transaction.type === 'Purchase';
  if (!isPurchase) {
    return {
      PrimaryOwnerFirstName: '',
      PrimaryOwnerMiddleName: '',
      PrimaryOwnerLastName: '',
      SecondaryOwnerFirstName: '',
      SecondaryOwnerMiddleName: '',
      SecondaryOwnerLastName: '',
      OrganizationType: '',
      IsOrganization: 'false',
    };
  }
  return {
    PrimaryOwnerFirstName: input.seller.firstName,
    PrimaryOwnerMiddleName: input.seller.middleName ?? '',
    PrimaryOwnerLastName: input.seller.lastName,
    SecondaryOwnerFirstName: input.seller.secondaryFirstName ?? '',
    SecondaryOwnerMiddleName: input.seller.secondaryMiddleName ?? '',
    SecondaryOwnerLastName: input.seller.secondaryLastName ?? '',
    OrganizationType: input.seller.isOrganization ? (input.seller.organizationType ?? '') : '',
    IsOrganization: String(input.seller.isOrganization),
  };
}

export function buildSoftProPayload(
  input: CreateOrderInput,
  enriched: { apn: string; legal: string; county: string },
  resolved: ResolvedContacts,
): Record<string, unknown> {
  const opener = resolved.opener;
  const company = resolved.openerCompany;
  const salesRep = resolved.salesRep;
  const titleOfficer = resolved.titleOfficer;
  const escrowOfficer = resolved.escrowOfficer;

  const salesRepLookup = salesRep?.lookupCode ?? '';
  const titleOffice = resolveTitleOfficeFields(titleOfficer);
  const escrowOfficerLookup = resolveEscrowOfficerLookup(escrowOfficer);

  return {
    baseDetails: {
      OrderType: input.orderType,
      ProjectName: 'PCT',
      IsRushOrder: input.isRushOrder,
    },
    personalDetails: {
      CompanyLookupCode: opener?.flookupCode ?? '',
      ClientLookupCode: opener?.lookupCode ?? '',
      UserType: deriveUserType(company, opener, input.clientType),
      CompanyName: company?.name ?? opener?.companyName ?? '',
      Email: opener?.email ?? '',
      FirstName: opener?.firstName ?? '',
      LastName: opener?.lastName ?? '',
      Telephone: stripPhone(opener?.phone),
      Address: opener?.address1 ?? '',
      City: opener?.city ?? '',
      ZipCode: opener?.zip ?? '',
      State: opener?.state ?? '',
      EmailNotifications: true,
      SalesRep: salesRepLookup,
    },
    propertyDetails: [{
      Address1: input.property.address,
      Address2: input.property.unitNumber ?? '',
      APNNumberParcelID: enriched.apn,
      Country: titleCase(enriched.county),
      Description: enriched.legal,
      IsPrimaryResidence: true,
      City: input.property.city,
      Zip: input.property.zip.slice(0, 5),
      State: input.property.state,
      EscrowBriefLegalLookupCode: null,
      EscrowBriefLegal: enriched.legal,
    }],
    sellerDetails: buildSellerDetails(input),
    transactionDetails: {
      // Both halves come from one title-officer row; TitleOffice is the examiner
      // person lookup and is omitted rather than falling back to the office code.
      ...titleOffice,
      Product: input.transaction.product,
      EscrowNumber: input.transaction.escrowNumber ?? '',
      SalesAmount: input.transaction.salesAmount,
      TransactionType: input.transaction.type,
      LoanNumber: input.transaction.loanNumber ?? '',
      LoanAmount: input.transaction.loanAmount,
      UnderwriterLookUpCode: input.transaction.underwriterCode ?? '',
      CoverageAmount: input.transaction.coverageAmount,
      PrimaryBorrowerFirstName: input.buyer.firstName,
      PrimaryBorrowerMiddleName: input.buyer.middleName ?? '',
      PrimaryBorrowerLastName: input.buyer.lastName,
      SecondaryBorrowerFirstName: input.buyer.secondaryFirstName ?? '',
      SecondaryBorrowerMiddleName: input.buyer.secondaryMiddleName ?? '',
      SecondaryBorrowerLastName: input.buyer.secondaryLastName ?? '',
      IsOrganization: input.buyer.isOrganization === true,
      OrganizationType: input.buyer.organizationType ?? '',
      LookUpCodeEscrowOfficer: escrowOfficerLookup,
      // Empty when we are naming an officer, so SoftPro uses the name attached
      // to the user code rather than ours — both vendor Title & Escrow examples
      // send it that way. Null when we are not: staging TEST-20002219-OCT sent
      // no officer code with an empty name and came back assigned to the API
      // service account PCT\rsupport, while TEST-20002220-OCT, identical but for
      // a null name, came back with no escrow officer at all.
      EscrowOfficerName: escrowOfficerLookup ? '' : null,
    },
    ...(hasContactData(input.contacts?.buyerAgent) && {
      buyersAgentDetails: mapContactSection(input.contacts!.buyerAgent!),
    }),
    ...(hasContactData(input.contacts?.listingAgent) && {
      listingAgentDetails: mapContactSection(input.contacts!.listingAgent!),
    }),
    ...(hasContactData(input.contacts?.escrowCompany) && {
      escrowDetails: mapContactSection(input.contacts!.escrowCompany!),
    }),
    ...(hasContactData(input.contacts?.lender) && {
      lenderDetails: mapContactSection(input.contacts!.lender!),
    }),
    ...(hasContactData(input.contacts?.mortgageBroker) && {
      mortgageDetails: mapContactSection(input.contacts!.mortgageBroker!),
    }),
  };
}

interface ContactInput {
  companyLookupCode?: string;
  clientLookupCode?: string;
  name?: string;
  email?: string;
  phone?: string;
  companyName?: string;
}

function hasContactData(c?: ContactInput): boolean {
  if (!c) return false;
  return !!(c.companyLookupCode || c.clientLookupCode || c.email || c.companyName);
}

function mapContactSection(c: ContactInput): Record<string, string> {
  return {
    CompanyLookUpCode: c.companyLookupCode ?? '',
    ClientLookUpCode: c.clientLookupCode ?? '',
    Name: c.name ?? '',
    Email: c.email ?? '',
    Telephone: c.phone ?? '',
    CompanyName: c.companyName ?? '',
  };
}
