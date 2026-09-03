import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { canAccessOrder } from '@/lib/security/permissions';
import { getOrderById } from '@/lib/domain/orders/service';
import { uploadDocument } from '@/lib/domain/documents/service';
import { getObjectStream } from '@/lib/integrations/s3/client';
import { isUpdatePrelimEnabled } from '@/lib/domain/prelim/update-prelim-flag';
import {
  PRELIM_NOTE_BODY_MAX,
  PRELIM_NOTE_SUBJECT_MAX,
  enqueueUpdatePrelimJob,
  findActiveUpdatePrelimJob,
  getUpdatePrelimStatus,
  prelimUploadFilename,
} from '@/lib/domain/prelim/update-prelim';

/**
 * Legacy checked only that *someone* was logged in and then trusted the order
 * id in the URL. canAccessOrder resolves the order and, for a sales role,
 * requires order.sales_rep_id to be the caller's own contact id.
 */
const ALLOWED_ROLES = [
  'super_admin', 'admin', 'cs_admin',
  'open_order_team',
  'sales_rep', 'sales_manager',
];

const MAX_PDF_BYTES = 25 * 1024 * 1024;

function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || !ALLOWED_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Ships dark. Gerard turns it on in Admin → Settings once staging is proven.
  if (!(await isUpdatePrelimEnabled())) {
    return NextResponse.json({ error: 'Request Updated Prelim is not enabled' }, { status: 403 });
  }

  const { id } = await params;
  const orderId = Number.parseInt(id, 10);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return badRequest('Invalid order ID');
  }

  if (!(await canAccessOrder(session, orderId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const order = await getOrderById(orderId);
  if (!order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return badRequest('Expected multipart/form-data');
  }

  const subject = String(form.get('subject') ?? '').trim();
  const note = String(form.get('note') ?? '').trim();
  const file = form.get('file');

  if (!subject) return badRequest('Subject is required');
  if (subject.length > PRELIM_NOTE_SUBJECT_MAX) {
    return badRequest(`Subject must be ${PRELIM_NOTE_SUBJECT_MAX} characters or fewer`);
  }
  if (!note) return badRequest('Note is required');
  if (note.length > PRELIM_NOTE_BODY_MAX) {
    return badRequest(`Note must be ${PRELIM_NOTE_BODY_MAX} characters or fewer`);
  }
  if (!(file instanceof File)) return badRequest('A PDF is required');
  if (file.size === 0) return badRequest('The PDF is empty');
  if (file.size > MAX_PDF_BYTES) return badRequest('The PDF must be 25 MB or smaller');

  const looksPdf = file.type === 'application/pdf'
    || file.name.toLowerCase().endsWith('.pdf');
  if (!looksPdf) return badRequest('Only PDF files are accepted');

  // One in-flight submit per order. Without this, a double-click queues two
  // jobs and the file gets two notes and two attachments.
  const active = await findActiveUpdatePrelimJob(orderId);
  if (active) {
    return NextResponse.json(
      { error: 'A Request Updated Prelim submission for this order is already in progress', jobId: active.id },
      { status: 409 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // A PDF starts with %PDF-. Cheap guard against a renamed file reaching
  // SoftPro, where a bad attachment is not something we can delete.
  if (!buffer.subarray(0, 5).toString('latin1').startsWith('%PDF-')) {
    return badRequest('That file is not a valid PDF');
  }

  const filename = prelimUploadFilename(order.fileNumber);

  let documentId: number;
  let storageKey: string;
  try {
    // Throws when S3 rejects the put — legacy ignored that return value and
    // then handed SoftPro a URL that pointed at nothing.
    const stored = await uploadDocument({
      orderId,
      file: buffer,
      filename,
      contentType: 'application/pdf',
      category: 'prelim',
      description: subject,
      userId: session.id,
    });
    documentId = stored.documentId;
    storageKey = stored.storageKey;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to store the PDF' },
      { status: 502 },
    );
  }

  // Read the object back before anything tells SoftPro to fetch it.
  const readback = await getObjectStream(storageKey);
  if (!readback.success || !(readback.data?.contentLength ?? 0)) {
    return NextResponse.json(
      {
        error: 'The PDF was not readable back from storage; nothing was sent to SoftPro',
        documentId,
      },
      { status: 502 },
    );
  }
  try {
    await readback.data!.body.cancel();
  } catch { /* nothing depends on closing the probe stream */ }

  const { jobId } = await enqueueUpdatePrelimJob({
    documentId,
    orderId,
    orderNumber: order.fileNumber,
    subject,
    note,
    requestedBy: session.id,
  });

  // 202 and a job id. No redirect to HTTP_REFERER — the caller decides where
  // to go next, and the row polls this route for real status.
  return NextResponse.json(
    { accepted: true, jobId, documentId, status: 'queued' },
    { status: 202 },
  );
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || !ALLOWED_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const orderId = Number.parseInt(id, 10);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return badRequest('Invalid order ID');
  }

  if (!(await canAccessOrder(session, orderId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const status = await getUpdatePrelimStatus(orderId);
  return NextResponse.json({ status });
}
