import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { getCplBranches, getCplBranchesAll } from '@/lib/domain/cpl/service';
import type { Underwriter } from '@/lib/integrations/cpl/types';

const VALID_UNDERWRITERS = new Set<string>(['westcor', 'fnf', 'natic', 'doma']);

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const underwriter = req.nextUrl.searchParams.get('underwriter');

    if (underwriter) {
      if (!VALID_UNDERWRITERS.has(underwriter)) {
        return NextResponse.json(
          { error: `Invalid underwriter. Must be one of: ${[...VALID_UNDERWRITERS].join(', ')}` },
          { status: 400 }
        );
      }

      const branches = await getCplBranches(underwriter as Underwriter);
      return NextResponse.json({ branches });
    }

    const grouped = await getCplBranchesAll();
    return NextResponse.json({ branches: grouped });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
