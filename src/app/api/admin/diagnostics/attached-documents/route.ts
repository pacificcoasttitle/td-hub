/**
 * Read-only probe for SoftPro GetAttachedDocuments.
 *
 * The prelim cron only calls orders that have no prelim yet, so an order that
 * already worked can never be re-observed. This route asks for any file number
 * and returns the body verbatim, which is the only way to compare a working
 * response against a failing one.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAttachedDocuments } from '@/lib/integrations/softpro';
import { describeAttachedDocuments } from '@/lib/integrations/softpro/client';
import { getSession } from '@/lib/security/auth';

const ALLOWED_ROLES = ['super_admin', 'admin'];

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !ALLOWED_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const fileNumbers = (req.nextUrl.searchParams.get('fileNumber') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 5);

  if (fileNumbers.length === 0) {
    return NextResponse.json(
      { error: 'fileNumber required, e.g. ?fileNumber=20021417-OCT,20021137-GLT' },
      { status: 400 },
    );
  }

  const probes = [];
  for (const fileNumber of fileNumbers) {
    const result = await getAttachedDocuments(fileNumber);
    probes.push({
      fileNumber,
      success: result.success,
      error: result.success ? null : result.error,
      shape: result.success ? describeAttachedDocuments(result.data) : null,
      body: result.success ? result.data : null,
    });
  }

  return NextResponse.json({ probes });
}
