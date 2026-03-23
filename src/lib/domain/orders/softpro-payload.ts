import type { CreateOrderInput } from './create-order';

const SOFTPRO_USER_TYPE_MAP: Record<string, string> = {
  escrow: 'EscrowCompany',
  lender: 'Lender',
  mortgage_broker: 'MortgageBroker',
  realtor: 'ListingAgentBroker',
  title_officer: 'TitleOfficer',
  escrow_officer: 'EscrowOfficer',
  sales_rep: 'SalesRep',
};

function mapClientTypeToSoftPro(clientType?: string | null): string {
  if (!clientType) return 'EscrowCompany';
  return SOFTPRO_USER_TYPE_MAP[clientType] ?? clientType;
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
  officerName: string | null;
  softproUserType: string | null;
  userType: string | null;
  address1: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

export interface ResolvedContacts {
  salesRep?: ResolvedContact;
  titleOfficer?: ResolvedContact;
  escrowOfficer?: ResolvedContact;
  opener?: ResolvedContact;
}

export function buildSoftProPayload(
  input: CreateOrderInput,
  enriched: { apn: string; legal: string; county: string },
  resolved: ResolvedContacts,
): Record<string, unknown> {
  const opener = resolved.opener;
  const salesRep = resolved.salesRep;
  const titleOfficer = resolved.titleOfficer;
  const escrowOfficer = resolved.escrowOfficer;

  const salesRepLookup = salesRep?.lookupCode ?? '';
  const titleOfficeLookup = titleOfficer?.lookupCode ?? '';
  const officeBranchCode = titleOfficer?.officeLookupCode ?? input.transaction.branchCode;

  return {
    baseDetails: {
      OrderType: input.orderType,
      ProjectName: 'PCT',
      IsRushOrder: input.isRushOrder,
    },
    personalDetails: {
      CompanyLookupCode: opener?.flookupCode ?? '',
      ClientLookupCode: opener?.lookupCode ?? '',
      UserType: mapClientTypeToSoftPro(input.clientType ?? opener?.softproUserType),
      CompanyName: opener?.companyName ?? '',
      Email: opener?.email ?? '',
      FirstName: opener?.firstName ?? '',
      LastName: opener?.lastName ?? '',
      Telephone: opener?.phone ?? '',
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
      Country: enriched.county,
      Description: enriched.legal,
      IsPrimaryResidence: true,
      City: input.property.city,
      Zip: input.property.zip.slice(0, 5),
      State: input.property.state,
      EscrowBriefLegalLookupCode: null,
      EscrowBriefLegal: enriched.legal,
    }],
    sellerDetails: {
      PrimaryOwnerFirstName: input.seller.firstName,
      PrimaryOwnerMiddleName: input.seller.middleName ?? '',
      PrimaryOwnerLastName: input.seller.lastName,
      SecondaryOwnerFirstName: input.seller.secondaryFirstName ?? '',
      SecondaryOwnerMiddleName: input.seller.secondaryMiddleName ?? '',
      SecondaryOwnerLastName: input.seller.secondaryLastName ?? '',
      OrganizationType: input.seller.isOrganization ? (input.seller.organizationType ?? '') : '',
      IsOrganization: String(input.seller.isOrganization),
    },
    transactionDetails: {
      LookUpCodeTitleOffice: officeBranchCode,
      TitleOffice: titleOfficeLookup,
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
      IsOrganization: input.buyer.isOrganization,
      OrganizationType: input.buyer.organizationType ?? '',
      LookUpCodeEscrowOfficer: escrowOfficer?.lookupCode ?? null,
      EscrowOfficerName: escrowOfficer?.officerName ?? escrowOfficer?.fullName ?? null,
    },
    buyersAgentDetails: mapContactSection(input.contacts?.buyerAgent),
    listingAgentDetails: mapContactSection(input.contacts?.listingAgent),
    escrowDetails: mapContactSection(input.contacts?.escrowCompany),
    lenderDetails: mapContactSection(input.contacts?.lender),
    mortgageDetails: mapContactSection(input.contacts?.mortgageBroker),
  };
}

function mapContactSection(c?: {
  companyLookupCode?: string;
  clientLookupCode?: string;
  name?: string;
  email?: string;
  phone?: string;
  companyName?: string;
}): Record<string, string> {
  return {
    CompanyLookUpCode: c?.companyLookupCode ?? '',
    ClientLookUpCode: c?.clientLookupCode ?? '',
    Name: c?.name ?? '',
    Email: c?.email ?? '',
    Telephone: c?.phone ?? '',
    CompanyName: c?.companyName ?? '',
  };
}
