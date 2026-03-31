import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { canAccessOrder } from '@/lib/security/client-scope';
import { generateProposedInsured } from '@/lib/domain/documents/proposed-insured';
import { db } from '@/lib/db/client';
import { documents } from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';

const bodySchema = z.object({
  lenderCompany: z.string().min(1),
  lenderCompanyId: z.number().int().positive().optional(),
  lenderCompanyLookupCode: z.string().optional(),
  assignmentClause: z.string().optional(),
  lenderAddress: z.string().min(1),
  lenderCity: z.string().min(1),
  lenderState: z.string().optional(),
  lenderZipcode: z.string().min(1),
  isNewLender: z.boolean(),
  propertyAddress: z.string().min(1),
  propertyCity: z.string().min(1),
  propertyState: z.string().min(1),
  propertyZipcode: z.string().min(1),
  titleOfficer: z.string().min(1),
  loanAmount: z.number().min(0),
  loanNumber: z.string(),
  borrowersVesting: z.string().min(1),
  supplementalReportDate: z.string().min(1),
  preliminaryReportDate: z.string().optional(),
  branchId: z.number().int().positive(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id: rawId } = await params;
    const orderId = Number(rawId);
    if (Number.isNaN(orderId) || orderId <= 0) {
      return NextResponse.json({ error: 'Invalid order ID' }, { status: 400 });
    }

    const allowed = await canAccessOrder(session.id, orderId);
    if (!allowed) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const body = await req.json().catch(() => null);
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 });
    }

    const result = await generateProposedInsured(orderId, session.id, parsed.data);

    if (!result.success) {
      return NextResponse.json({ error: result.error ?? 'Generation failed' }, { status: 422 });
    }

    return NextResponse.json({
      success: true,
      documentId: result.documentId,
      downloadUrl: result.downloadUrl ?? null,
    }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id: rawId } = await params;
    const orderId = Number(rawId);
    if (Number.isNaN(orderId) || orderId <= 0) {
      return NextResponse.json({ error: 'Invalid order ID' }, { status: 400 });
    }

    const allowed = await canAccessOrder(session.id, orderId);
    if (!allowed) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const docs = await db
      .select({
        id: documents.id,
        filename: documents.filename,
        description: documents.description,
        sizeBytes: documents.sizeBytes,
        createdAt: documents.createdAt,
      })
      .from(documents)
      .where(and(
        eq(documents.orderId, orderId),
        eq(documents.category, 'proposed_insured'),
        eq(documents.status, 'active'),
      ))
      .orderBy(desc(documents.createdAt));

    return NextResponse.json({ documents: docs });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
