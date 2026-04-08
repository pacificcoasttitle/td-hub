import { NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import { orders, branches } from '@/lib/db/schema';
import { sql, isNull, and } from 'drizzle-orm';

const ADMIN_ROLES = ['super_admin', 'admin'];

export async function POST() {
  const session = await getSession();
  if (!session || !ADMIN_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const allBranches = await db
      .select({ id: branches.id, code: branches.code })
      .from(branches);

    const updated: Record<string, number> = {};

    for (const branch of allBranches) {
      const result = await db
        .update(orders)
        .set({ branchId: branch.id })
        .where(
          and(
            isNull(orders.branchId),
            sql`${orders.fileNumber} LIKE ${'%-' + branch.code}`,
          ),
        )
        .returning({ id: orders.id });

      updated[branch.code] = result.length;
    }

    const total = Object.values(updated).reduce((s, n) => s + n, 0);
    return NextResponse.json({ updated, total });
  } catch (err) {
    return NextResponse.json(
      { error: 'Backfill failed', detail: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    );
  }
}
