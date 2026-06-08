import type { VendorResult } from '../types';

export type SoftProUserContext = 'interactive' | 'cron';

const USER_ID_FIELD = 'UserId';
const REDACTED_AUTH_VALUE = '[redacted]';

export class SoftProConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SoftProConfigError';
  }
}

function readEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

export function getSoftProToken(options: { required?: boolean } = {}): string | null {
  const token = readEnv('SOFTPRO_TOKEN');
  if (!token && options.required) {
    throw new SoftProConfigError('SOFTPRO_TOKEN is required for SoftPro write operations');
  }
  return token;
}

export function getSoftProUserId(context: SoftProUserContext = 'interactive'): string {
  const userId = context === 'cron'
    ? readEnv('SOFTPRO_CRON_USER_ID') ?? readEnv('SOFTPRO_USER_ID')
    : readEnv('SOFTPRO_USER_ID');

  if (!userId) {
    throw new SoftProConfigError(`SOFTPRO_USER_ID is required for SoftPro ${context} write operations`);
  }

  return userId;
}

export function buildSoftProHeaders(options: { requireToken?: boolean } = {}): Record<string, string> {
  const token = getSoftProToken({ required: options.requireToken });
  return token ? { 'X-API-KEY': token } : {};
}

export function addSoftProUserIdToRecord(
  payload: Record<string, unknown>,
  context: SoftProUserContext = 'interactive',
): Record<string, unknown> {
  // Adapter-auth casing is based on the API team's CreateUserToken example:
  // { "UserId": "TD_Hub", "Token": "...", "TokenStatus": 1 }.
  return {
    ...payload,
    [USER_ID_FIELD]: getSoftProUserId(context),
  };
}

export function addSoftProUserIdToRecords(
  payload: Array<Record<string, unknown>>,
  context: SoftProUserContext = 'interactive',
): Array<Record<string, unknown>> {
  const userId = getSoftProUserId(context);
  return payload.map((item) => ({ ...item, [USER_ID_FIELD]: userId }));
}

export function addSoftProUserIdToWritePayload(
  payload: unknown,
  context: SoftProUserContext = 'interactive',
): unknown {
  if (Array.isArray(payload)) {
    const userId = getSoftProUserId(context);
    return payload.map((item) => (
      item !== null && typeof item === 'object'
        ? { ...(item as Record<string, unknown>), [USER_ID_FIELD]: userId }
        : item
    ));
  }

  if (payload !== null && typeof payload === 'object') {
    return addSoftProUserIdToRecord(payload as Record<string, unknown>, context);
  }

  return payload;
}

export function redactSoftProAuthFields(payload: unknown): unknown {
  if (Array.isArray(payload)) {
    return payload.map((item) => redactSoftProAuthFields(item));
  }

  if (payload !== null && typeof payload === 'object') {
    const redacted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload)) {
      if (key === USER_ID_FIELD || key === 'Token') {
        redacted[key] = REDACTED_AUTH_VALUE;
      } else {
        redacted[key] = redactSoftProAuthFields(value);
      }
    }
    return redacted;
  }

  return payload;
}

export function generateSoftProToken(): string {
  return `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '');
}

export interface RegisterSoftProTokenParams {
  userId?: string;
  token?: string;
  tokenStatus?: 1 | 0;
}

export interface RegisterSoftProTokenResult {
  userId: string;
  token: string;
  tokenStatus: 1 | 0;
}

export type RegisterSoftProToken = (
  params?: RegisterSoftProTokenParams,
) => Promise<VendorResult<RegisterSoftProTokenResult>>;

/**
 * Rotation runbook:
 * 1. Register a temporary id, e.g. { userId: 'TD_Hub_New' }.
 * 2. Store the returned token in SOFTPRO_TOKEN and set SOFTPRO_USER_ID=TD_Hub_New.
 * 3. Verify reads and writes with the new env values.
 * 4. Register/expire the old id with TokenStatus: 0 when the cutover is confirmed.
 *
 * Never call token registration on boot/deploy. Registering a new token for an
 * existing UserId expires the prior token in the adapter phpNetAuth table.
 */
