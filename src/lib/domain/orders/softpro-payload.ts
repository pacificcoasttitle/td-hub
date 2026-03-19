import { z } from 'zod';
import type { CreateOrderInput } from './create-order';

const contactSchema = z.object({
  companyLookupCode: z.string().optional(),
  clientLookupCode: z.string().optional(),
  name: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  companyName: z.string().optional(),
});

export function buildSoftProPayload(
  input: CreateOrderInput,
  enriched: { apn: string; legal: string; county: string },
): Record<string, unknown> {
  const ec = input.contacts?.escrowCompany;

  return {
    baseDetails: {
      OrderType: input.orderType,
      ProjectName: 'PCT',
      IsRushOrder: input.isRushOrder,
    },
    personalDetails: {
      CompanyLookupCode: ec?.companyLookupCode ?? '',
      ClientLookupCode: ec?.clientLookupCode ?? '',
      UserType: 'EscrowCompany',
      CompanyName: ec?.companyName ?? '',
      Email: ec?.email ?? '',
      FirstName: ec?.name?.split(' ')[0] ?? '',
      LastName: ec?.name?.split(' ').slice(1).join(' ') ?? '',
      Telephone: ec?.phone ?? '',
      Address: '', City: '', ZipCode: '', State: '',
      EmailNotifications: true,
      SalesRep: input.transaction.titleOfficer ?? '',
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
      OrganizationType: '',
      IsOrganization: String(input.seller.isOrganization),
    },
    transactionDetails: {
      LookUpCodeTitleOffice: input.transaction.branchCode,
      TitleOffice: input.transaction.titleOfficer ?? '',
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
    },
    buyersAgentDetails: mapContactSection(input.contacts?.buyerAgent),
    listingAgentDetails: mapContactSection(input.contacts?.listingAgent),
    escrowDetails: mapContactSection(input.contacts?.escrowCompany),
    lenderDetails: mapContactSection(input.contacts?.lender),
    mortgageDetails: mapContactSection(input.contacts?.mortgageBroker),
  };
}

function mapContactSection(c?: z.infer<typeof contactSchema>) {
  if (!c) return {};
  return {
    CompanyLookUpCode: c.companyLookupCode ?? '',
    ClientLookUpCode: c.clientLookupCode ?? '',
    Name: c.name ?? '',
    Email: c.email ?? '',
    Telephone: c.phone ?? '',
    CompanyName: c.companyName ?? '',
  };
}
