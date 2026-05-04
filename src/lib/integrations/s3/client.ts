import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl as awsGetSignedUrl } from '@aws-sdk/s3-request-presigner';
import { VendorResult, vendorSuccess, vendorError } from '../types';
import { db } from '@/lib/db/client';
import { vendorApiLogs } from '@/lib/db/schema';

const VENDOR = 's3';

function getClient(): S3Client {
  return new S3Client({
    region: process.env.AWS_REGION ?? 'us-west-2',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
    },
  });
}

function getBucket(): string {
  const bucket = process.env.AWS_BUCKET;
  if (!bucket) throw new Error('AWS_BUCKET is not configured');
  return bucket;
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

// ─── Public API ──────────────────────────────────────────────────────────────

export async function uploadFile(params: {
  key: string;
  buffer: Buffer;
  contentType: string;
}): Promise<VendorResult<string>> {
  const requestId = crypto.randomUUID();
  const startedAt = new Date();
  const bucket = getBucket();

  try {
    await getClient().send(new PutObjectCommand({
      Bucket: bucket,
      Key: params.key,
      Body: params.buffer,
      ContentType: params.contentType,
    }));

    const url = `https://${bucket}.s3.${process.env.AWS_REGION ?? 'us-west-2'}.amazonaws.com/${params.key}`;

    await logRequest({
      operation: 'upload',
      requestId,
      startedAt,
      success: true,
      requestMeta: { key: params.key, contentType: params.contentType, sizeBytes: params.buffer.length },
    });

    return vendorSuccess(url, { requestId, durationMs: Date.now() - startedAt.getTime() });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown S3 upload error';
    await logRequest({
      operation: 'upload',
      requestId,
      startedAt,
      success: false,
      errorCategory: 'S3_UPLOAD',
      responseMeta: { error: message },
    });
    return vendorError<string>(VENDOR, 'UPLOAD_FAILED', message, {
      retryable: true, requestId, durationMs: Date.now() - startedAt.getTime(),
    });
  }
}

export async function getObjectStream(key: string): Promise<VendorResult<{
  body: ReadableStream;
  contentType?: string;
  contentLength?: number;
}>> {
  const requestId = crypto.randomUUID();
  const startedAt = new Date();

  try {
    const response = await getClient().send(new GetObjectCommand({
      Bucket: getBucket(),
      Key: key,
    }));

    if (!response.Body) {
      throw new Error('S3 response has no body');
    }

    await logRequest({
      operation: 'get_object_stream',
      requestId,
      startedAt,
      success: true,
      requestMeta: { key },
    });

    return vendorSuccess(
      {
        body: response.Body as unknown as ReadableStream,
        contentType: response.ContentType,
        contentLength: response.ContentLength,
      },
      { requestId, durationMs: Date.now() - startedAt.getTime() },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown S3 stream error';
    await logRequest({
      operation: 'get_object_stream',
      requestId,
      startedAt,
      success: false,
      errorCategory: 'S3_DOWNLOAD',
      responseMeta: { error: message },
    });
    return vendorError(VENDOR, 'STREAM_FAILED', message, {
      retryable: true, requestId, durationMs: Date.now() - startedAt.getTime(),
    });
  }
}

export async function downloadFile(key: string): Promise<VendorResult<Buffer>> {
  const requestId = crypto.randomUUID();
  const startedAt = new Date();

  try {
    const response = await getClient().send(new GetObjectCommand({
      Bucket: getBucket(),
      Key: key,
    }));

    const bytes = await response.Body!.transformToByteArray();
    const buffer = Buffer.from(bytes);

    await logRequest({
      operation: 'download',
      requestId,
      startedAt,
      success: true,
      requestMeta: { key },
    });

    return vendorSuccess(buffer, { requestId, durationMs: Date.now() - startedAt.getTime() });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown S3 download error';
    await logRequest({
      operation: 'download',
      requestId,
      startedAt,
      success: false,
      errorCategory: 'S3_DOWNLOAD',
      responseMeta: { error: message },
    });
    return vendorError<Buffer>(VENDOR, 'DOWNLOAD_FAILED', message, {
      retryable: true, requestId, durationMs: Date.now() - startedAt.getTime(),
    });
  }
}

export async function deleteFile(key: string): Promise<VendorResult<void>> {
  const requestId = crypto.randomUUID();
  const startedAt = new Date();

  try {
    await getClient().send(new DeleteObjectCommand({
      Bucket: getBucket(),
      Key: key,
    }));

    await logRequest({
      operation: 'delete',
      requestId,
      startedAt,
      success: true,
      requestMeta: { key },
    });

    return vendorSuccess(undefined as void, { requestId, durationMs: Date.now() - startedAt.getTime() });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown S3 delete error';
    await logRequest({
      operation: 'delete',
      requestId,
      startedAt,
      success: false,
      errorCategory: 'S3_DELETE',
      responseMeta: { error: message },
    });
    return vendorError<void>(VENDOR, 'DELETE_FAILED', message, {
      retryable: false, requestId, durationMs: Date.now() - startedAt.getTime(),
    });
  }
}

export async function getSignedUrl(
  key: string,
  expiresIn = 3600
): Promise<VendorResult<string>> {
  const requestId = crypto.randomUUID();
  const startedAt = new Date();

  try {
    const command = new GetObjectCommand({ Bucket: getBucket(), Key: key });
    const url = await awsGetSignedUrl(getClient(), command, { expiresIn });

    await logRequest({
      operation: 'get_signed_url',
      requestId,
      startedAt,
      success: true,
      requestMeta: { key, expiresIn },
    });

    return vendorSuccess(url, { requestId, durationMs: Date.now() - startedAt.getTime() });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown S3 presign error';
    await logRequest({
      operation: 'get_signed_url',
      requestId,
      startedAt,
      success: false,
      errorCategory: 'S3_PRESIGN',
      responseMeta: { error: message },
    });
    return vendorError<string>(VENDOR, 'PRESIGN_FAILED', message, {
      retryable: false, requestId, durationMs: Date.now() - startedAt.getTime(),
    });
  }
}
