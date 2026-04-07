import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import { notificationTypes } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

const ALLOWED_ROLES = ['super_admin', 'admin'];

const patchSchema = z.object({
  isEnabled: z.boolean().optional(),
  channels: z.array(z.string().min(1)).optional(),
  recipientRoles: z.array(z.string().min(1)).nullable().optional(),
  internalCc: z.array(z.string().min(1)).nullable().optional(),
  templateId: z.string().nullable().optional(),
}).strict();

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const session = await getSession();
  if (!session || !ALLOWED_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { slug } = await params;

  try {
    const row = await db
      .select()
      .from(notificationTypes)
      .where(eq(notificationTypes.slug, slug))
      .limit(1);

    if (!row[0]) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json(row[0]);
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const session = await getSession();
  if (!session || !ALLOWED_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { slug } = await params;

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const existing = await db
      .select({ id: notificationTypes.id })
      .from(notificationTypes)
      .where(eq(notificationTypes.slug, slug))
      .limit(1);

    if (!existing[0]) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const updated = await db
      .update(notificationTypes)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(notificationTypes.slug, slug))
      .returning();

    return NextResponse.json(updated[0]);
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
