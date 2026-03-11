import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db/client';
import { profiles, branches } from '@/lib/db/schema';
import { eq, desc, ilike, or, and, SQL, sql } from 'drizzle-orm';

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(25),
  role: z.string().optional(),
  search: z.string().optional(),
  active: z.enum(['true', 'false', 'all']).default('all'),
});

export async function GET(req: NextRequest) {
  try {
    const rawParams = Object.fromEntries(req.nextUrl.searchParams);
    const params = querySchema.parse(rawParams);
    const offset = (params.page - 1) * params.pageSize;

    const conditions: SQL[] = [];

    if (params.active !== 'all') {
      conditions.push(eq(profiles.isActive, params.active === 'true'));
    }

    if (params.role) {
      conditions.push(eq(profiles.role, params.role as typeof profiles.role.enumValues[number]));
    }

    if (params.search) {
      const term = `%${params.search}%`;
      conditions.push(
        or(
          ilike(profiles.displayName, term),
          ilike(profiles.email, term),
        )!,
      );
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, countResult] = await Promise.all([
      db
        .select({
          id: profiles.id,
          displayName: profiles.displayName,
          email: profiles.email,
          role: profiles.role,
          branchId: profiles.branchId,
          branchCode: branches.code,
          branchName: branches.name,
          isActive: profiles.isActive,
          createdAt: profiles.createdAt,
        })
        .from(profiles)
        .leftJoin(branches, eq(profiles.branchId, branches.id))
        .where(where)
        .orderBy(desc(profiles.createdAt))
        .limit(params.pageSize)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)` })
        .from(profiles)
        .where(where),
    ]);

    return NextResponse.json({
      users: rows,
      total: Number(countResult[0]?.count ?? 0),
      page: params.page,
      pageSize: params.pageSize,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid parameters', details: err.issues }, { status: 400 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
