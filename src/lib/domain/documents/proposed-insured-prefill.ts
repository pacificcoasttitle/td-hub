import { db } from '@/lib/db/client';
import { orders, branches, contacts, companies } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { determineUnderwriter } from './proposed-insured';

export async function getProposedInsuredPrefill(orderId: number) {
  const [orderRow] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!orderRow) return null;

  const { default: orderProperties } = await import('@/lib/db/schema/orders').then(m => ({ default: m.orderProperties }));
  const { default: orderParties } = await import('@/lib/db/schema/orders').then(m => ({ default: m.orderParties }));

  const [property] = await db
    .select()
    .from(orderProperties)
    .where(eq(orderProperties.orderId, orderId))
    .limit(1);

  const parties = await db
    .select()
    .from(orderParties)
    .where(eq(orderParties.orderId, orderId));

  const lenderParty = parties.find(p => p.role === 'lender');
  const buyers = parties
    .filter(p => p.role === 'buyer')
    .map(p => p.externalName)
    .filter((n): n is string => !!n);

  let titleOfficerData: { name: string; email: string | null; phone: string | null } | null = null;
  if (orderRow.titleOfficerId) {
    const [contact] = await db
      .select({ fullName: contacts.fullName, email: contacts.email, phone: contacts.phone })
      .from(contacts)
      .where(eq(contacts.id, orderRow.titleOfficerId))
      .limit(1);
    if (contact) {
      titleOfficerData = { name: contact.fullName ?? '', email: contact.email, phone: contact.phone };
    }
  }

  let branchData: { id: number; name: string; address: string | null; city: string | null; state: string | null; zip: string | null } | null = null;
  if (orderRow.branchId) {
    const [b] = await db.select().from(branches).where(eq(branches.id, orderRow.branchId)).limit(1);
    if (b) {
      branchData = { id: b.id, name: b.name, address: b.address, city: b.city, state: b.state, zip: b.zip };
    }
  }

  let lenderCompanyData: { id: number; name: string; lookupCode: string | null; assignmentClause: string | null; address1: string | null; city: string | null; state: string | null; zip: string | null } | null = null;
  if (lenderParty?.externalCompany) {
    const [company] = await db
      .select({
        id: companies.id, name: companies.name, lookupCode: companies.lookupCode,
        assignmentClause: companies.assignmentClause, address1: companies.address1,
        city: companies.city, state: companies.state, zip: companies.zip,
      })
      .from(companies)
      .where(eq(companies.name, lenderParty.externalCompany))
      .limit(1);
    if (company) lenderCompanyData = company;
  }

  return {
    fileNumber: orderRow.fileNumber,
    productType: orderRow.productType,
    underwriterLabel: determineUnderwriter(orderRow.productType),

    property: {
      address: property?.address ?? '',
      city: property?.city ?? '',
      state: property?.state ?? 'CA',
      zipcode: property?.zip ?? '',
    },

    lender: lenderCompanyData
      ? {
          company: lenderCompanyData.name,
          companyId: lenderCompanyData.id,
          lookupCode: lenderCompanyData.lookupCode ?? '',
          assignmentClause: lenderCompanyData.assignmentClause ?? '',
          address: lenderCompanyData.address1 ?? '',
          city: lenderCompanyData.city ?? '',
          state: lenderCompanyData.state ?? '',
          zipcode: lenderCompanyData.zip ?? '',
        }
      : {
          company: lenderParty?.externalCompany ?? '',
          companyId: null,
          lookupCode: '',
          assignmentClause: '',
          address: '',
          city: '',
          state: '',
          zipcode: '',
        },

    titleOfficer: titleOfficerData
      ? { id: orderRow.titleOfficerId!, ...titleOfficerData }
      : null,

    branch: branchData,

    borrowersVesting: buyers.join('; '),
    loanAmount: orderRow.loanAmount ? parseFloat(orderRow.loanAmount) : 0,
    loanNumber: '',
    salesPrice: orderRow.salesPrice ? parseFloat(orderRow.salesPrice) : 0,
  };
}
