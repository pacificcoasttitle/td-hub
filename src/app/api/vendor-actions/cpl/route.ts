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
  propertyOverrides: z
    .object({
      address: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      zip: z.string().optional(),
      county: z.string().optional(),
    })
    .optional(),

  lenderCompany: z.string().optional(),
  lenderContact: z.string().optional(),
  lenderAddress: z.string().optional(),
  lenderCity: z.string().optional(),
  lenderState: z.string().optional(),
  lenderZip: z.string().optional(),
  assignmentClause: z.string().optional(),
  propertyAddress: z.string().optional(),
  propertyCity: z.string().optional(),
  propertyState: z.string().optional(),
  propertyZip: z.string().optional(),
  loanNumber: z.string().optional(),
  loanAmount: z.string().optional(),
  salesAmount: z.string().optional(),
  borrowerNames: z.string().optional(),
  sellerNames: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const parsed = bodySchema.parse(body);

    const lenderOverrides = parsed.lenderOverrides ?? (
      parsed.lenderCompany
        ? {
            name: parsed.lenderCompany,
            address: parsed.lenderAddress,
            city: parsed.lenderCity,
            state: parsed.lenderState,
            zip: parsed.lenderZip,
          }
        : undefined
    );

    const propertyOverrides = parsed.propertyOverrides ?? (
      parsed.propertyAddress
        ? {
            address: parsed.propertyAddress,
            city: parsed.propertyCity,
            state: parsed.propertyState,
            zip: parsed.propertyZip,
          }
        : undefined
    );

    const input = {
      orderId: parsed.orderId,
      underwriter: parsed.underwriter,
      branchId: parsed.branchId,
      cplMode: parsed.cplMode,
      lenderOverrides,
      propertyOverrides,
      salesAmountOverride: parsed.salesAmount || undefined,
      loanAmountOverride: parsed.loanAmount || undefined,
      loanNumberOverride: parsed.loanNumber || undefined,
      borrowerNamesOverride: parsed.borrowerNames || undefined,
      sellerNamesOverride: parsed.sellerNames || undefined,
      assignmentClause: parsed.assignmentClause || undefined,
      lenderContactName: parsed.lenderContact || undefined,
    };

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
