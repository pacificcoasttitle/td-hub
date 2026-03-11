export * from './types';
export * from './mapper';

const useMock = !process.env.SOFTPRO_API_URL;

export async function getOrders(params: Parameters<typeof import('./client').getOrders>[0]) {
  if (useMock) {
    const mock = await import('./mock');
    return mock.getOrders(params);
  }
  const client = await import('./client');
  return client.getOrders(params);
}

export async function getOrderContacts(orderNumber: string) {
  if (useMock) {
    const mock = await import('./mock');
    return mock.getOrderContacts(orderNumber);
  }
  const client = await import('./client');
  return client.getOrderContacts(orderNumber);
}

export async function getAttachedDocuments(orderNumber: string) {
  if (useMock) {
    const mock = await import('./mock');
    return mock.getAttachedDocuments(orderNumber);
  }
  const client = await import('./client');
  return client.getAttachedDocuments(orderNumber);
}

export async function getLookupTable(userType: Parameters<typeof import('./client').getLookupTable>[0]) {
  if (useMock) {
    const mock = await import('./mock');
    return mock.getLookupTable(userType);
  }
  const client = await import('./client');
  return client.getLookupTable(userType);
}

export async function uploadDocument(params: Parameters<typeof import('./client').uploadDocument>[0]) {
  if (useMock) {
    throw new Error('uploadDocument is not available in mock mode');
  }
  const client = await import('./client');
  return client.uploadDocument(params);
}

export async function healthCheck() {
  if (useMock) {
    const mock = await import('./mock');
    return mock.healthCheck();
  }
  const client = await import('./client');
  return client.healthCheck();
}
