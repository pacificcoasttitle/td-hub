import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { canAccessOrder } from '@/lib/security/permissions';
import { applyVisibility, getOrderReadModel } from '@/lib/domain/orders/read-model';
import { mapStaffOrderDetailResponse } from '@/lib/domain/orders/staff-order-detail';
import { db } from '@/lib/db/client';
import { contacts, companies, orderExternalRefs } from '@/lib/db/schema';
import { eq, and, like } from 'drizzle-orm';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { id } = await params;
    const orderId = parseInt(id, 10);
    if (isNaN(orderId)) {
      return NextResponse.json({ error: 'Invalid order ID' }, { status: 400 });
    }

    if (!(await canAccessOrder(session, orderId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const model = await getOrderReadModel(orderId);
    if (!model) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    const visible = applyVisibility(model, 'staff');
    const detail = mapStaffOrderDetailResponse(visible);

    // CPL modal extras — not part of the canonical order identity, but still served here.
    let lenderContact: {
      companyName: string | null; fullName: string | null;
      address1: string | null; city: string | null; state: string | null; zip: string | null;
      assignmentClause: string | null;
    } | null = null;

    if (visible.lenderId) {
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
        .where(eq(contacts.id, visible.lenderId))
        .limit(1);
      lenderContact = lc ?? null;
    }

    let underwriterCompany: { name: string; lookupCode: string } | null = null;
    if (visible.underwriterId) {
      const [uw] = await db
        .select({ name: companies.name, lookupCode: companies.lookupCode })
        .from(companies)
        .where(eq(companies.id, visible.underwriterId))
        .limit(1);
      if (uw) underwriterCompany = { name: uw.name, lookupCode: uw.lookupCode ?? '' };
    }

    const cplRefRows = await db
      .select({ refType: orderExternalRefs.refType, refValue: orderExternalRefs.refValue })
      .from(orderExternalRefs)
      .where(
        and(
          eq(orderExternalRefs.orderId, orderId),
          like(orderExternalRefs.refType, 'cpl_%'),
        ),
      );

    const cplData: Record<string, string> = {};
    for (const row of cplRefRows) {
      cplData[row.refType] = row.refValue;
    }

    return NextResponse.json({
      ...detail,
      lenderContact,
      cplData,
      underwriter: underwriterCompany,
    });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
