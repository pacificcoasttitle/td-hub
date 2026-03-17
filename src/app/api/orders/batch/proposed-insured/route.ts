import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { generateProposedInsured, getProposedInsuredPrefill } from '@/lib/domain/documents/proposed-insured';
import type { ProposedInsuredInput } from '@/lib/domain/documents/proposed-insured';

const bodySchema = z.object({
  orderIds: z.array(z.number().int().positive()).min(1).max(50),
  sharedData: z.object({
    lenderCompany: z.string().min(1).optional(),
    lenderCompanyId: z.number().int().positive().optional(),
    lenderCompanyLookupCode: z.string().optional(),
    assignmentClause: z.string().optional(),
    lenderAddress: z.string().optional(),
    lenderCity: z.string().optional(),
    lenderState: z.string().optional(),
    lenderZipcode: z.string().optional(),
    isNewLender: z.boolean().optional(),
    titleOfficer: z.string().optional(),
    branchId: z.number().int().positive().optional(),
  }).optional(),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 });
  }

  const { orderIds, sharedData } = parsed.data;

  const results: Array<{
    orderId: number;
    success: boolean;
    documentId?: number;
    error?: string;
  }> = [];

  for (const orderId of orderIds) {
    try {
      const prefill = await getProposedInsuredPrefill(orderId);
      if (!prefill) {
        results.push({ orderId, success: false, error: 'Order not found' });
        continue;
      }

      const input: ProposedInsuredInput = {
        lenderCompany: sharedData?.lenderCompany ?? prefill.lender.company ?? '',
        lenderCompanyId: sharedData?.lenderCompanyId ?? prefill.lender.companyId ?? undefined,
        lenderCompanyLookupCode: sharedData?.lenderCompanyLookupCode ?? prefill.lender.lookupCode ?? undefined,
        assignmentClause: sharedData?.assignmentClause ?? prefill.lender.assignmentClause ?? undefined,
        lenderAddress: sharedData?.lenderAddress ?? prefill.lender.address ?? '',
        lenderCity: sharedData?.lenderCity ?? prefill.lender.city ?? '',
        lenderState: sharedData?.lenderState ?? prefill.lender.state ?? undefined,
        lenderZipcode: sharedData?.lenderZipcode ?? prefill.lender.zipcode ?? '',
        isNewLender: sharedData?.isNewLender ?? false,

        propertyAddress: prefill.property.address,
        propertyCity: prefill.property.city,
        propertyState: prefill.property.state,
        propertyZipcode: prefill.property.zipcode,

        titleOfficer: sharedData?.titleOfficer ?? (prefill.titleOfficer?.id?.toString() ?? prefill.titleOfficer?.name ?? ''),
        loanAmount: prefill.loanAmount,
        loanNumber: prefill.loanNumber,
        borrowersVesting: prefill.borrowersVesting,
        supplementalReportDate: new Date().toLocaleDateString('en-US'),
        branchId: sharedData?.branchId ?? prefill.branch?.id ?? 1,
      };

      const result = await generateProposedInsured(orderId, session.id, input);
      results.push({
        orderId,
        success: result.success,
        documentId: result.documentId,
        error: result.error,
      });
    } catch (err) {
      results.push({
        orderId,
        success: false,
        error: err instanceof Error ? err.message : 'Unexpected error',
      });
    }
  }

  return NextResponse.json({ results });
}
