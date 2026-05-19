import { handleSyncContacts, type SyncContactsResult } from './sync-contacts';

const ALL_ENTITY_TYPES = [
  'Order Contact - Person',
  'Title Officer',
  'Escrow Officer',
  'Sales Rep',
  'Escrow Company',
  'Lender',
  'Mortgage Broker',
  'Underwriter',
];

export interface SyncAllContactsResult {
  results: SyncContactsResult[];
  totalCreated: number;
  totalUpdated: number;
  totalErrors: number;
}

export async function handleSyncAllContacts(): Promise<SyncAllContactsResult> {
  const results: SyncContactsResult[] = [];
  let totalCreated = 0;
  let totalUpdated = 0;
  let totalErrors = 0;

  for (const entityType of ALL_ENTITY_TYPES) {
    const result = await handleSyncContacts({ entityType });
    results.push(result);
    totalCreated += result.created;
    totalUpdated += result.updated;
    totalErrors += result.errors.length;
  }

  return { results, totalCreated, totalUpdated, totalErrors };
}
