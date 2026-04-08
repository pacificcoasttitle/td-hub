# TESSA Prelim Summaries Implementation

This document explains how TESSA prelim summaries were built in `td-hub`, what files own each part of the pipeline, how data moves from a prelim PDF into a stored analysis, and how the UI retrieves and displays the result.

It reflects the current code in the repository, not an idealized design.

## Goal

TESSA was built to automatically analyze preliminary title reports and produce:

- structured extracted title data
- a plain-English prelim summary for internal users
- a complexity score with supporting reasons
- a persisted audit trail of the analysis pipeline

The feature is designed to work both automatically when a prelim arrives from SoftPro and manually from the TD Hub UI.

## High-Level Architecture

The implementation is split into six layers:

1. Document intake
   SoftPro prelim webhook stores the PDF as a `documents` row.
2. Analysis trigger
   TESSA is launched either from the webhook or manually from an order API route.
3. Deterministic parsing
   The PDF is converted to text, then pre-parsed into hard facts before AI is used.
4. AI extraction and summary
   Anthropic Claude is called twice: once for structured extraction, once for the summary.
5. Guardrails and scoring
   The AI output is repaired and normalized against deterministic facts, then scored for complexity.
6. Retrieval and UI
   API routes expose the latest analysis, and the TESSA modal polls until the result is ready.

## Primary Files

### Entry points

- `src/lib/tessa/index.ts`
  Re-exports `analyzePrelim`.
- `src/lib/tessa/pipeline.ts`
  Owns the full server-side analysis pipeline.

### Deterministic parsing

- `src/lib/tessa/pdf-extract.ts`
  Extracts text from PDF buffers using `pdf-parse`.
- `src/lib/tessa/tessa-pre-parser.ts`
  Computes deterministic facts from the raw prelim text.
- `src/lib/tessa/tessa-types.ts`
  Defines the facts, extracted JSON, and supporting interfaces.

### AI and prompts

- `src/lib/tessa/ai-client.ts`
  Calls Anthropic directly for extraction and summary.
- `src/lib/tessa/tessa-prompts.ts`
  Contains extraction and summary system prompts and prompt builders.

### Post-processing

- `src/lib/tessa/tessa-guardrails.ts`
  Repairs AI output against deterministic facts.
- `src/lib/tessa/complexity.ts`
  Computes the complexity score and reasons.

### Persistence and access

- `src/lib/db/schema/tessa.ts`
  Defines the `prelim_analyses` table.
- `src/app/api/orders/[id]/analyze-prelim/route.ts`
  Manual trigger route.
- `src/app/api/orders/[id]/prelim-analysis/route.ts`
  Full analysis fetch route.
- `src/app/api/orders/[id]/prelim-analysis/status/route.ts`
  Polling/status route.

### UI

- `src/components/tessa/TessaPrelimResultsModal.tsx`
  Main modal for loading, polling, failed, 404, and complete states.
- `src/components/tessa/TessaPrelimResults.tsx`
  Renders the extracted summary/results.
- `src/components/sales/order-actions.tsx`
  Exposes the `Prelim Summary` action.
- `src/components/sales/dashboard-content.tsx`
  Opens the TESSA modal from the sales dashboard.

## Database Model

TESSA persists results in `prelim_analyses`.

Current key columns:

- identity: `id`, `order_id`, `document_id`, `file_number`
- pipeline state: `status`, `triggered_by`, `error_message`, `error_step`
- extracted source: `pdf_text`, `pdf_char_count`
- deterministic and AI outputs: `facts_json`, `raw_extraction_json`, `extraction_json`, `summary_text`
- complexity: `complexity_score`, `complexity_level`, `complexity_reasons`
- denormalized counters: `requirement_count`, `blocker_count`, `lien_count`, `tax_count`, `tax_default_count`, `other_finding_count`, `foreclosure_detected`
- model metadata: `extraction_model`, `summary_model`
- timestamps: `created_at`, `updated_at`, `completed_at`

This table is used both as the final record and as the in-progress job state for polling.

## Trigger Paths

### 1. Automatic trigger from SoftPro prelim webhook

File: `src/lib/domain/webhooks/softpro-handler.ts`

When a prelim webhook is received:

1. The PDF is downloaded from the webhook URL.
2. The file is stored in S3 and a `documents` row is created with category `prelim`.
3. An `order.document.received` event is queued.
4. `analyzePrelim(...)` is called in a non-blocking way.

The trigger is intentionally fire-and-forget:

- TESSA failure does not fail the webhook response.
- The analysis call is wrapped in `.catch(...)`.

The webhook also respects the `prelim_summary_shut_off` setting before any analysis work starts.

