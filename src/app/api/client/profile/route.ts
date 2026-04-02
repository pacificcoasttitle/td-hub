import { NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import { contacts, companies, profiles } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const [profile] = await db
      .select()
      .from(profiles)
      .where(eq(profiles.id, session.id))
      .limit(1);

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    let contact = null;
    if (profile.contactId) {
      const [row] = await db
        .select({
          id: contacts.id,
          firstName: contacts.firstName,
          lastName: contacts.lastName,
          fullName: contacts.fullName,
          companyName: contacts.companyName,
          email: contacts.email,
          phone: contacts.phone,
          cell: contacts.cell,
          address1: contacts.address1,
          city: contacts.city,
          state: contacts.state,
          zip: contacts.zip,
          flookupCode: contacts.flookupCode,
        })
        .from(contacts)
        .where(eq(contacts.id, profile.contactId))
        .limit(1);
      contact = row ?? null;
    }

    let companyOfficers: { companySalesRepId: number | null; companyTitleOfficerId: number | null; companyLoanUnderwriter: string | null; companySalesUnderwriter: string | null } = {
      companySalesRepId: null, companyTitleOfficerId: null, companyLoanUnderwriter: null, companySalesUnderwriter: null,
    };
    if (contact?.flookupCode) {
      const [co] = await db
        .select({ salesRepId: companies.salesRepId, titleOfficerId: companies.titleOfficerId, loanUnderwriter: companies.loanUnderwriter, salesUnderwriter: companies.salesUnderwriter })
        .from(companies)
        .where(eq(companies.lookupCode, contact.flookupCode))
        .limit(1);
      if (co) {
        companyOfficers = { companySalesRepId: co.salesRepId, companyTitleOfficerId: co.titleOfficerId, companyLoanUnderwriter: co.loanUnderwriter, companySalesUnderwriter: co.salesUnderwriter };
      }
    }

    return NextResponse.json({
      profile: {
        id: profile.id,
        displayName: profile.displayName,
        email: profile.email,
        role: profile.role,
        branchId: profile.branchId,
        contactId: profile.contactId,
      },
      contact: contact ? { id: contact.id, firstName: contact.firstName, lastName: contact.lastName, fullName: contact.fullName, companyName: contact.companyName, email: contact.email, phone: contact.phone, cell: contact.cell, address1: contact.address1, city: contact.city, state: contact.state, zip: contact.zip } : null,
      ...companyOfficers,
    });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
