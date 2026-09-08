import { db } from '@/lib/db/client';
import { orders, branches, contacts, companies } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { determineUnderwriter } from './proposed-insured';
import { getCplRefPrefill, preferCplRef } from './cpl-ref-prefill';

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

  // What the operator typed on this order's CPL, layered over the values
  // derived above. Read-only, every underwriter, allowlisted fields only —
  // see cpl-ref-prefill.ts.
  //
  // KNOWN LIMITATION, stated here because this is where someone debugging an
  // empty modal will land: cpl/service.ts writes these refs only AFTER a
  // successful CPL. A CPL that failed at the vendor stores nothing, so
  // Proposed Insured opens with the derived values and none of the operator's
  // typing. That is not this function misbehaving — there is genuinely
  // nothing stored to read.
  const cpl = await getCplRefPrefill(orderId);

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

    // companyId and lookupCode stay derived — they are PI's own identity for
    // the lender and flow to PI only, never back. A CPL holds a typed name and
    // address, not an id, so there is nothing there to override them with.
    lender: lenderCompanyData
      ? {
          company: lenderCompanyData.name,
          companyId: lenderCompanyData.id,
          lookupCode: lenderCompanyData.lookupCode ?? '',
          assignmentClause: preferCplRef(cpl.assignmentClause, lenderCompanyData.assignmentClause ?? ''),
          address: preferCplRef(cpl.lenderAddress, lenderCompanyData.address1 ?? ''),
          city: preferCplRef(cpl.lenderCity, lenderCompanyData.city ?? ''),
          state: preferCplRef(cpl.lenderState, lenderCompanyData.state ?? ''),
          zipcode: preferCplRef(cpl.lenderZip, lenderCompanyData.zip ?? ''),
        }
      : {
          company: lenderParty?.externalCompany ?? '',
          companyId: null,
          lookupCode: '',
          assignmentClause: preferCplRef(cpl.assignmentClause, ''),
          address: preferCplRef(cpl.lenderAddress, ''),
          city: preferCplRef(cpl.lenderCity, ''),
          state: preferCplRef(cpl.lenderState, ''),
          zipcode: preferCplRef(cpl.lenderZip, ''),
        },

    titleOfficer: titleOfficerData
      ? { id: orderRow.titleOfficerId!, ...titleOfficerData }
      : null,

    branch: branchData,

    borrowersVesting: buyers.join('; '),
    loanAmount: orderRow.loanAmount ? parseFloat(orderRow.loanAmount) : 0,
    // Was hard-coded '' — PI had no source for a loan number at all, so the
    // operator retyped it every time. `orders.loan_number` is also populated
    // on some orders and would be a reasonable second fallback, but that is a
    // separate change from carrying the CPL across and is not made here.
    loanNumber: preferCplRef(cpl.loanNumber, ''),
    salesPrice: orderRow.salesPrice ? parseFloat(orderRow.salesPrice) : 0,
  };
}
