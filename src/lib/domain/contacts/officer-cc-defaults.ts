import { asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { officerCcDefaults } from '@/lib/db/schema';

export interface OfficerCcDefault {
  id: number;
  officerContactId: number;
  ccName: string | null;
  ccEmail: string;
  ccLabel: string | null;
  createdBy: string | null;
  createdAt: Date;
}

export interface OfficerCcDefaultInput {
  ccName?: string | null;
  ccEmail: string;
  ccLabel?: string | null;
}

function cleanOptional(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function cleanEmail(value: string): string {
  return value.trim().toLowerCase();
}

export async function getOfficerCcDefaults(officerContactId: number): Promise<OfficerCcDefault[]> {
  return db
    .select({
      id: officerCcDefaults.id,
      officerContactId: officerCcDefaults.officerContactId,
      ccName: officerCcDefaults.ccName,
      ccEmail: officerCcDefaults.ccEmail,
      ccLabel: officerCcDefaults.ccLabel,
      createdBy: officerCcDefaults.createdBy,
      createdAt: officerCcDefaults.createdAt,
    })
    .from(officerCcDefaults)
    .where(eq(officerCcDefaults.officerContactId, officerContactId))
    .orderBy(asc(officerCcDefaults.id));
}

export async function setOfficerCcDefaults(
  officerContactId: number,
  recipients: OfficerCcDefaultInput[],
  createdBy: string | null = null,
): Promise<OfficerCcDefault[]> {
  await db
    .delete(officerCcDefaults)
    .where(eq(officerCcDefaults.officerContactId, officerContactId));

  const values = recipients
    .map((recipient) => ({
      officerContactId,
      ccName: cleanOptional(recipient.ccName),
      ccEmail: cleanEmail(recipient.ccEmail),
      ccLabel: cleanOptional(recipient.ccLabel),
      createdBy,
    }))
    .filter((recipient) => recipient.ccEmail.length > 0);

  if (values.length > 0) {
    await db.insert(officerCcDefaults).values(values);
  }

  return getOfficerCcDefaults(officerContactId);
}
