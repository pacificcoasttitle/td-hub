/**
 * Shared types for all vendor integrations.
 * Every adapter wraps results in VendorResult<T>. Never throw raw errors.
 */

export interface VendorResult<T> {
  success: boolean;
  data?: T;
  error?: VendorError;
  requestId?: string;
  durationMs?: number;
}

export interface VendorError {
  code: string;
  message: string;
  retryable: boolean;
  vendor: string;
  httpStatus?: number;
}

export interface VendorHealthResult {
  healthy: boolean;
  vendor: string;
  latencyMs: number;
  error?: string;
}

export interface VendorAdapter {
  readonly vendorName: string;
  healthCheck(): Promise<VendorHealthResult>;
}

/**
 * Helper to create a success result.
 */
export function vendorSuccess<T>(data: T, meta?: { requestId?: string; durationMs?: number }): VendorResult<T> {
  return { success: true, data, requestId: meta?.requestId, durationMs: meta?.durationMs };
}

/**
 * Helper to create an error result.
 */
export function vendorError<T>(
  vendor: string,
  code: string,
  message: string,
  opts?: { retryable?: boolean; httpStatus?: number; requestId?: string; durationMs?: number }
): VendorResult<T> {
  return {
    success: false,
    error: {
      code,
      message,
      retryable: opts?.retryable ?? false,
      vendor,
      httpStatus: opts?.httpStatus,
    },
    requestId: opts?.requestId,
    durationMs: opts?.durationMs,
  };
}
