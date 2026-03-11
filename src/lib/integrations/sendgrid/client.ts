import { VendorResult, vendorSuccess, vendorError } from '../types';
import { db } from '@/lib/db/client';
import { vendorApiLogs } from '@/lib/db/schema';

const VENDOR = 'sendgrid';
const API_URL = 'https://api.sendgrid.com/v3/mail/send';

export interface SendEmailParams {
  to: string | string[];
  cc?: string | string[];
  subject: string;
  html: string;
  from?: string;
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
  requestMeta?: Record<string, unknown>;
  responseMeta?: Record<string, unknown>;
}) {
  try {
    await db.insert(vendorApiLogs).values({
      vendor: VENDOR,
      operation: params.operation,
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

  if (toList.length === 0) {
    return vendorError<SendEmailResult>(VENDOR, 'NO_RECIPIENTS', 'No recipients specified', { requestId });
  }

  if (!apiKey) {
    await logRequest({
      operation: 'send_email_mock',
      requestId,
      startedAt,
      success: true,
      requestMeta: { to: toList, cc: ccList, subject: params.subject, from, mock: true },
    });
    return vendorSuccess({ messageId: `mock-${requestId}` }, { requestId, durationMs: 0 });
  }

  const personalizations: Record<string, unknown>[] = [{
    to: toList.map((email) => ({ email })),
    ...(ccList.length > 0 ? { cc: ccList.map((email) => ({ email })) } : {}),
  }];

  const body = {
    personalizations,
    from: { email: from },
    subject: params.subject,
    content: [{ type: 'text/html', value: params.html }],
  };

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
        requestMeta: { to: toList, cc: ccList, subject: params.subject, from },
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
      requestMeta: { to: toList, cc: ccList, subject: params.subject, from },
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
      requestMeta: { to: toList, subject: params.subject },
      responseMeta: { error: message },
    });

    return vendorError<SendEmailResult>(VENDOR, 'NETWORK_ERROR', message, {
      retryable: true,
      requestId,
      durationMs,
    });
  }
}
