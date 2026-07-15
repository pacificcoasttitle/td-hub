import { and, desc, eq, gte, lte, sql, type SQL } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { adminActivityLogs, notificationLogs, orderNotes, orders, vendorApiLogs } from '@/lib/db/schema';

export interface DeliveryLogParams {
  page: number;
  pageSize: number;
  type?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
}

export interface DeliveryLogRecipient {
  email: string;
  name: string | null;
  role: string | null;
  kind: 'to' | 'cc';
}

export interface DeliveryLogRow {
  id: string;
  source: 'admin_activity' | 'vendor_api' | 'notification_log';
  type: string;
  orderId: number | null;
  fileNumber: string | null;
  subject: string | null;
  recipients: DeliveryLogRecipient[];
  timestamp: string;
  status: 'sent' | 'failed' | 'pending' | 'skipped';
  sendgridMessageId: string | null;
  softproNoteId: string | null;
  softproSynced: boolean | null;
  proof: string | null;
}

export interface DeliveryLogResult {
  rows: DeliveryLogRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  types: string[];
}

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parseFileNumber(subject: string | null): string | null {
  if (!subject) return null;
  const fileMatch = subject.match(/\bFile\s+([A-Z0-9-]+)/i);
  if (fileMatch?.[1]) return fileMatch[1];
  const orderMatch = subject.match(/\bOrder\s+([A-Z0-9-]+)/i);
  if (orderMatch?.[1]) return orderMatch[1];
  return null;
}

function normalizeStatus(value: string | boolean | null | undefined): DeliveryLogRow['status'] {
  if (value === true) return 'sent';
  if (value === false) return 'failed';
  if (value === 'sent' || value === 'failed' || value === 'pending' || value === 'skipped') return value;
  return 'pending';
}

function recipientFromUnknown(value: unknown, kind: 'to' | 'cc'): DeliveryLogRecipient[] {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values.flatMap((item) => {
    if (typeof item === 'string') return [{ email: item, name: null, role: null, kind }];
    const record = asRecord(item);
    const email = asString(record.email);
    if (!email) return [];
    return [{
      email,
      name: asString(record.name),
      role: asString(record.role),
      kind,
    }];
  });
}

function prelimRecipients(meta: JsonRecord): DeliveryLogRecipient[] {
  const recipients = Array.isArray(meta.recipients) ? meta.recipients : [];
  return recipients.flatMap((item) => {
    const record = asRecord(item);
    const email = asString(record.email);
    const kind = asString(record.kind);
    if (!email || (kind !== 'to' && kind !== 'cc')) return [];
    return [{
      email,
      name: asString(record.name),
      role: asString(record.role),
      kind,
    }];
  });
}

function vendorRecipients(meta: JsonRecord): DeliveryLogRecipient[] {
  return [
    ...recipientFromUnknown(meta.to, 'to'),
    ...recipientFromUnknown(meta.cc, 'cc'),
  ];
}

function compactText(row: DeliveryLogRow): string {
  return [
    row.type,
    row.fileNumber,
    row.subject,
    row.sendgridMessageId,
    row.softproNoteId,
    row.recipients.map((r) => `${r.name ?? ''} ${r.email} ${r.role ?? ''}`).join(' '),
  ].filter(Boolean).join(' ').toLowerCase();
}

function dateFromInput(value: string | undefined, endOfDay = false): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    date.setHours(23, 59, 59, 999);
  }
  return date;
}

function prelimOrderId(row: { entityId: string | null; orderId: number | null }): number | null {
  if (row.orderId) return row.orderId;
  const id = Number(row.entityId);
  return Number.isFinite(id) ? id : null;
}

