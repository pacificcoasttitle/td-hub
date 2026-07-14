export * from './types';
export * from './mapper';
export * from './auth';
import type { VendorResult } from '../types';
import type { SoftProLookupItem, SoftProLookupTablePage, SoftProLookupTableRequest } from './types';

const useMock = !process.env.SOFTPRO_API_URL;

export async function createOrder(payload: Record<string, unknown>) {
  if (useMock) {
    const { vendorSuccess } = await import('../types');
    const tx = (payload as Record<string, Record<string, unknown>>).transactionDetails ?? {};
    const branch = (tx.LookUpCodeTitleOffice as string) ?? 'GLT';
    const mockFileNumber = `MOCK-${Date.now()}-${branch}`;
    return vendorSuccess({ orderNumber: mockFileNumber }, { requestId: 'mock-' + crypto.randomUUID(), durationMs: 0 });
  }
  const client = await import('./client');
  return client.createOrder(payload);
}

export async function registerSoftProToken(params?: Parameters<typeof import('./client').registerSoftProToken>[0]) {
  if (useMock) {
    throw new Error('registerSoftProToken is not available in mock mode');
  }
  const client = await import('./client');
  return client.registerSoftProToken(params);
}

export async function getOrders(params: Parameters<typeof import('./client').getOrders>[0]) {
  if (useMock) {
    const mock = await import('./mock');
    return mock.getOrders(params);
  }
  const client = await import('./client');
  return client.getOrders(params);
}

export async function getOrderDetails(params: Parameters<typeof import('./client').getOrderDetails>[0]) {
  if (useMock) {
    const { vendorSuccess } = await import('../types');
    type Detail = import('./types').SoftProOrderDetailItem;
    return vendorSuccess([] as Detail[], { requestId: 'mock-' + crypto.randomUUID(), durationMs: 0 });
  }
  const client = await import('./client');
  return client.getOrderDetails(params);
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

export async function getLookupTable(userType: string): Promise<VendorResult<SoftProLookupItem[]>>;
export async function getLookupTable(params: SoftProLookupTableRequest): Promise<VendorResult<SoftProLookupTablePage>>;
export async function getLookupTable(
  params: string | SoftProLookupTableRequest,
): Promise<VendorResult<SoftProLookupItem[] | SoftProLookupTablePage>> {
  if (useMock) {
    const mock = await import('./mock');
    return typeof params === 'string'
      ? mock.getLookupTable(params)
      : mock.getLookupTable(params);
  }
  const client = await import('./client');
  return typeof params === 'string'
    ? client.getLookupTable(params)
    : client.getLookupTable(params);
}

export async function uploadDocument(params: Parameters<typeof import('./client').uploadDocument>[0]) {
  if (useMock) {
    throw new Error('uploadDocument is not available in mock mode');
  }
  const client = await import('./client');
  return client.uploadDocument(params);
}

export async function getFees(orderNumber: string) {
  if (useMock) {
    const mock = await import('./mock');
    return mock.getFees(orderNumber);
  }
  const client = await import('./client');
  return client.getFees(orderNumber);
}

export async function addNotes(orderNumber: string, text: string, noteId?: string) {
  if (useMock) {
    const mock = await import('./mock');
    return mock.addNotes(orderNumber, text, noteId);
  }
  const client = await import('./client');
  return client.addNotes(orderNumber, text, noteId);
}

export async function getSalesReps() {
  if (useMock) {
    const { vendorSuccess } = await import('../types');
    return vendorSuccess([] as Record<string, string>[], { requestId: 'mock-' + crypto.randomUUID(), durationMs: 0 });
  }
  const client = await import('./client');
  return client.getSalesReps();
}

export async function createUser(payload: Record<string, unknown>) {
  if (useMock) {
    const { vendorSuccess } = await import('../types');
    return vendorSuccess({ message: 'Mock user created' }, { requestId: 'mock-' + crypto.randomUUID(), durationMs: 0 });
  }
  const client = await import('./client');
  return client.createUser(payload);
}

export async function updateUser(payload: Record<string, unknown>) {
  if (useMock) {
    const { vendorSuccess } = await import('../types');
    return vendorSuccess({ message: 'Mock user updated' }, { requestId: 'mock-' + crypto.randomUUID(), durationMs: 0 });
  }
  const client = await import('./client');
  return client.updateUser(payload);
}

export async function addCompany(payload: Record<string, unknown>) {
  if (useMock) {
    const { vendorSuccess } = await import('../types');
    return vendorSuccess({ message: 'Mock company created' }, { requestId: 'mock-' + crypto.randomUUID(), durationMs: 0 });
  }
  const client = await import('./client');
  return client.addCompany(payload);
}

export async function updateCompany(payload: Record<string, unknown>) {
  if (useMock) {
    const { vendorSuccess } = await import('../types');
    return vendorSuccess({ message: 'Mock company updated' }, { requestId: 'mock-' + crypto.randomUUID(), durationMs: 0 });
  }
  const client = await import('./client');
  return client.updateCompany(payload);
}

export async function getOrderStatusList() {
  if (useMock) {
    const { vendorSuccess } = await import('../types');
    return vendorSuccess(['Open', 'Closed', 'Cancelled'] as string[], { requestId: 'mock-' + crypto.randomUUID(), durationMs: 0 });
  }
  const client = await import('./client');
  return client.getOrderStatusList();
}

export async function healthCheck() {
  if (useMock) {
    const mock = await import('./mock');
    return mock.healthCheck();
  }
  const client = await import('./client');
  return client.healthCheck();
}
