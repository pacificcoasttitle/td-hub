import { NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { handleSyncNewUsers } from '@/lib/jobs/handlers/sync-new-users';

export async function POST() {
  const session = await getSession();
  if (!session || session.role !== 'super_admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await handleSyncNewUsers();
    return NextResponse.json({ success: true, ...result });
  } catch {
    return NextResponse.json({ error: 'User sync failed' }, { status: 500 });
  }
}
