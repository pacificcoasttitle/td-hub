import { NextResponse } from 'next/server';
import { handleOpsDailyReport } from '@/lib/jobs/handlers/ops-daily-report';
import { getSession } from '@/lib/security/auth';
import { isStaff } from '@/lib/security/permissions';

export const maxDuration = 60;

export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isStaff(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const result = await handleOpsDailyReport();
    return NextResponse.json({
      success: true,
      sentTo: result.sentTo,
      sectionsLoaded: result.sectionsLoaded,
      sectionsFailed: result.sectionsFailed,
    });
  } catch (err) {
    console.error('[send-report] failed:', err);
    return NextResponse.json(
      {
        error: 'Failed to send report',
        details: err instanceof Error ? err.message : 'Unknown',
      },
      { status: 500 },
    );
  }
}
