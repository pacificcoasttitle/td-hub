import { db } from '@/lib/db/client';
import { contacts } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { contactNameToReportName } from '@/lib/domain/contacts/name-mapping';
import { getSalesScopedContactIds } from '@/lib/security/permissions';
import type { SessionUser } from '@/lib/security/auth';

export class SalesAccessError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export interface SalesAccessResult {
  contactId: number;
  repName: string;
  role: 'sales_rep' | 'sales_manager';
  contactIds?: number[];
  managedRepIds?: number[];
}

async function lookupContact(id: number) {
  const [row] = await db
    .select({ id: contacts.id, fullName: contacts.fullName })
    .from(contacts)
    .where(and(eq(contacts.id, id), eq(contacts.isSalesRep, true)))
    .limit(1);
  return row ?? null;
}

function toReportName(fullName: string | null): string {
  return contactNameToReportName(fullName);
}

export async function validateSalesAccess(
  session: SessionUser,
  requestedRepId?: string | null,
): Promise<SalesAccessResult> {
  if (session.role !== 'sales_rep' && session.role !== 'sales_manager') {
    throw new SalesAccessError('Forbidden', 403);
  }

  if (!session.contactId) {
    throw new SalesAccessError('Profile not linked to a contact', 403);
  }

  const ownContact = await lookupContact(session.contactId);
  if (!ownContact) {
    throw new SalesAccessError('No sales rep contact found', 403);
  }

  if (session.role === 'sales_rep') {
    if (requestedRepId && Number(requestedRepId) !== ownContact.id) {
      throw new SalesAccessError('Forbidden', 403);
    }
    return {
      contactId: ownContact.id,
      repName: toReportName(ownContact.fullName),
      role: 'sales_rep',
    };
  }

  const allTeamIds = await getSalesScopedContactIds(session);
  const managedIds = allTeamIds.filter((id) => id !== ownContact.id);

  if (!requestedRepId || requestedRepId === 'all') {
    return {
      contactId: ownContact.id,
      repName: toReportName(ownContact.fullName),
      role: 'sales_manager',
      contactIds: allTeamIds,
      managedRepIds: allTeamIds,
    };
  }

  const repId = Number(requestedRepId);
  if (isNaN(repId)) throw new SalesAccessError('Invalid repId', 400);

  if (repId === ownContact.id) {
    return {
      contactId: ownContact.id,
      repName: toReportName(ownContact.fullName),
      role: 'sales_manager',
      contactIds: [ownContact.id],
      managedRepIds: allTeamIds,
    };
  }

  if (!managedIds.includes(repId)) {
    throw new SalesAccessError('Forbidden', 403);
  }

  const targetContact = await lookupContact(repId);
  if (!targetContact) throw new SalesAccessError('Rep not found', 404);

  return {
    contactId: targetContact.id,
    repName: toReportName(targetContact.fullName),
    role: 'sales_manager',
    contactIds: [targetContact.id],
    managedRepIds: allTeamIds,
  };
}
