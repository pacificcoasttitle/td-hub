export type SoftProErrorCategory =
  | 'ok'
  | 'not_found'
  | 'validation'
  | 'timeout'
  | 'channel_fault'
  | 'auth'
  | 'unknown';

export function categorizeSoftProResponse(params: {
  bodyStatus?: number | null;
  message?: string | null;
  httpStatus?: number | null;
}): SoftProErrorCategory {
  const { bodyStatus, httpStatus } = params;
  const message = params.message?.toLowerCase() ?? '';

  if (
    bodyStatus === 401
    || httpStatus === 401
    || message.includes('invalid apikey')
    || message.includes('apikey is missing')
    || message.includes('api key is missing')
  ) {
    return 'auth';
  }

  if (bodyStatus === 200 && (!httpStatus || httpStatus < 400)) return 'ok';

  if (
    message.includes('order number does not exist')
    || message.includes('order was not found')
    || message.includes('order not found')
  ) {
    return 'not_found';
  }

  if (message.includes('cannot be null')) {
    return 'validation';
  }

  if (
    message.includes('request channel timed out')
    || message.includes('timed out')
    || message.includes('timeout')
  ) {
    return 'timeout';
  }

  if (message.includes('channel is in the faulted state')) {
    return 'channel_fault';
  }

  return 'unknown';
}

export function softProCategoryToErrorCode(category: SoftProErrorCategory): string {
  switch (category) {
    case 'ok':
      return 'OK';
    case 'not_found':
      return 'NOT_FOUND';
    case 'validation':
      return 'VALIDATION';
    case 'timeout':
      return 'TIMEOUT';
    case 'channel_fault':
      return 'CHANNEL_FAULT';
    case 'auth':
      return 'AUTH';
    case 'unknown':
      return 'UNKNOWN';
  }
}

export function isRetryableSoftProError(category: SoftProErrorCategory): boolean {
  switch (category) {
    case 'timeout':
    case 'channel_fault':
    case 'unknown':
      return true;
    case 'ok':
    case 'not_found':
    case 'validation':
    case 'auth':
      return false;
  }
}
