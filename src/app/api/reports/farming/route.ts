import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { canGenerateFarming } from '@/lib/domain/reports/access';
import { RANK_BY } from '@/lib/domain/reports/compute';
import {
  FARMING_COUNTIES, FARMING_WINDOWS, generateCarrierRoute, generateCountySales, generateSalesActivity,
  type GenerateOutcome,
} from '@/lib/domain/reports/generate';

export const dynamic = 'force-dynamic';
// A CSV parse and a PDF render: seconds, but not the default ceiling.
export const maxDuration = 60;

/** Farming extracts run to thousands of rows, not tens of megabytes. */
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Choose a month.');
const common = { brandedToContactId: z.coerce.number().int().positive('Choose the sales representative.') };

const bodySchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('sales_activity'),
    areaName: z.string().trim().min(1, 'Enter the area name.').max(200),
    propertyType: z.string().trim().max(40).optional().transform((v) => v || null),
    windowMonths: z.coerce.number().refine((n) => (FARMING_WINDOWS as readonly number[]).includes(n), 'The window must be 3, 6 or 12 months.'),
    windowEnd: month,
    ...common,
  }),
  z.object({
    type: z.literal('carrier_route'),
    areaName: z.string().trim().min(1, 'Enter the area name.').max(200),
    rankBy: z.enum(RANK_BY),
    ...common,
  }),
  z.object({
    type: z.literal('county_sales'),
    county: z.enum(FARMING_COUNTIES),
    month,
    ...common,
  }),
]);

/**
 * POST — generate a farming report from an uploaded file. Multipart: `file`
 * plus the fields for its type.
 *
 * Costs nothing, so there is no feature flag and no cost gate — only the role
 * check. The generator does the work and owns every refusal: this route turns
 * its outcome into a status and passes its message through, so the operator
 * reads "The file has no column for: purchase price" rather than a code.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canGenerateFarming(session.role)) {
    return NextResponse.json({ error: 'You do not have permission to create farming reports.' }, { status: 403 });
  }

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'Send the file as a form upload.' }, { status: 400 });

  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'Choose the CSV file to build the report from.' }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: 'That file is larger than 5 MB. A farming extract should be far smaller — check it is the right file.' }, { status: 413 });
  }
  if (!/\.csv$/i.test(file.name) && !/csv|text\/plain/i.test(file.type)) {
    return NextResponse.json({ error: 'The file must be a CSV. Save the spreadsheet as CSV and upload that.' }, { status: 415 });
  }

  const fields = Object.fromEntries([...form.entries()].filter(([k]) => k !== 'file'));
  const parsed = bodySchema.safeParse(fields);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Some details are missing.' }, { status: 400 });
  }

  const csv = await file.text();
  const base = { csv, brandedToContactId: parsed.data.brandedToContactId, createdBy: session.email };
  const b = parsed.data;

  const outcome: GenerateOutcome = b.type === 'sales_activity'
    ? await generateSalesActivity({ ...base, areaName: b.areaName, propertyType: b.propertyType, windowMonths: b.windowMonths as 3 | 6 | 12, windowEnd: b.windowEnd })
    : b.type === 'carrier_route'
      ? await generateCarrierRoute({ ...base, areaName: b.areaName, rankBy: b.rankBy })
      : await generateCountySales({ ...base, county: b.county, month: b.month });

  if (outcome.ok) {
    return NextResponse.json({
      reportId: outcome.reportId, type: b.type, pageCount: outcome.pageCount, quality: outcome.quality,
      // Set when the report cannot reach the rep it is branded to. Not an
      // error — the PDF is good — but the operator must be told, because
      // nothing else will.
      repWarning: outcome.repWarning ?? null,
    }, { status: 201 });
  }
  // Refused before anything was written: the file or the details need fixing.
  if (outcome.reportId === null) return NextResponse.json({ error: outcome.message, stage: outcome.stage }, { status: 422 });
  // A row exists and says failed. The list will show it with "Try again".
  return NextResponse.json({ error: outcome.message, stage: outcome.stage, reportId: outcome.reportId }, { status: 502 });
}