### 2. Manual trigger from UI

File: `src/app/api/orders/[id]/analyze-prelim/route.ts`

Manual analysis:

1. checks the session
2. checks the user role against an allowed role list
3. loads the order
4. finds the latest `prelim` document
5. returns a cached complete analysis unless `force=true`
6. runs `analyzePrelim(...)` directly

The manual route prefers the document `storageKey`, so the pipeline downloads the PDF directly from S3 rather than relying on a signed URL.

## Pipeline Stages

The full pipeline lives in `src/lib/tessa/pipeline.ts`.

### Stage 0. Create analysis row

The pipeline begins by inserting a `prelim_analyses` row with:

- `status = 'pending'`
- `triggered_by = 'webhook' | 'manual' | 'cron'`

This row becomes the state object for the rest of the pipeline.

### Stage 1. Download and extract PDF text

The pipeline prefers:

- `storageKey` via direct S3 download

and falls back to:

- `pdfUrl` via HTTP fetch

Text extraction is done in `src/lib/tessa/pdf-extract.ts` with these rules:

- use `pdf-parse`
- reject PDFs with fewer than 100 extracted characters
- reinsert newlines before numbered items
- cap extracted text at 50,000 characters

This prevents image-only or malformed PDFs from flowing deeper into the pipeline.

### Stage 2. Compute deterministic facts

The extracted text is passed into `computeFacts(...)` in `src/lib/tessa/tessa-pre-parser.ts`.

This pre-parser extracts the hard facts before any AI call, including:

- property taxes and tax defaults
- title requirements
- foreclosure indicators
- deeds of trust
- HOA liens
- assignment of rents
- easements
- CC&Rs
- ownership structure
- recent conveyances
- property state and property type
- Schedule A subject-to item references
- special flags like solar, UCC, out-of-state property, recent conveyance, active foreclosure

These facts are treated as ground truth for the rest of the analysis.

### Stage 3. AI extraction

File: `src/lib/tessa/ai-client.ts`

TESSA calls Anthropic directly using:

- vendor: `anthropic`
- model: `claude-sonnet-4-20250514`

`callExtraction(...)` sends:

- `EXTRACTION_SYSTEM_PROMPT`
- a user prompt built by `buildExtractionPrompt(pdfText, factsJson)`

The extraction prompt instructs the model to return strict JSON only and gives it:

- the pre-parser facts as ground truth
- a required JSON schema for title requirements, property info, liens, taxes, defaults, findings, and document status
- up to 50,000 chars of prelim text

The raw model JSON is parsed and stored as:

- `raw_extraction_json`

Anthropic calls are logged into `vendor_api_logs` with operations:

- `tessa_extract`
- `tessa_summarize`

### Stage 4. Guardrails and repair

File: `src/lib/tessa/tessa-guardrails.ts`

After the raw extraction returns, `validateAndRepairExtraction(...)` enforces deterministic truth.

Key behavior:

- missing pre-parser requirements are injected into `title_requirements`
- missing deeds of trust are injected into `liens`
- AI tax output is overridden with deterministic tax facts
- tax defaults are injected from the pre-parser
- foreclosure flags are forced on if the pre-parser found them

This step ensures the stored `extraction_json` is not just raw model output.

### Stage 5. AI summary

`callSummary(...)` makes a second Anthropic request using:

- `SUMMARY_SYSTEM_PROMPT`
- `buildSummaryPrompt(JSON.stringify(extractionJson))`

This produces a concise, plain-English summary aimed at real estate/title users rather than raw machine output.

The summary is stored in `summary_text`.

### Stage 6. Complexity scoring and denormalization

File: `src/lib/tessa/complexity.ts`

`computeComplexity(...)` scores the analysis based on:

- lien count and lien types
- delinquent taxes
- number and severity of requirements
- blocker count
- other findings
- missing document sections
- foreclosure detection
- recent conveyance detection

The pipeline then stores:

- `complexity_score`
- `complexity_level`
- `complexity_reasons`

and also denormalizes counts for quick UI display:

- requirement count
- blocker count
- lien count
- tax count
- tax default count
- other finding count

### Stage 7. Final state

If everything succeeds:

- `status = 'complete'`
- `completed_at` is set

If a stage fails:

- `status = 'failed'`
- `error_message` is stored
- `error_step` is set to the failing stage

The pipeline preserves partial work where possible so debugging is easier.

## Persisted Status Model

Backend statuses currently written by the pipeline are:

- `pending`
- `extracting`
- `analyzing`
- `summarizing`
- `complete`
- `failed`

The UI also has labels for `computing_facts` and `validating`, but the current backend does not persist those two intermediate states as standalone status values.

