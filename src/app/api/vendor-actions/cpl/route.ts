import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { generateCpl } from '@/lib/domain/cpl/service';

const bodySchema = z.object({
  orderId: z.number().int().positive(),
  underwriter: z.enum(['westcor', 'fnf', 'natic', 'doma']),
  branchId: z.number().int().positive(),
  cplMode: z.enum(['single', 'multiple']).optional(),
  lenderOverrides: z
    .object({
      name: z.string().optional(),
      address: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      zip: z.string().optional(),
    })
    .optional(),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const input = bodySchema.parse(body);

    const result = await generateCpl(input, session.id);

    if (!result.success) {
      return NextResponse.json(
        { error: 'CPL generation failed', details: result.errors },
        { status: 422 }
      );
    }

    return NextResponse.json({
      success: true,
      documentId: result.documentId,
      warnings: result.errors.length > 0 ? result.errors : undefined,
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
