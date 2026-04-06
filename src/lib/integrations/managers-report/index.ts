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

export async function getClosings(month?: number, year?: number, repName?: string) {
  if (useMock) {
    const mock = await import('./mock');
    return mock.getClosings(month, year, repName);
  }
  const client = await import('./client');
  return client.getClosings(month, year, repName);
}

export async function getProductionHistory(year?: number, repName?: string) {
  if (useMock) {
    const mock = await import('./mock');
    return mock.getProductionHistory(year, repName);
  }
  const client = await import('./client');
  return client.getProductionHistory(year, repName);
}

export async function getTrends(repName?: string) {
  if (useMock) {
    const mock = await import('./mock');
    return mock.getTrends(repName);
  }
  const client = await import('./client');
  return client.getTrends(repName);
}

export async function getClientSummary(year: number, repName?: string) {
  if (useMock) {
    const mock = await import('./mock');
    return mock.getClientSummary(year, repName);
  }
  const client = await import('./client');
  return client.getClientSummary(year, repName);
}

export async function healthCheck() {
  if (useMock) {
    const mock = await import('./mock');
    return mock.healthCheck();
  }
  const client = await import('./client');
  return client.healthCheck();
}
