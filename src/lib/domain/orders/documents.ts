import { db } from '@/lib/db/client';
import { docCategoryEnum, documents } from '@/lib/db/schema';
import { and, desc, eq, inArray, type SQL } from 'drizzle-orm';
import type { OrderSubresourceVisibility } from './subresource-visibility';

/** Client-safe docs: portal products + open-order confirmation email attachments. */
export const CLIENT_DOCUMENT_CATEGORIES = [
  'prelim',
  'cpl',
  'proposed_insured',
  'legal_vesting',
  'tax',
  'grant_deed',
] as const;

export type ClientDocumentCategory = (typeof CLIENT_DOCUMENT_CATEGORIES)[number];

const DOC_CATEGORIES = docCategoryEnum.enumValues;
export type DocCategory = (typeof DOC_CATEGORIES)[number];

export function isDocCategory(value: string): value is DocCategory {
  return (DOC_CATEGORIES as readonly string[]).includes(value);
}

export function isClientDocumentCategory(value: string): value is ClientDocumentCategory {
  return (CLIENT_DOCUMENT_CATEGORIES as readonly string[]).includes(value);
}

/** Canonical document row returned by getOrderDocuments (staff may include extra columns). */
export interface OrderDocument {
  id: number;
  category: string;
  filename: string;
  originalFilename: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  description: string | null;
  createdAt: Date | string;
  // Staff-only fields (present on staff policy; omitted for client)
  orderId?: number;
  storageProvider?: string | null;
  storageKey?: string | null;
  checksum?: string | null;
  status?: string;
  isSyncedToSoftpro?: boolean | null;
  softproSyncedAt?: Date | string | null;
  softproSyncError?: string | null;
  createdBy?: string | null;
  updatedAt?: Date | string | null;
}

export type GetOrderDocumentsResult =
  | { ok: true; documents: OrderDocument[] }
  | { ok: false; error: 'invalid_category' };

/**
 * Canonical order documents loader.
 * Client policy enforces the category whitelist inside this function (not in routes).
 */
export async function getOrderDocuments(
  orderId: number,
  visibility: OrderSubresourceVisibility,
  options?: { category?: string | null },
): Promise<GetOrderDocumentsResult> {
  if (visibility === 'client') {
    const docs = await db
      .select({
        id: documents.id,
        category: documents.category,
        filename: documents.filename,
        originalFilename: documents.originalFilename,
        contentType: documents.contentType,
        sizeBytes: documents.sizeBytes,
        description: documents.description,
        createdAt: documents.createdAt,
      })
      .from(documents)
      .where(
        and(
          eq(documents.orderId, orderId),
          eq(documents.status, 'active'),
          inArray(documents.category, [...CLIENT_DOCUMENT_CATEGORIES]),
        ),
      )
      .orderBy(desc(documents.createdAt));

    return { ok: true, documents: docs };
  }

  let category: DocCategory | null = null;
  const rawCategory = options?.category ?? null;
  if (rawCategory) {
    if (!isDocCategory(rawCategory)) {
      return { ok: false, error: 'invalid_category' };
    }
    category = rawCategory;
  }

  const conditions: SQL[] = [
    eq(documents.orderId, orderId),
    eq(documents.status, 'active'),
  ];
  if (category) {
    conditions.push(eq(documents.category, category));
  }

  const rows = await db
    .select()
    .from(documents)
    .where(and(...conditions))
    .orderBy(desc(documents.createdAt));

  return { ok: true, documents: rows };
}
