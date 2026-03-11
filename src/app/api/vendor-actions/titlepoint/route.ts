import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import { jobs } from '@/lib/db/schema';
import { initiateSearch } from '@/lib/domain/titlepoint/service';

const bodySchema = z.object({
  orderId: z.number().int().positive(),
  searchType: z.enum(['geo_address', 'legal_vesting', 'grant_deed', 'tax']),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const input = bodySchema.parse(body);

    const result = await initiateSearch(input.orderId, input.searchType, session.id);

    if (!result.success) {
      return NextResponse.json(
        { error: 'TitlePoint search initiation failed', detail: result.error },
        { status: 422 }
      );
    }

    // Enqueue the first poll job
    await db.insert(jobs).values({
      jobType: 'titlepoint.poll',
      orderId: input.orderId,
      payload: { titlePointDataId: result.titlePointDataId } as Record<string, unknown>,
      status: 'queued',
      nextRetryAt: new Date(Date.now() + 10_000),
    });

    return NextResponse.json({
      success: true,
      titlePointDataId: result.titlePointDataId,
    });
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
