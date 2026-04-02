import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { getOrderById } from '@/lib/domain/orders/service';
import { db } from '@/lib/db/client';
import { contacts, companies, orderExternalRefs } from '@/lib/db/schema';
import { eq, and, like } from 'drizzle-orm';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { id } = await params;
    const orderId = parseInt(id, 10);
    if (isNaN(orderId)) {
      return NextResponse.json({ error: 'Invalid order ID' }, { status: 400 });
    }

    const order = await getOrderById(orderId);
    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    let lenderContact: {
      companyName: string | null; fullName: string | null;
      address1: string | null; city: string | null; state: string | null; zip: string | null;
      assignmentClause: string | null;
    } | null = null;

    if (order.lenderId) {
      const [lc] = await db
        .select({
          companyName: contacts.companyName,
          fullName: contacts.fullName,
          address1: contacts.address1,
          city: contacts.city,
          state: contacts.state,
          zip: contacts.zip,
          assignmentClause: contacts.assignmentClause,
        })
        .from(contacts)
        .where(eq(contacts.id, order.lenderId))
        .limit(1);
      lenderContact = lc ?? null;
    }

    // Resolve underwriter company for CPL auto-detection
    let underwriterCompany: { name: string; lookupCode: string } | null = null;
    if (order.underwriterId) {
      const [uw] = await db
        .select({ name: companies.name, lookupCode: companies.lookupCode })
        .from(companies)
        .where(eq(companies.id, order.underwriterId))
        .limit(1);
      if (uw) underwriterCompany = { name: uw.name, lookupCode: uw.lookupCode ?? '' };
    }

    // Load CPL-specific saved data from external refs
    const cplRefRows = await db
      .select({ refType: orderExternalRefs.refType, refValue: orderExternalRefs.refValue })
      .from(orderExternalRefs)
      .where(
        and(
          eq(orderExternalRefs.orderId, orderId),
          like(orderExternalRefs.refType, 'cpl_%'),
        )
      );

    const cplData: Record<string, string> = {};
    for (const row of cplRefRows) {
      cplData[row.refType] = row.refValue;
    }

    return NextResponse.json({ ...order, lenderContact, cplData, underwriter: underwriterCompany });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
