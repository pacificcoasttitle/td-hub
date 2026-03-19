import { NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { handleEnrichOrders } from '@/lib/jobs/handlers/enrich-orders';

const ADMIN_ROLES = ['super_admin', 'admin', 'cs_admin', 'open_order_team'];

export async function POST() {
  const session = await getSession();
  if (!session || !ADMIN_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await handleEnrichOrders();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: 'Enrichment failed', detail: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    );
  }
}
