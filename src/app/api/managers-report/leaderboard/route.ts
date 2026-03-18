import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { getLeaderboard } from '@/lib/integrations/managers-report';

const ALLOWED_ROLES = ['super_admin', 'admin', 'cs_admin'];

const querySchema = z.object({
  month: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(10),
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

  const { month, limit } = parsed.data;

  try {
    const result = await getLeaderboard(month, limit);

    if (!result.success || !result.data) {
      const notConfigured = result.error?.code === 'NOT_CONFIGURED';
      if (notConfigured) {
        return NextResponse.json({
          month: null,
          priorMonth: null,
          totalReps: 0,
          leaderboard: [],
          _warning: 'MANAGERS_REPORT_API_URL is not configured',
        });
      }
      return NextResponse.json(
        { error: result.error?.message ?? 'Failed to fetch leaderboard' },
        { status: 502 },
      );
    }

    return NextResponse.json(result.data);
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
