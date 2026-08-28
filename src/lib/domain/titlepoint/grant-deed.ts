import { db } from '@/lib/db/client';
import { titlePointData } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { uploadDocument, maybeAttachTitleDocsToSoftPro } from '@/lib/domain/documents/service';
import { getDocumentsByParameters3 } from '@/lib/integrations/titlepoint/client-image';
import { getSetting } from '@/lib/domain/settings/service';

// ─── Deed Type Filter ───────────────────────────────────────────────────────

const FILTERED_DEED_TYPES = [
  'grant deed',
  'quit claim deed',
  'intrafamily transfer & dissolution',
  'intra-family transfer or dissolution',
  'intrafamily transfer',
];

interface DeedRecord {
  docType: string;
  instrumentNumber: string;
  recordedDate: string;
}

// ─── Extraction Helpers ─────────────────────────────────────────────────────

function extractDeedRecords(resultData: Record<string, unknown>): DeedRecord[] {
  const deeds: DeedRecord[] = [];

  function walk(node: unknown): void {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }

    const obj = node as Record<string, unknown>;
    const instNum = String(obj.InstrumentNumber ?? obj.instrumentNumber ?? obj.InstNum ?? '').trim();
    const docType = String(obj.DocumentType ?? obj.docType ?? obj.DocType ?? '').trim();
    const recorded = String(obj.RecordedDate ?? obj.recordedDate ?? obj.RecDate ?? '').trim();

    if (instNum && recorded) {
      deeds.push({ docType, instrumentNumber: instNum, recordedDate: recorded });
    }

    for (const val of Object.values(obj)) {
      if (val && typeof val === 'object') walk(val);
    }
  }

  walk(resultData);
  return deeds;
}

function parseInstrumentDocId(instrumentNumber: string): string {
  let normalized = instrumentNumber;
  if (instrumentNumber.includes('-')) {
    const parts = instrumentNumber.split('-');
    normalized = parts[parts.length - 1] ?? instrumentNumber;
  } else {
    const match = instrumentNumber.match(/^\d{4}(.+)$/);
    normalized = match?.[1] ?? instrumentNumber;
  }

  const asInt = parseInt(normalized, 10);
  return Number.isNaN(asInt) ? normalized : String(asInt);
}

function extractYear(recordedDate: string): string {
  const d = new Date(recordedDate);
  if (!isNaN(d.getTime())) return String(d.getFullYear());
  const match = recordedDate.match(/(\d{4})/);
  return match?.[1] ?? String(new Date().getFullYear());
}

// ─── Main Function ──────────────────────────────────────────────────────────

export async function fetchGrantDeed(
  lvTitlePointDataId: number
): Promise<{ success: boolean; titlePointDataId?: number; documentId?: number; error?: string }> {
  const [lvRecord] = await db
    .select()
    .from(titlePointData)
    .where(eq(titlePointData.id, lvTitlePointDataId))
    .limit(1);

  if (!lvRecord) return { success: false, error: 'LV record not found' };
  if (!lvRecord.orderId) return { success: false, error: 'LV record has no orderId — cannot fetch grant deed yet' };

  const oid = lvRecord.orderId;
  const meta = (lvRecord.metadata as Record<string, unknown>) ?? {};
  const resultData = (meta.resultData as Record<string, unknown>) ?? {};
  const fips = lvRecord.fips ?? (resultData.Fips as string) ?? (resultData.fips as string) ?? '';
  const userId = (meta.userId as string) ?? 'system';

  if (!fips) {
    return { success: false, error: 'No FIPS code available from LV result' };
  }

  const allDeeds = extractDeedRecords(resultData);
  if (allDeeds.length === 0) {
    return { success: false, error: 'No deed records found in LV result' };
  }

  const useFilter = (await getSetting('titlepoint_vesting_doc_filter')) === 'true';
  const filteredDeeds = useFilter
    ? allDeeds.filter((d) => FILTERED_DEED_TYPES.includes(d.docType.toLowerCase()))
    : allDeeds;

  const deed = filteredDeeds[0] ?? allDeeds[0];
  if (!deed) return { success: false, error: 'No matching deed records after filtering' };

  const docId = parseInstrumentDocId(deed.instrumentNumber);
  const year = extractYear(deed.recordedDate);

  const [gdRecord] = await db
    .insert(titlePointData)
    .values({
      orderId: oid,
      fileNumber: lvRecord.fileNumber ?? null,
      searchType: 'grant_deed',
      status: 'pending',
      fips,
      metadata: {
        userId,
        lvTitlePointDataId,
        instrumentNumber: deed.instrumentNumber,
        docId,
        year,
        docType: deed.docType,
      } as Record<string, unknown>,
    })
    .returning({ id: titlePointData.id });

  const gdId = gdRecord!.id;

  const docResult = await getDocumentsByParameters3(
    { fips, year, instrumentDocId: docId },
    oid
  );

  if (!docResult.success) {
    await db.update(titlePointData).set({
      status: 'failed',
      message: docResult.error?.message ?? 'GetDocumentsByParameters3 failed',
      updatedAt: new Date(),
    }).where(eq(titlePointData.id, gdId));

    return { success: false, titlePointDataId: gdId, error: docResult.error?.message };
  }

  const pdfBuffer = Buffer.from(docResult.data!.base64Data, 'base64');
  const filename = `tp_${lvRecord.fileNumber ?? 'pre'}_grant_deed_${Date.now()}.pdf`;

  try {
    const uploadResult = await uploadDocument({
      orderId: oid,
      file: pdfBuffer,
      filename,
      contentType: 'application/pdf',
      category: 'grant_deed',
      description: `TitlePoint Grant Deed - ${lvRecord.fileNumber ?? 'pre-order'} (Inst: ${deed.instrumentNumber})`,
      userId,
    });

    await db.update(titlePointData).set({
      status: 'completed',
      message: `Grant Deed retrieved and uploaded (Inst: ${deed.instrumentNumber})`,
      metadata: {
        ...(await db.select({ m: titlePointData.metadata }).from(titlePointData).where(eq(titlePointData.id, gdId)).limit(1))[0]?.m as Record<string, unknown> ?? {},
        documentId: uploadResult.documentId,
      } as Record<string, unknown>,
      updatedAt: new Date(),
    }).where(eq(titlePointData.id, gdId));

    // SoftPro write-back waits for sibling LV/tax work, then posts one FileList.
    await maybeAttachTitleDocsToSoftPro(oid);

    return { success: true, titlePointDataId: gdId, documentId: uploadResult.documentId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Document upload failed';
    await db.update(titlePointData).set({
      status: 'failed',
      message: msg,
      updatedAt: new Date(),
    }).where(eq(titlePointData.id, gdId));

    return { success: false, titlePointDataId: gdId, error: msg };
  }
}
