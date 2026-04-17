import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { getLookupTable, mapLookupTableEntry } from '@/lib/integrations/softpro';

const ALLOWED_ROLES = ['super_admin', 'admin', 'cs_admin', 'open_order_team', 'escrow_assistant',
  'sales_rep', 'title_officer', 'escrow_officer'];

const querySchema = z.object({
  userType: z.string().min(1),
  q: z.string().min(1).optional(),
});

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !ALLOWED_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rawParams = Object.fromEntries(req.nextUrl.searchParams);
  const parsed = querySchema.safeParse(rawParams);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid parameters', details: parsed.error.issues }, { status: 400 });
  }

  const { userType, q } = parsed.data;

  try {
    const result = await getLookupTable(userType);

    if (!result.success || !result.data) {
      return NextResponse.json({
        error: result.error?.message ?? 'Lookup failed',
      }, { status: 502 });
    }

    let entries = result.data.map((item) => {
      const mapped = mapLookupTableEntry(item);
      return {
        id: null as number | null,
        fullName: mapped.officerName,
        email: mapped.email,
        phone: null as string | null,
        companyName: null as string | null,
        type: 'officer' as const,
        lookupCode: mapped.code,
        officeLookupCode: mapped.officeLookupCode,
        address: null as string | null,
        city: null as string | null,
        state: null as string | null,
        zip: null as string | null,
        raw: mapped.raw,
      };
    });

    if (q) {
      const lower = q.toLowerCase();
      entries = entries.filter((e) =>
        (e.fullName?.toLowerCase().includes(lower)) ||
        (e.lookupCode?.toLowerCase().includes(lower)) ||
        (e.email?.toLowerCase().includes(lower))
      );
    }

    return NextResponse.json({
      results: entries.slice(0, 50),
      userType,
      total: entries.length,
    });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
