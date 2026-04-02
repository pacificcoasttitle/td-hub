import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { getCplBranches } from '@/lib/domain/cpl/service';
import type { Underwriter } from '@/lib/integrations/cpl/types';

const VALID_UNDERWRITERS = ['westcor', 'fnf', 'natic', 'doma'] as const;

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const uw = req.nextUrl.searchParams.get('underwriter');
  const underwriter = uw && VALID_UNDERWRITERS.includes(uw as Underwriter)
    ? (uw as Underwriter)
    : undefined;

  try {
    const rows = await getCplBranches(underwriter);
    const branches = rows.map((r) => ({
      id: r.id,
      code: r.branchCode ?? '',
      name: r.branchName ?? '',
      underwriter: r.underwriter,
      underwriterCode: r.underwriterCode ?? '',
      agencyName: r.agencyName ?? '',
      address: r.address ?? '',
      city: r.city ?? '',
      state: r.state ?? '',
      zip: r.zip ?? '',
      phone: r.phone ?? '',
    }));
    return NextResponse.json({ branches });
  } catch {
    return NextResponse.json({ error: 'Failed to load CPL branches' }, { status: 500 });
  }
}
