// ============================================================
// TESSA™ AI Client — Direct Anthropic SDK
// Replaces pct.com's tessa-proxy (render.com) with server-side
// calls to Claude via @anthropic-ai/sdk.
// ============================================================

import Anthropic from '@anthropic-ai/sdk';
import { db } from '@/lib/db/client';
import { vendorApiLogs } from '@/lib/db/schema';
import {
  EXTRACTION_SYSTEM_PROMPT,
  buildExtractionPrompt,
  SUMMARY_SYSTEM_PROMPT,
  buildSummaryPrompt,
} from './tessa-prompts';
import type { ExtractedAnalysis } from './tessa-types';
import { assertTessaLlmAllowed, type TessaTrigger } from './analysis-config';

const VENDOR = 'anthropic';
const MODEL = 'claude-sonnet-4-20250514';

function getClient(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

async function logRequest(params: {
  operation: string;
  requestId: string;
  startedAt: Date;
  success: boolean;
  requestMeta?: Record<string, unknown>;
  responseMeta?: Record<string, unknown>;
}) {
  try {
    await db.insert(vendorApiLogs).values({
      vendor: VENDOR,
      operation: params.operation,
      requestId: params.requestId,
      startedAt: params.startedAt,
      endedAt: new Date(),
      success: params.success,
      errorCategory: params.success ? null : 'API_ERROR',
      requestMeta: params.requestMeta ?? null,
      responseMeta: params.responseMeta ?? null,
    });
  } catch { /* logging must not break the main flow */ }
}

function stripMarkdownFences(text: string): string {
  let s = text.trim();
  if (s.startsWith('```json')) s = s.slice(7);
  else if (s.startsWith('```')) s = s.slice(3);
  if (s.endsWith('```')) s = s.slice(0, -3);
  return s.trim();
}

export async function callExtraction(
  pdfText: string,
  factsJson: string,
  triggeredBy: TessaTrigger,
): Promise<ExtractedAnalysis> {
  assertTessaLlmAllowed(triggeredBy);
  const client = getClient();
  const requestId = crypto.randomUUID();
  const startedAt = new Date();

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      temperature: 0,
      system: EXTRACTION_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildExtractionPrompt(pdfText, factsJson) }],
    });

    const rawText =
      response.content[0]?.type === 'text' ? response.content[0].text : '';
    const cleaned = stripMarkdownFences(rawText);
    const parsed: ExtractedAnalysis = JSON.parse(cleaned);

    await logRequest({
      operation: 'tessa_extract',
      requestId,
      startedAt,
      success: true,
      requestMeta: { model: MODEL, pdfChars: pdfText.length },
      responseMeta: {
        inputTokens: response.usage?.input_tokens,
        outputTokens: response.usage?.output_tokens,
      },
    });

    return parsed;
  } catch (err) {
    await logRequest({
      operation: 'tessa_extract',
      requestId,
      startedAt,
      success: false,
      requestMeta: { model: MODEL, pdfChars: pdfText.length },
      responseMeta: { error: err instanceof Error ? err.message : String(err) },
    });
    throw err;
  }
}

export async function callSummary(
  extractionJson: ExtractedAnalysis,
  triggeredBy: TessaTrigger,
): Promise<string> {
  assertTessaLlmAllowed(triggeredBy);
  const client = getClient();
  const requestId = crypto.randomUUID();
  const startedAt = new Date();

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1200,
      temperature: 0.1,
      system: SUMMARY_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildSummaryPrompt(JSON.stringify(extractionJson)) }],
    });

    const rawText =
      response.content[0]?.type === 'text' ? response.content[0].text : '';

    await logRequest({
      operation: 'tessa_summarize',
      requestId,
      startedAt,
      success: true,
      requestMeta: { model: MODEL },
      responseMeta: {
        inputTokens: response.usage?.input_tokens,
        outputTokens: response.usage?.output_tokens,
      },
    });

    return rawText;
  } catch (err) {
    await logRequest({
      operation: 'tessa_summarize',
      requestId,
      startedAt,
      success: false,
      requestMeta: { model: MODEL },
      responseMeta: { error: err instanceof Error ? err.message : String(err) },
    });
    throw err;
  }
}
