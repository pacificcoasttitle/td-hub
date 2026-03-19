import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import { documents, orders } from '@/lib/db/schema';
import { eq, and, desc, sql, ilike, gte, lte, inArray, SQL } from 'drizzle-orm';

const ADMIN_ROLES = ['super_admin', 'admin', 'cs_admin', 'open_order_team'];

const VALID_CATEGORIES = [
  'cpl', 'prelim', 'policy', 'legal_vesting', 'grant_deed',
  'tax', 'general', 'user_upload', 'proposed_insured', 'curative',
] as const;

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(50),
  category: z.string().optional(),
  search: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  status: z.string().default('active'),
});

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !ADMIN_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const rawParams = Object.fromEntries(req.nextUrl.searchParams);
    const params = querySchema.parse(rawParams);
    const offset = (params.page - 1) * params.limit;

    const conditions: SQL[] = [];

    if (params.status) {
      conditions.push(
        eq(documents.status, params.status as typeof documents.status.enumValues[number]),
      );
    }

    if (params.category) {
      const cats = params.category
        .split(',')
        .map((c) => c.trim())
        .filter((c): c is (typeof VALID_CATEGORIES)[number] =>
          (VALID_CATEGORIES as readonly string[]).includes(c),
        );
      if (cats.length > 0) {
        conditions.push(inArray(documents.category, cats));
      }
    }

    if (params.search) {
      conditions.push(ilike(orders.fileNumber, `%${params.search}%`));
    }

    if (params.dateFrom) {
      const from = new Date(params.dateFrom);
      if (!isNaN(from.getTime())) {
        conditions.push(gte(documents.createdAt, from));
      }
    }

    if (params.dateTo) {
      const to = new Date(params.dateTo);
      if (!isNaN(to.getTime())) {
        conditions.push(lte(documents.createdAt, to));
      }
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, countResult] = await Promise.all([
      db
        .select({
          id: documents.id,
          orderId: documents.orderId,
          orderFileNumber: orders.fileNumber,
          category: documents.category,
          filename: documents.filename,
          originalFilename: documents.originalFilename,
          contentType: documents.contentType,
          sizeBytes: documents.sizeBytes,
          status: documents.status,
          description: documents.description,
          createdBy: documents.createdBy,
          createdAt: documents.createdAt,
        })
        .from(documents)
        .leftJoin(orders, eq(documents.orderId, orders.id))
        .where(where)
        .orderBy(desc(documents.createdAt))
        .limit(params.limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)` })
        .from(documents)
        .leftJoin(orders, eq(documents.orderId, orders.id))
        .where(where),
    ]);

    const mapped = rows.map((row) => ({
      id: row.id,
      orderId: row.orderId,
      orderFileNumber: row.orderFileNumber ?? null,
      category: row.category,
      filename: row.filename,
      originalFilename: row.originalFilename,
      contentType: row.contentType,
      sizeBytes: row.sizeBytes,
      status: row.status,
      description: row.description,
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
    }));

    return NextResponse.json({
      documents: mapped,
      total: Number(countResult[0]?.count ?? 0),
      page: params.page,
      limit: params.limit,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid parameters', details: err.issues },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: 'Failed to load documents', detail: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    );
  }
}
