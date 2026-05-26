// ============================================================
// TESSA™ Pipeline Orchestrator
// Runs the full analysis: PDF extract → pre-parser → LLM
// extraction → guardrails → LLM summary → complexity score.
// Each step updates the DB row for progress tracking.
// ============================================================

import { db } from '@/lib/db/client';
import { prelimAnalyses } from '@/lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { downloadFile as s3Download } from '@/lib/integrations/s3/client';
import { extractPdfText } from './pdf-extract';
import { computeFacts } from './tessa-pre-parser';
import { callExtraction, callSummary } from './ai-client';
import { validateAndRepairExtraction } from './tessa-guardrails';
import { computeComplexity } from './complexity';
import type { ExtractedAnalysis, PrelimFacts } from './tessa-types';

export interface AnalyzePrelimParams {
  orderId: number;
  documentId: number;
  fileNumber: string;
  /** S3 storage key — preferred path (direct IAM download). */
  storageKey?: string;
  /** HTTP URL fallback (signed URL or external URL). */
  pdfUrl?: string;
  triggeredBy: 'webhook' | 'cron' | 'manual';
  attemptCount?: number;
}

export interface AnalyzePrelimResult {
  analysisId: number;
  status: string;
  error?: string;
  errorStep?: string | null;
}

async function updateRow(
  id: number,
  values: Partial<typeof prelimAnalyses.$inferInsert>,
) {
  await db.update(prelimAnalyses).set({
    ...values,
    updatedAt: new Date(),
  }).where(eq(prelimAnalyses.id, id));
}

async function downloadPdfByKey(storageKey: string): Promise<Buffer> {
  console.log(`[TESSA] Downloading PDF from S3 key: ${storageKey}`);
  const result = await s3Download(storageKey);
  if (!result.success || !result.data) {
    throw new Error(`S3 download failed for key ${storageKey}: ${result.error?.message ?? 'unknown'}`);
  }
  return result.data;
}

