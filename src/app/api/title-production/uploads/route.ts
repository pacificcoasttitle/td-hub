import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import { titleProductionUploads } from '@/lib/db/schema';
import { desc, count, or, ilike, SQL } from 'drizzle-orm';

const ALLOWED_ROLES = ['title_production', 'super_admin', 'admin'];

function getAppUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!configured) return 'https://td-hub.vercel.app';
  return configured.replace(/\/$/, '');
}

function toPermanentUrl(id: number): string {
  return `${getAppUrl()}/api/title-production/uploads/${id}/file`;
}

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().optional(),
});

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !ALLOWED_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const params = querySchema.safeParse(
    Object.fromEntries(req.nextUrl.searchParams),
  );
  if (!params.success) {
    return NextResponse.json({ error: 'Invalid query params' }, { status: 400 });
  }

  const { page, pageSize, search } = params.data;
  const offset = (page - 1) * pageSize;

  const where: SQL | undefined = search
    ? or(
        ilike(titleProductionUploads.orderNumber, `%${search}%`),
        ilike(titleProductionUploads.documentName, `%${search}%`),
      )
    : undefined;

  const [uploads, totalResult] = await Promise.all([
    db
      .select({
        id: titleProductionUploads.id,
        orderNumber: titleProductionUploads.orderNumber,
        documentName: titleProductionUploads.documentName,
        filename: titleProductionUploads.filename,
        publicUrl: titleProductionUploads.publicUrl,
        isSynced: titleProductionUploads.isSynced,
        syncReason: titleProductionUploads.syncReason,
        createdAt: titleProductionUploads.createdAt,
      })
      .from(titleProductionUploads)
      .where(where)
      .orderBy(desc(titleProductionUploads.createdAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ total: count() })
      .from(titleProductionUploads)
      .where(where),
  ]);

  const total = totalResult[0]?.total ?? 0;

  return NextResponse.json({
    uploads: uploads.map((upload) => ({
      ...upload,
      publicUrl: toPermanentUrl(upload.id),
    })),
    total,
    page,
    totalPages: Math.ceil(total / pageSize),
  });
}
