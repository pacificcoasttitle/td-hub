export * from './types';
export * from './mapper';

// Re-export client functions
// Use mock in development if SOFTPRO_API_URL is not set
const useMock = !process.env.SOFTPRO_API_URL;

export async function getOrderDetails(params: Parameters<typeof import('./client').getOrderDetails>[0]) {
  if (useMock) {
    const mock = await import('./mock');
    return mock.getOrderDetails(params);
  }
  const client = await import('./client');
  return client.getOrderDetails(params);
}

export async function getOrderStatuses(params: Parameters<typeof import('./client').getOrderStatuses>[0]) {
  if (useMock) {
    const mock = await import('./mock');
    return mock.getOrderStatuses(params);
  }
  const client = await import('./client');
  return client.getOrderStatuses(params);
}

export async function healthCheck() {
  if (useMock) {
    const mock = await import('./mock');
    return mock.healthCheck();
  }
  const client = await import('./client');
  return client.healthCheck();
}
