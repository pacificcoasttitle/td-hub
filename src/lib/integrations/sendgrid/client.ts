import { VendorResult, vendorSuccess, vendorError } from '../types';
import { db } from '@/lib/db/client';
import { vendorApiLogs } from '@/lib/db/schema';

const VENDOR = 'sendgrid';
const API_URL = 'https://api.sendgrid.com/v3/mail/send';

export interface SendGridAttachment {
  content: string;
  type: string;
  filename: string;
  disposition?: string;
}

export interface SendEmailParams {
  to: string | string[];
  cc?: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string;
  attachments?: SendGridAttachment[];
  /**
   * The order this email is about, so the delivery log can be searched the way
   * anybody would actually search it — by file number.
   *
   * MEASURED 2026-09-10: all 1,521 sendgrid rows had `order_id` NULL, and the
   * delivery log's fallback parser only matches `File X` / `Order X`, which
   * neither of our two subject formats uses ("20022021-GLT · address ·
   * Confirmation" and "Preliminary Title Report — address"). So when a client
   * said they never got their prelim, nobody could look the send up at all.
   *
   * Optional because genuinely order-less mail exists — user invites, the ops
   * digest, template samples. Anything sent ABOUT an order must pass it.
   */
  orderId?: number | null;
  /** Denormalised onto request_meta so a log row is searchable on its own. */
  fileNumber?: string | null;
}

interface SendEmailResult {
  messageId: string;
}

function getApiKey(): string | null {
  return process.env.SENDGRID_API_KEY ?? null;
}

function getFromEmail(): string {
  return process.env.FROM_EMAIL ?? 'noreply@pctitle.com';
}

async function logRequest(params: {
  operation: string;
  requestId: string;
  startedAt: Date;
  success: boolean;
  errorCategory?: string;
  orderId?: number | null;
  requestMeta?: Record<string, unknown>;
  responseMeta?: Record<string, unknown>;
}) {
  try {
    await db.insert(vendorApiLogs).values({
      vendor: VENDOR,
      operation: params.operation,
      orderId: params.orderId ?? null,
      requestId: params.requestId,
      startedAt: params.startedAt,
      endedAt: new Date(),
      success: params.success,
      errorCategory: params.errorCategory ?? null,
      requestMeta: params.requestMeta ?? null,
      responseMeta: params.responseMeta ?? null,
    });
  } catch { /* Don't let logging failures break the main flow */ }
}

function toArray(val: string | string[] | undefined): string[] {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

export async function sendEmail(params: SendEmailParams): Promise<VendorResult<SendEmailResult>> {
  const requestId = crypto.randomUUID();
  const startedAt = new Date();
  const apiKey = getApiKey();
  const from = params.from ?? getFromEmail();
  const toList = toArray(params.to).filter(Boolean);
  const ccList = toArray(params.cc).filter(Boolean);
  const replyTo = params.replyTo?.trim();

  if (toList.length === 0) {
    return vendorError<SendEmailResult>(VENDOR, 'NO_RECIPIENTS', 'No recipients specified', { requestId });
  }

  if (!apiKey) {
    await logRequest({
      operation: 'send_email_mock',
      requestId,
      startedAt,
      success: true,
      orderId: params.orderId,
      requestMeta: { to: toList, cc: ccList, subject: params.subject, from, replyTo, fileNumber: params.fileNumber ?? null, mock: true },
    });
    return vendorSuccess({ messageId: `mock-${requestId}` }, { requestId, durationMs: 0 });
  }

  const personalizations: Record<string, unknown>[] = [{
    to: toList.map((email) => ({ email })),
    ...(ccList.length > 0 ? { cc: ccList.map((email) => ({ email })) } : {}),
  }];

  const body: Record<string, unknown> = {
    personalizations,
    from: { email: from },
    subject: params.subject,
    content: [
      ...(params.text ? [{ type: 'text/plain', value: params.text }] : []),
      { type: 'text/html', value: params.html },
    ],
    ...(replyTo ? { reply_to: { email: replyTo } } : {}),
  };

  if (params.attachments && params.attachments.length > 0) {
    body.attachments = params.attachments.map((a) => ({
      content: a.content,
      type: a.type,
      filename: a.filename,
      disposition: a.disposition ?? 'attachment',
    }));
  }

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });

    const durationMs = Date.now() - startedAt.getTime();
    const messageId = response.headers.get('x-message-id') ?? requestId;

    if (response.status >= 200 && response.status < 300) {
      await logRequest({
        operation: 'send_email',
        requestId,
        startedAt,
        success: true,
        orderId: params.orderId,
      requestMeta: { to: toList, cc: ccList, subject: params.subject, from, replyTo, fileNumber: params.fileNumber ?? null },
        responseMeta: { status: response.status, messageId },
      });
      return vendorSuccess({ messageId }, { requestId, durationMs });
    }

    const errorBody = await response.text().catch(() => 'Unknown error');
    await logRequest({
      operation: 'send_email',
      requestId,
      startedAt,
      success: false,
      errorCategory: 'API_ERROR',
      orderId: params.orderId,
      requestMeta: { to: toList, cc: ccList, subject: params.subject, from, replyTo, fileNumber: params.fileNumber ?? null },
      responseMeta: { status: response.status, body: errorBody },
    });

    return vendorError<SendEmailResult>(VENDOR, 'SEND_FAILED', `SendGrid ${response.status}: ${errorBody}`, {
      httpStatus: response.status,
      retryable: response.status >= 500,
      requestId,
      durationMs,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const durationMs = Date.now() - startedAt.getTime();

    await logRequest({
      operation: 'send_email',
      requestId,
      startedAt,
      success: false,
      errorCategory: 'NETWORK',
      orderId: params.orderId,
      requestMeta: { to: toList, cc: ccList, subject: params.subject, from, replyTo, fileNumber: params.fileNumber ?? null },
      responseMeta: { error: message },
    });

    return vendorError<SendEmailResult>(VENDOR, 'NETWORK_ERROR', message, {
      retryable: true,
      requestId,
      durationMs,
    });
  }
}