async function downloadPdfByUrl(url: string): Promise<Buffer> {
  console.log(`[TESSA] Downloading PDF from URL: ${url.substring(0, 80)}...`);
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`PDF download failed: HTTP ${response.status}`);
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function analyzePrelim(
  params: AnalyzePrelimParams,
): Promise<AnalyzePrelimResult> {
  console.log(
    `[TESSA] Starting analysis for order ${params.orderId}, doc ${params.documentId}, trigger: ${params.triggeredBy}`,
  );
  const startedAt = Date.now();
  const attemptCount = params.attemptCount ?? (params.triggeredBy === 'cron' ? 1 : 0);

  // Dedupe: skip if an active (non-failed) analysis already exists for this document
  const [existing] = await db
    .select({ id: prelimAnalyses.id, status: prelimAnalyses.status })
    .from(prelimAnalyses)
    .where(and(
      eq(prelimAnalyses.documentId, params.documentId),
      inArray(prelimAnalyses.status, ['pending', 'downloading', 'extracting', 'analyzing', 'summarizing', 'complete']),
    ))
    .limit(1);

  if (existing) {
    console.log(`[TESSA] Analysis already exists for doc ${params.documentId}: ${existing.status}`);
    return { analysisId: existing.id, status: existing.status };
  }

  // Create row with status 'pending'
  let analysisId: number;
  console.error('[TESSA] About to create analysis row', {
    orderId: params.orderId,
    documentId: params.documentId,
    fileNumber: params.fileNumber,
    triggeredBy: params.triggeredBy,
  });
  try {
    const [row] = await db.insert(prelimAnalyses).values({
      orderId: params.orderId,
      documentId: params.documentId,
      fileNumber: params.fileNumber,
      status: 'pending',
      triggeredBy: params.triggeredBy,
      attemptCount,
    }).returning({ id: prelimAnalyses.id });
    analysisId = row!.id;
    console.error('[TESSA] Created analysis row successfully', {
      analysisId,
      orderId: params.orderId,
      documentId: params.documentId,
    });
    console.log(`[TESSA] Created analysis row ${analysisId} for order ${params.orderId}`);
  } catch (err) {
    console.error('[TESSA] FATAL: Cannot create analysis row:', {
      orderId: params.orderId,
      documentId: params.documentId,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return {
      analysisId: 0,
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
      errorStep: 'creating_row',
    };
  }

  const finish = (status: string) => {
    console.log(
      `[TESSA] Analysis ${analysisId} for order ${params.orderId}: ${status}, took ${Date.now() - startedAt}ms`,
    );
  };

  let pdfText: string | undefined;
  let facts: PrelimFacts | undefined;
  let extraction: ExtractedAnalysis | undefined;

  try {
    // Download PDF — prefer S3 direct, fall back to HTTP URL
    if (!params.storageKey && !params.pdfUrl) {
      throw new Error('Either storageKey or pdfUrl must be provided');
    }

    await updateRow(analysisId, { status: 'downloading' });
    console.log(`[TESSA] ${analysisId}: downloading PDF`);
    const pdfBuffer = params.storageKey
      ? await downloadPdfByKey(params.storageKey)
      : await downloadPdfByUrl(params.pdfUrl!);

    // Extract text from PDF
    await updateRow(analysisId, { status: 'extracting' });
    console.log(`[TESSA] ${analysisId}: extracting text (${pdfBuffer.length} bytes)`);
    pdfText = await extractPdfText(pdfBuffer);
    console.log(`[TESSA] ${analysisId}: extracted ${pdfText.length} chars`);
    await updateRow(analysisId, {
      pdfText,
      pdfCharCount: pdfText.length,
    });
  } catch (err) {
    console.error('[TESSA] PDF extraction FAILED:', err instanceof Error ? { message: err.message, stack: err.stack } : err);
    await updateRow(analysisId, {
      status: 'failed',
      errorMessage: err instanceof Error ? err.message : String(err),
      errorStep: 'extracting',
    });
    finish('failed');
    return {
      analysisId,
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
      errorStep: 'extracting',
    };
  }

  try {
    // (e) Run pre-parser (deterministic)
    facts = computeFacts(pdfText);
    await updateRow(analysisId, { factsJson: facts as unknown as Record<string, unknown> });
  } catch (err) {
    await updateRow(analysisId, {
      status: 'failed',
      errorMessage: err instanceof Error ? err.message : String(err),
      errorStep: 'computing_facts',
    });
    finish('failed');
    return {
      analysisId,
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
      errorStep: 'computing_facts',
    };
  }

  try {
    // (f) Update status to 'analyzing'
    await updateRow(analysisId, { status: 'analyzing' });

    // (g) LLM extraction call
    const rawExtraction = await callExtraction(pdfText, JSON.stringify(facts));

    // Audit trail: persist raw LLM output before guardrails
    await updateRow(analysisId, {
      rawExtractionJson: rawExtraction as unknown as Record<string, unknown>,
      extractionModel: 'claude-sonnet-4-20250514',
    });

    // (h) Guardrails: validate and repair
    extraction = validateAndRepairExtraction(rawExtraction, facts);

    await updateRow(analysisId, {
      extractionJson: extraction as unknown as Record<string, unknown>,
    });
  } catch (err) {
    await updateRow(analysisId, {
      status: 'failed',
      errorMessage: err instanceof Error ? err.message : String(err),
      errorStep: 'analyzing',
      factsJson: facts as unknown as Record<string, unknown>,
    });
    finish('failed');
    return {
      analysisId,
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
      errorStep: 'analyzing',
    };
  }

  try {
    // (i) Update status to 'summarizing'
    await updateRow(analysisId, { status: 'summarizing' });

    // (j) LLM summary call
    const summaryText = await callSummary(extraction);

    // (k) Compute complexity score
    const complexity = computeComplexity(extraction, facts);

    // (l) Denormalize counts
    const reqs = extraction.title_requirements ?? [];
    const requirementCount = reqs.length;
    const blockerCount = reqs.filter((r) => r.severity === 'blocker').length;
    const lienCount = (extraction.liens ?? []).length;
    const taxCount = (extraction.taxes ?? []).length;
    const taxDefaultCount = (extraction.tax_defaults ?? []).length;
    const otherFindingCount = (extraction.other_findings ?? []).length;

    // (m) Final update — complete
    await updateRow(analysisId, {
      status: 'complete',
      summaryText,
      summaryModel: 'claude-sonnet-4-20250514',
      complexityScore: complexity.score,
      complexityLevel: complexity.level,
      complexityReasons: complexity.reasons,
      requirementCount,
      blockerCount,
      lienCount,
      taxCount,
      taxDefaultCount,
      otherFindingCount,
      foreclosureDetected: extraction.foreclosure_detected ?? false,
      completedAt: new Date(),
    });

    finish('complete');
    return { analysisId, status: 'complete' };
  } catch (err) {
    // (n) Partial results preserved — mark as failed at summarizing step
    await updateRow(analysisId, {
      status: 'failed',
      errorMessage: err instanceof Error ? err.message : String(err),
      errorStep: 'summarizing',
    });
    finish('failed');
    return {
      analysisId,
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
      errorStep: 'summarizing',
    };
  }
}