## API Contract

### `POST /api/orders/[id]/analyze-prelim`

Purpose:

- manually start analysis
- optionally return cached complete analysis unless `force=true`

Success responses:

- `{ analysisId, status: 'complete' | 'failed' }`
- or `{ analysisId, status: 'complete', cached: true }` when reusing a complete row

Errors:

- `401` unauthorized
- `403` forbidden
- `400` invalid order id
- `404` order or prelim document not found
- `500` analysis failed

### `GET /api/orders/[id]/prelim-analysis`

Purpose:

- load the latest full analysis record for an order

Returns:

- `status`
- `summaryText`
- `extractionJson`
- complexity fields
- denormalized counts
- error fields
- timestamps

If no analysis exists:

- `404`

### `GET /api/orders/[id]/prelim-analysis/status`

Purpose:

- lightweight polling endpoint while analysis is in progress

Returns:

- `analysisId`
- `status`
- `error`

If no analysis exists:

- `404`

## UI Implementation

The main user-facing surface is `TessaPrelimResultsModal`.

### State handling

The modal supports:

- `loading`
- `polling`
- `triggering`
- `not_found`
- `failed`
- `complete`

Behavior:

- on open, it requests `/api/orders/[id]/prelim-analysis`
- if the route returns `404`, it shows `Run Analysis`
- if the result is incomplete, it starts polling `/status`
- if the pipeline fails, it shows the error and a retry button
- if the pipeline completes, it renders `TessaPrelimResults`

### Sales dashboard wiring

Sales users reach TESSA through the order action menu:

- `Prelim Summary`

That action opens `TessaPrelimResultsModal` from `src/components/sales/dashboard-content.tsx`.

## Vendor Logging and Auditability

TESSA currently logs external AI calls to `vendor_api_logs`:

- `tessa_extract`
- `tessa_summarize`

Those logs include:

- request id
- model name
- token usage on success
- error text on failure

The pipeline itself also stores analysis-stage details in `prelim_analyses`, including:

- raw extracted PDF text
- deterministic facts
- raw extraction JSON before guardrails
- final repaired extraction JSON
- summary text
- error step and message

That combination gives both vendor-level and application-level debugging trails.

## Operational Notes

### Environment dependencies

Current implementation requires:

- `ANTHROPIC_API_KEY`
- S3 access for prelim document downloads
- database access for `prelim_analyses`

### Performance model

The pipeline is synchronous once triggered by the route, but the UI treats it as an async background process by polling the latest row.

### Shutoff behavior

SoftPro prelim-triggered TESSA analysis can be disabled through:

- `prelim_summary_shut_off`

If the shutoff is enabled, the webhook logs a skip and does not start analysis.

## Important Current-Truth Notes

These are not design suggestions. They are current implementation facts:

- the TESSA file names are mixed: some are plain (`pipeline.ts`, `ai-client.ts`, `pdf-extract.ts`), while others still use the `tessa-` prefix (`tessa-pre-parser.ts`, `tessa-prompts.ts`, `tessa-guardrails.ts`, `tessa-types.ts`)
- the API routes are role-gated, but they do not currently perform per-order scope checks
- the UI step list includes `computing_facts` and `validating`, but the current backend status values do not explicitly persist those intermediate labels
- the system stores both `raw_extraction_json` and final `extraction_json`, which is useful for comparing the model output before and after guardrails

## End-to-End Flow Summary

In production terms, the TESSA prelim summary flow is:

1. SoftPro sends a prelim webhook.
2. TD Hub downloads the PDF and stores it in S3 as a `documents` row.
3. TD Hub non-blockingly starts `analyzePrelim(...)`.
4. The pipeline downloads the PDF, extracts text, computes deterministic facts, calls Anthropic for extraction, repairs that extraction, calls Anthropic again for a summary, computes a complexity score, and writes the final analysis to `prelim_analyses`.
5. A user clicks `Prelim Summary` in the UI.
6. The modal loads the latest analysis, polls while in progress, and renders the final extracted summary when complete.

## Recommended Companion Files To Read

If someone needs to maintain or debug this feature, start with these files in order:

1. `src/lib/tessa/pipeline.ts`
2. `src/lib/domain/webhooks/softpro-handler.ts`
3. `src/app/api/orders/[id]/analyze-prelim/route.ts`
4. `src/components/tessa/TessaPrelimResultsModal.tsx`
5. `src/lib/tessa/tessa-pre-parser.ts`
6. `src/lib/tessa/tessa-guardrails.ts`
7. `src/lib/tessa/ai-client.ts`
8. `src/lib/db/schema/tessa.ts`
