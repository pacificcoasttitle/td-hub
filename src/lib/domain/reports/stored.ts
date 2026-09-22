/**
 * Reading back a farming report that has been generated.
 *
 * The PDF is found from the report's TYPE and ID, server-side. No storage key
 * or URL is ever accepted from the browser — the legacy defect was a page that
 * posted an S3 URL and a server that obliged, and its reports sat at public,
 * guessable URLs.
 */
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { carrierRouteReports, countySalesReports, salesActivityReports } from '@/lib/db/schema';

export const FARMING_TYPES = ['sales_activity', 'carrier_route', 'county_sales'] as const;
export type FarmingType = typeof FARMING_TYPES[number];

const TABLES = {
  sales_activity: salesActivityReports,
  carrier_route: carrierRouteReports,
  county_sales: countySalesReports,
} as const;

export function isFarmingType(v: string): v is FarmingType {
  return (FARMING_TYPES as readonly string[]).includes(v);
}

/** "Santa Monica - 6 months to August 2026" → a file name a person can read. */
export function pdfFilename(subject: string | null, settings: string | null, type: FarmingType): string {
  const slug = [subject, settings].filter(Boolean).join(' ')
    .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
  return `${slug || type.replace('_', '-')}.pdf`;
}

export async function getFarmingPdf(type: FarmingType, id: number): Promise<
  | { ok: true; key: string; filename: string }
  | { ok: false; reason: 'not_found' | 'no_document'; status: string | null }
> {
  const t = TABLES[type];
  const [row] = await db.select({
    key: t.pdfStorageKey, status: t.status, subject: t.listSubject, settings: t.listSettings,
  }).from(t).where(eq(t.id, id)).limit(1);
  if (!row) return { ok: false, reason: 'not_found', status: null };
  if (!row.key) return { ok: false, reason: 'no_document', status: row.status };
  return { ok: true, key: row.key, filename: pdfFilename(row.subject, row.settings, type) };
}

/** What Notify rep needs, read from the report row — never from the browser. */
export interface NotifyTarget {
  status: string;
  pdfKey: string | null;
  repName: string;
  repEmail: string | null;
  subject: string | null;
  subjectDetail: string | null;
  settings: string | null;
  filename: string;
}

export async function getNotifyTarget(type: FarmingType, id: number): Promise<NotifyTarget | null> {
  const t = TABLES[type];
  const [row] = await db.select({
    status: t.status, pdfKey: t.pdfStorageKey,
    repName: t.brandedToName, repEmail: t.brandedToEmail,
    subject: t.listSubject, subjectDetail: t.listSubjectDetail, settings: t.listSettings,
  }).from(t).where(eq(t.id, id)).limit(1);
  if (!row) return null;
  return { ...row, filename: pdfFilename(row.subject, row.settings, type) };
}
