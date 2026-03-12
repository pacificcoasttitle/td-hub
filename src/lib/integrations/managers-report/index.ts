export * from './types';

const useMock = !process.env.MANAGERS_REPORT_API_URL;

export async function getRepFigures(
  repName: string,
  month?: string,
) {
  if (useMock) {
    const mock = await import('./mock');
    return mock.getRepFigures(repName, month);
  }
  const client = await import('./client');
  return client.getRepFigures(repName, month);
}

export async function getLeaderboard(month?: string, limit?: number) {
  if (useMock) {
    const mock = await import('./mock');
    return mock.getLeaderboard(month, limit);
  }
  const client = await import('./client');
  return client.getLeaderboard(month, limit);
}

export async function healthCheck() {
  if (useMock) {
    const mock = await import('./mock');
    return mock.healthCheck();
  }
  const client = await import('./client');
  return client.healthCheck();
}
