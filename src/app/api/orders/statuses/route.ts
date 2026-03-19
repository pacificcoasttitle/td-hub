import { NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { getOrderStatusList } from '@/lib/integrations/softpro';

const FALLBACK_STATUSES = ['Open', 'In Process', 'Completed', 'Closed', 'Canceled', 'Duplicate'];

let cached: { statuses: string[]; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000;

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return NextResponse.json({ statuses: cached.statuses });
  }

  const result = await getOrderStatusList();

  if (result.success && result.data && result.data.length > 0) {
    cached = { statuses: result.data, fetchedAt: Date.now() };
    return NextResponse.json({ statuses: result.data });
  }

  return NextResponse.json({ statuses: FALLBACK_STATUSES });
}
