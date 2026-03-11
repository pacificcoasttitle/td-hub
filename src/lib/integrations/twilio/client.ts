import { VendorResult, vendorSuccess, vendorError } from '../types';
import { db } from '@/lib/db/client';
import { vendorApiLogs } from '@/lib/db/schema';

const VENDOR = 'twilio';

export interface SendSmsParams {
  to: string;
  body: string;
}

interface SendSmsResult {
  messageSid: string;
}

function getCredentials(): { accountSid: string; authToken: string; fromNumber: string } | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;
  if (!accountSid || !authToken || !fromNumber) return null;
  return { accountSid, authToken, fromNumber };
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

export async function sendSms(params: SendSmsParams): Promise<VendorResult<SendSmsResult>> {
  const requestId = crypto.randomUUID();
  const startedAt = new Date();
  const creds = getCredentials();

  if (!params.to) {
    return vendorError<SendSmsResult>(VENDOR, 'NO_RECIPIENT', 'No phone number specified', { requestId });
  }

  if (!creds) {
    await logRequest({
      operation: 'send_sms_mock',
      requestId,
      startedAt,
      success: true,
      requestMeta: { to: params.to, bodyLength: params.body.length, mock: true },
    });
    return vendorSuccess({ messageSid: `mock-${requestId}` }, { requestId, durationMs: 0 });
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/Messages.json`;
  const authHeader = 'Basic ' + Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString('base64');

  const formBody = new URLSearchParams({
    To: params.to,
    From: creds.fromNumber,
    Body: params.body,
  });

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formBody.toString(),
      signal: AbortSignal.timeout(15_000),
    });

    const durationMs = Date.now() - startedAt.getTime();
    const data = await response.json() as Record<string, unknown>;

    if (response.status >= 200 && response.status < 300) {
      const messageSid = (data.sid as string) ?? requestId;
      await logRequest({
        operation: 'send_sms',
        requestId,
        startedAt,
        success: true,
        requestMeta: { to: params.to, from: creds.fromNumber },
        responseMeta: { status: response.status, sid: messageSid },
      });
      return vendorSuccess({ messageSid }, { requestId, durationMs });
    }

    const errorMessage = (data.message as string) ?? 'Twilio API error';
    await logRequest({
      operation: 'send_sms',
      requestId,
      startedAt,
      success: false,
      errorCategory: 'API_ERROR',
      requestMeta: { to: params.to, from: creds.fromNumber },
      responseMeta: { status: response.status, error: errorMessage },
    });

    return vendorError<SendSmsResult>(VENDOR, 'SEND_FAILED', `Twilio ${response.status}: ${errorMessage}`, {
      httpStatus: response.status,
      retryable: response.status >= 500,
      requestId,
      durationMs,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const durationMs = Date.now() - startedAt.getTime();

    await logRequest({
      operation: 'send_sms',
      requestId,
      startedAt,
      success: false,
      errorCategory: 'NETWORK',
      requestMeta: { to: params.to },
      responseMeta: { error: message },
    });

    return vendorError<SendSmsResult>(VENDOR, 'NETWORK_ERROR', message, {
      retryable: true,
      requestId,
      durationMs,
    });
  }
}
