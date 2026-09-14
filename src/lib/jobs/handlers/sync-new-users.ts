import { db } from '@/lib/db/client';
import { contacts } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { getLookupTable, mapLookupTableEntry } from '@/lib/integrations/softpro';
import { describeSyncError } from './sync-contacts';

export interface SyncNewUsersResult {
  newContacts: number;
  updatedContacts: number;
  entityTypesChecked: string[];
  errors: Array<{ entityType: string; error: string }>;
}

const ENTITY_TYPES: Array<{ userType: string; role: string }> = [
  { userType: 'Title Officer', role: 'title_officer' },
  { userType: 'Escrow Officer', role: 'escrow_officer' },
  { userType: 'Sales Representative', role: 'sales_rep' },
];

export async function handleSyncNewUsers(): Promise<SyncNewUsersResult> {
  let newContacts = 0;
  let updatedContacts = 0;
  const entityTypesChecked: string[] = [];
  const errors: Array<{ entityType: string; error: string }> = [];

  for (const entityType of ENTITY_TYPES) {
    try {
      const result = await getLookupTable(entityType.userType);
      if (!result.success || !result.data) {
        errors.push({ entityType: entityType.userType, error: 'Failed to fetch lookup table' });
        continue;
      }

      entityTypesChecked.push(entityType.userType);

      for (const rawItem of result.data) {
        const mapped = mapLookupTableEntry(rawItem);
        const lookupCode = mapped.code;
        if (!lookupCode) continue;

        const [existing] = await db
          .select({ id: contacts.id, fullName: contacts.fullName, email: contacts.email })
          .from(contacts)
          .where(eq(contacts.softproLookupCode, lookupCode))
          .limit(1);

        if (existing) {
          const nameChanged = mapped.officerName && mapped.officerName !== existing.fullName;
          const emailChanged = mapped.email && mapped.email !== existing.email;

          if (nameChanged || emailChanged) {
            await db.update(contacts).set({
              ...(nameChanged ? { fullName: mapped.officerName } : {}),
              ...(emailChanged ? { email: mapped.email } : {}),
              updatedAt: new Date(),
            }).where(eq(contacts.id, existing.id));
            updatedContacts++;
          }
        } else {
          const nameParts = (mapped.officerName ?? '').split(/\s*,\s*/);
          const lastName = nameParts[0] ?? '';
          const firstName = nameParts[1] ?? '';

          await db.insert(contacts).values({
            sourceSystem: 'softpro',
            type: 'officer',
            firstName: firstName || null,
            lastName: lastName || null,
            fullName: mapped.officerName ?? lookupCode,
            email: mapped.email ?? null,
            softproLookupCode: lookupCode,
            softproUserType: entityType.userType,
            roles: [entityType.role],
          });
          newContacts++;
        }
      }
    } catch (err) {
      errors.push({
        entityType: entityType.userType,
        error: describeSyncError(err),
      });
    }
  }

  return { newContacts, updatedContacts, entityTypesChecked, errors };
}