export async function getDeliveryLog(params: DeliveryLogParams): Promise<DeliveryLogResult> {
  const from = dateFromInput(params.dateFrom);
  const to = dateFromInput(params.dateTo, true);
  const prelimConditions: SQL[] = [eq(adminActivityLogs.action, 'prelim_delivered')];
  const vendorConditions: SQL[] = [eq(vendorApiLogs.vendor, 'sendgrid')];
  const notificationConditions: SQL[] = [];

  if (from) {
    prelimConditions.push(gte(adminActivityLogs.createdAt, from));
    vendorConditions.push(gte(vendorApiLogs.createdAt, from));
    notificationConditions.push(gte(notificationLogs.createdAt, from));
  }
  if (to) {
    prelimConditions.push(lte(adminActivityLogs.createdAt, to));
    vendorConditions.push(lte(vendorApiLogs.createdAt, to));
    notificationConditions.push(lte(notificationLogs.createdAt, to));
  }

  const [prelimRows, vendorRows, notificationRows] = await Promise.all([
    db
      .select({
        id: adminActivityLogs.id,
        entityId: adminActivityLogs.entityId,
        meta: adminActivityLogs.meta,
        createdAt: adminActivityLogs.createdAt,
        orderId: orders.id,
        fileNumber: orders.fileNumber,
        softproSynced: sql<boolean | null>`bool_or(${orderNotes.isSyncedToSoftpro})`,
      })
      .from(adminActivityLogs)
      .leftJoin(orders, sql`${orders.id}::text = ${adminActivityLogs.entityId}`)
      .leftJoin(orderNotes, eq(orderNotes.softproNoteId, sql`${adminActivityLogs.meta}->>'softpro_note_id'`))
      .where(and(...prelimConditions))
      .groupBy(adminActivityLogs.id, orders.id)
      .orderBy(desc(adminActivityLogs.createdAt))
      .limit(500),
    db
      .select({
        id: vendorApiLogs.id,
        operation: vendorApiLogs.operation,
        orderId: vendorApiLogs.orderId,
        requestId: vendorApiLogs.requestId,
        requestMeta: vendorApiLogs.requestMeta,
        responseMeta: vendorApiLogs.responseMeta,
        success: vendorApiLogs.success,
        createdAt: vendorApiLogs.createdAt,
        fileNumber: orders.fileNumber,
      })
      .from(vendorApiLogs)
      .leftJoin(orders, eq(vendorApiLogs.orderId, orders.id))
      .where(and(...vendorConditions))
      .orderBy(desc(vendorApiLogs.createdAt))
      .limit(500),
    db
      .select({
        id: notificationLogs.id,
        eventType: notificationLogs.eventType,
        orderId: notificationLogs.orderId,
        recipientEmail: notificationLogs.recipientEmail,
        recipientName: notificationLogs.recipientName,
        recipientRole: notificationLogs.recipientRole,
        subject: notificationLogs.subject,
        status: notificationLogs.status,
        provider: notificationLogs.provider,
        providerId: notificationLogs.providerId,
        createdAt: notificationLogs.createdAt,
        sentAt: notificationLogs.sentAt,
        fileNumber: orders.fileNumber,
      })
      .from(notificationLogs)
      .leftJoin(orders, eq(notificationLogs.orderId, orders.id))
      .where(notificationConditions.length > 0 ? and(...notificationConditions) : undefined)
      .orderBy(desc(notificationLogs.createdAt))
      .limit(500),
  ]);

  const prelimByMessageId = new Map<string, DeliveryLogRow>();
  const rows: DeliveryLogRow[] = prelimRows.map((row) => {
    const meta = asRecord(row.meta);
    const sendgridMessageId = asString(meta.sendgrid_message_id);
    const softproNoteId = asString(meta.softpro_note_id);
    const deliveryRow: DeliveryLogRow = {
      id: `prelim-${row.id}`,
      source: 'admin_activity',
      type: 'prelim_delivered',
      orderId: prelimOrderId(row),
      fileNumber: row.fileNumber,
      subject: 'Preliminary Title Report delivered',
      recipients: prelimRecipients(meta),
      timestamp: row.createdAt.toISOString(),
      status: 'sent',
      sendgridMessageId,
      softproNoteId,
      softproSynced: row.softproSynced,
      proof: [
        sendgridMessageId ? `SendGrid ${sendgridMessageId}` : null,
        softproNoteId ? `SoftPro ${softproNoteId}${row.softproSynced ? ' synced' : ' pending'}` : null,
      ].filter(Boolean).join(' · ') || null,
    };
    if (sendgridMessageId) prelimByMessageId.set(sendgridMessageId, deliveryRow);
    return deliveryRow;
  });

  const orderByFile = new Map<string, number>();
  for (const row of [...prelimRows, ...vendorRows, ...notificationRows]) {
    if (row.fileNumber && row.orderId) orderByFile.set(row.fileNumber, row.orderId);
  }

  for (const row of vendorRows) {
    const requestMeta = asRecord(row.requestMeta);
    const responseMeta = asRecord(row.responseMeta);
    const messageId = asString(responseMeta.messageId)
      ?? (row.operation === 'send_email_mock' && row.requestId ? `mock-${row.requestId}` : null);
    if (messageId && prelimByMessageId.has(messageId)) continue;
    const subject = asString(requestMeta.subject);
    const parsedFile = parseFileNumber(subject);
    rows.push({
      id: `vendor-${row.id}`,
      source: 'vendor_api',
      type: row.operation,
      orderId: row.orderId ?? (parsedFile ? orderByFile.get(parsedFile) ?? null : null),
      fileNumber: row.fileNumber ?? parsedFile,
      subject,
      recipients: vendorRecipients(requestMeta),
      timestamp: row.createdAt.toISOString(),
      status: normalizeStatus(row.success),
      sendgridMessageId: messageId,
      softproNoteId: null,
      softproSynced: null,
      proof: messageId ? `SendGrid ${messageId}` : null,
    });
  }

  for (const row of notificationRows) {
    const messageId = row.provider === 'sendgrid' ? row.providerId : null;
    if (messageId && prelimByMessageId.has(messageId)) continue;
    const parsedFile = parseFileNumber(row.subject);
    rows.push({
      id: `notification-${row.id}`,
      source: 'notification_log',
      type: row.eventType,
      orderId: row.orderId ?? (parsedFile ? orderByFile.get(parsedFile) ?? null : null),
      fileNumber: row.fileNumber ?? parsedFile,
      subject: row.subject,
      recipients: row.recipientEmail ? [{
        email: row.recipientEmail,
        name: row.recipientName,
        role: row.recipientRole,
        kind: 'to',
      }] : [],
      timestamp: (row.sentAt ?? row.createdAt).toISOString(),
      status: normalizeStatus(row.status),
      sendgridMessageId: messageId,
      softproNoteId: null,
      softproSynced: null,
      proof: messageId ? `SendGrid ${messageId}` : null,
    });
  }

  const search = params.search?.trim().toLowerCase();
  const filtered = rows
    .filter((row) => !params.type || row.type === params.type)
    .filter((row) => !search || compactText(row).includes(search))
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  const total = filtered.length;
  const offset = (params.page - 1) * params.pageSize;

  return {
    rows: filtered.slice(offset, offset + params.pageSize),
    total,
    page: params.page,
    pageSize: params.pageSize,
    totalPages: Math.max(1, Math.ceil(total / params.pageSize)),
    types: Array.from(new Set(rows.map((row) => row.type))).sort(),
  };
}
