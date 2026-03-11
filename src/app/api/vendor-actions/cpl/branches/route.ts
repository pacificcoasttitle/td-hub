import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { getCplBranches, getCplBranchesAll } from '@/lib/domain/cpl/service';

const querySchema = z.object({
  underwriter: z.enum(['westcor', 'fnf', 'natic', 'doma']).optional(),
});

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const rawParams = Object.fromEntries(req.nextUrl.searchParams);
    const params = querySchema.parse(rawParams);

    if (params.underwriter) {
      const branches = await getCplBranches(params.underwriter);
      return NextResponse.json({ branches });
    }

    const grouped = await getCplBranchesAll();
    return NextResponse.json({ branches: grouped });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid parameters', details: err.issues },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
