// ============================================================
// TESSA™ Pipeline Orchestrator
// Runs the full analysis: PDF extract → pre-parser → LLM
// extraction → guardrails → LLM summary → complexity score.
// Each step updates the DB row for progress tracking.
// ============================================================

import { db } from '@/lib/db/client';
import { prelimAnalyses } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
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
  pdfUrl: string;
  triggeredBy: 'webhook' | 'cron' | 'manual';
}

export interface AnalyzePrelimResult {
  analysisId: number;
  status: 'complete' | 'failed';
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

async function downloadPdf(url: string): Promise<Buffer> {
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

  // (a) Create row with status 'pending'
  const [row] = await db.insert(prelimAnalyses).values({
    orderId: params.orderId,
    documentId: params.documentId,
    fileNumber: params.fileNumber,
    status: 'pending',
    triggeredBy: params.triggeredBy,
  }).returning({ id: prelimAnalyses.id });

  const analysisId = row!.id;
  console.log(`[TESSA] Created analysis row ${analysisId} for order ${params.orderId}`);

  const finish = (status: 'complete' | 'failed') => {
    console.log(
      `[TESSA] Analysis ${analysisId} for order ${params.orderId}: ${status}, took ${Date.now() - startedAt}ms`,
    );
  };

  let pdfText: string | undefined;
  let facts: PrelimFacts | undefined;
  let extraction: ExtractedAnalysis | undefined;

  try {
    // (b) Download PDF from S3
    const pdfBuffer = await downloadPdf(params.pdfUrl);

    // (c) Update status to 'extracting'
    await updateRow(analysisId, { status: 'extracting' });

    // (d) Extract text from PDF
    pdfText = await extractPdfText(pdfBuffer);
    await updateRow(analysisId, {
      pdfText,
      pdfCharCount: pdfText.length,
    });
  } catch (err) {
    await updateRow(analysisId, {
      status: 'failed',
      errorMessage: err instanceof Error ? err.message : String(err),
      errorStep: 'extracting',
    });
    return { analysisId, status: 'failed' };
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
    return { analysisId, status: 'failed' };
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
    return { analysisId, status: 'failed' };
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
    return { analysisId, status: 'failed' };
  }
}
