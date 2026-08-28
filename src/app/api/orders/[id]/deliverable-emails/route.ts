import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { canAccessOrderDetailResource } from '@/lib/security/permissions';
import {
  addDeliverableEmails,
  listDeliverableEmails,
  removeDeliverableEmail,
  MAX_DELIVERABLE_EMAILS,
} from '@/lib/domain/notifications/deliverable-emails';

// ─── Editing the deliverable list after the order is open ───────────────────
//
// "Editable after open" is an approved decision: people get added mid
// transaction and a list frozen at open is wrong within a week.
//
// NOTE WHAT THIS ROUTE IS NOT. It edits the STORED list. No send path consumes
// anything from here — the confirmation resolves recipients by order id at send
// time. A caller cannot reach a recipient list through this route; they can only
// change what is stored, which is auditable and reversible.

async function guard(id: string) {
  const session = await getSession();
  if (!session) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };

  const orderId = parseInt(id, 10);
  if (Number.isNaN(orderId)) {
    return { error: NextResponse.json({ error: 'Invalid order ID' }, { status: 400 }) };
  }
  if (!(await canAccessOrderDetailResource(session, orderId))) {
    return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) };
  }
  return { orderId, userId: session.id as string };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await guard(id);
  if ('error' in g) return g.error;

  return NextResponse.json({
    emails: await listDeliverableEmails(g.orderId),
    max: MAX_DELIVERABLE_EMAILS,
  });
}

const addSchema = z.object({
  emails: z.array(z.string()).min(1).max(MAX_DELIVERABLE_EMAILS),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await guard(id);
  if ('error' in g) return g.error;

  const parsed = addSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.issues.map((i) => i.message) },
      { status: 400 },
    );
  }

  const result = await addDeliverableEmails(g.orderId, parsed.data.emails, g.userId);

  // Partial success is the normal case: one bad address should not reject the
  // three good ones typed alongside it. The caller is told exactly which failed.
  return NextResponse.json({
    added: result.added,
    invalid: result.invalid,
    atLimit: result.atLimit,
    emails: await listDeliverableEmails(g.orderId),
  });
}

const removeSchema = z.object({ id: z.number().int().positive() });

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await guard(id);
  if ('error' in g) return g.error;

  const parsed = removeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'An email id is required.' }, { status: 400 });
  }

  // Soft delete. The row stays so the address remains attributable, and the
  // next send stops including it immediately.
  const removed = await removeDeliverableEmail(g.orderId, parsed.data.id, g.userId);
  if (!removed) {
    return NextResponse.json({ error: 'That address is not on this order.' }, { status: 404 });
  }

  return NextResponse.json({ emails: await listDeliverableEmails(g.orderId) });
}
