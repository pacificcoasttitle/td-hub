import { NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import { notificationTemplates } from '@/lib/db/schema';
import { asc } from 'drizzle-orm';

const ADMIN_ROLES = ['super_admin', 'admin', 'cs_admin'];

export async function GET() {
  const session = await getSession();
  if (!session || !ADMIN_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const templates = await db
      .select({
        id: notificationTemplates.id,
        name: notificationTemplates.name,
        eventType: notificationTemplates.eventType,
        subject: notificationTemplates.subject,
        body: notificationTemplates.body,
        isActive: notificationTemplates.isActive,
        createdAt: notificationTemplates.createdAt,
        updatedAt: notificationTemplates.updatedAt,
      })
      .from(notificationTemplates)
      .orderBy(asc(notificationTemplates.eventType))
      .limit(200);

    return NextResponse.json({ templates });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
