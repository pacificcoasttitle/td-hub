# AI Prelim Review (TESSA™) — Complete Reference

This is the exhaustive reference for the AI prelim review feature in TD Hub: every file, every prompt, every guardrail, the scoring math, the persisted output contract, the UI styling tokens, the operational controls, and the known gaps.

It documents **what the code does today**, not what it was intended to do. Where the two differ, the difference is called out explicitly.

Companion document: `docs/tessa/TESSA_PRELIM_SUMMARIES_IMPLEMENTATION.md` (shorter narrative overview). This document supersedes it in detail.

---

## 1. What the feature is

TESSA™ is a server-side pipeline that reads a Preliminary Title Report PDF and produces four things:

1. **Structured extraction** — machine-readable JSON of title requirements, property info, liens, taxes, tax defaults, other findings, and document status.
2. **Plain-English summary** — a short markdown narrative with ranked "TOP CLOSING RISKS," written for a real estate professional rather than a title examiner.
3. **Complexity score** — a deterministic 0–100 score with a level band and human-readable reasons.
4. **Full audit trail** — raw PDF text, deterministic pre-parser facts, the raw LLM output *before* guardrails, the repaired output *after* guardrails, model names, token usage, and per-stage error state.

The critical design decision: **the LLM is never the sole source of truth**. A deterministic regex-based pre-parser runs *before* the model sees the document, and its output is injected back over the model's output afterward. Taxes in particular are fully overwritten with pre-parser values — the model's tax numbers are discarded whenever the pre-parser found any.

The feature is branded TESSA and ships behind an admin flag that defaults to OFF.

---

## 2. Build chronology

Commit history for `src/lib/tessa`, `src/components/tessa`, the schema, and the TESSA routes:

| Date | Commit | What happened |
|---|---|---|
| 2026-04-06 | `b929444` | **Pipeline ported to TD Hub** from the pct.com script `tessa-enhanced-script-3.3.0-guardrails.js`. |
| 2026-04-06 | `48b23fd` | Results UI components ported from pct.com. |
| 2026-04-06 | `7f0753a` | Prelim summary modal with auto-trigger and polling. |
| 2026-04-06 | `bd4a7a3` | Migration fix, env example, error handling, dead code cleanup. |
| 2026-04-07 | `38e1594` | PDF extraction fixed for Node/Vercel (the `DOMMatrix` failure). |
| 2026-04-07 | `9d2e712` | Cron awaits the analysis instead of firing and forgetting. |
| 2026-04-07 | `3a0e3fc` | S3 download path fixed. |
| 2026-04-07 | `449f21d` | `raw_extraction_json` audit column added. |
| 2026-04-08 | `7b53aec` | **`pdfjs-dist` replaced with `pdf-parse`** for reliable Node extraction. |
| 2026-04-08 | `5ee09ec` | `pdf-parse` type declarations. |
| 2026-04-08 | `fdc130b` | Health check endpoint. |
| 2026-04-08 | `20cdc5e` | Pipeline hardening + `error_type` migration. |
| 2026-04-08 | `9629efe` | Cron retries failed analyses; modal handles "no analysis" gracefully. |
| 2026-04-08 | `772224e` | Polling race condition fixed. |
| 2026-04-08 | `66afd2d` | Modal branches explicitly on non-complete POST responses. |
| 2026-04-08 | `67bbb1d` / `3b8fe59` | Real error message and failing step surfaced from manual analysis. |
| 2026-04-08 | `d67dd9d` | Health endpoint fails hard on schema drift. |
| 2026-05-26 | `4b481ae` | **One analysis row per document**; retries reuse the row so `attempt_count` can cap permanent failures. |
| 2026-06-10 | `cc5e55b` | **Reversible env kill switch** to stop LLM spend. |
| 2026-06-12 | `49504e0` | **Admin DB feature flag** `tessa_prelim_enabled` to globally hide the feature. |
| 2026-06-12 | `e1473cd` | `triggeredBy` threaded into `callExtraction` so the kill switch is enforced at the chokepoint. |
| 2026-07-16 | `76db843` | Dead `TessaPrelimModal` removed; closings drilldowns deduped. |

Two themes dominate that history: **making PDF extraction survive serverless Node**, and **making the spend controllable and the failures bounded**.

---

## 3. Architecture

```
Trigger (webhook | cron | manual)
  │
  ├─ isTessaTriggerAllowed()          ← env kill switch AND admin DB flag
  │
  ▼
analyzePrelim()  [src/lib/tessa/pipeline.ts]
  │
  ├─ 1. Download PDF        S3 by storageKey (preferred) or HTTP by pdfUrl (60s timeout)
  ├─ 2. extractPdfText()    pdf-parse; reject <100 chars; cap at 50,000 chars
  ├─ 3. computeFacts()      deterministic regex pre-parser → PrelimFacts (GROUND TRUTH)
  ├─ 4. callExtraction()    Claude call #1 → strict JSON        [assertTessaLlmAllowed]
  │      └─ persist raw_extraction_json BEFORE guardrails
  ├─ 5. validateAndRepairExtraction()   inject missing facts, overwrite taxes
  ├─ 6. callSummary()       Claude call #2 → markdown summary   [assertTessaLlmAllowed]
  ├─ 7. computeComplexity() deterministic 0–100 score + reasons
  └─ 8. persist status=complete + denormalized counts
```

Every stage writes its status to the same `prelim_analyses` row, which doubles as the job-state object the UI polls.

---

## 4. Complete file index

### 4.1 Core library — `src/lib/tessa/`

| File | Responsibility |
|---|---|
| `index.ts` | Public barrel. Re-exports `analyzePrelim`. |
| `pipeline.ts` | Orchestrator. Owns row lifecycle, stage sequencing, and error capture. |
| `pdf-extract.ts` | PDF → text via `pdf-parse`. Enforces min/max character bounds. |
| `tessa-pre-parser.ts` | Deterministic fact extraction. The ground-truth engine. |
| `ai-client.ts` | Anthropic SDK calls + `vendor_api_logs` logging. |
| `tessa-prompts.ts` | All system prompts and prompt builders. |
| `tessa-guardrails.ts` | Post-processing: JSON repair (active) + markdown guardrails (legacy). |
| `complexity.ts` | Pure scoring function. |
| `analysis-config.ts` | Kill switches, feature-flag precedence, chokepoint assertion. |
| `tessa-types.ts` | All TypeScript interfaces for facts and extraction. |

Naming is inconsistent by history: some files kept the `tessa-` prefix from the pct.com port (`tessa-pre-parser`, `tessa-prompts`, `tessa-guardrails`, `tessa-types`), others were renamed plain (`pipeline`, `ai-client`, `pdf-extract`, `complexity`, `analysis-config`).

### 4.2 Persistence

| File | Responsibility |
|---|---|
| `src/lib/db/schema/tessa.ts` | `prelim_analyses` table definition. |
| `src/lib/db/migrations/0006_silly_blizzard.sql` | Creates `prelim_analyses`. |
| `src/lib/db/migrations/0007_polite_otto_octavius.sql` | Adds `raw_extraction_json`. |
| `src/lib/db/migrations/0008_add_error_type.sql` | Adds `error_type`. |
| `src/lib/db/migrations/0014_add_prelim_analysis_attempt_count.sql` | Adds `attempt_count`. |
| `src/lib/db/migrations/0015_prelim_analyses_unique_document_id.sql` | Unique index on `document_id`. |
| `src/lib/db/migrations/0017_seed_tessa_prelim_enabled_flag.sql` | Seeds the admin flag as `false`. |

### 4.3 API routes

| Route | Method | Purpose |
|---|---|---|
| `src/app/api/orders/[id]/analyze-prelim/route.ts` | POST | Manual trigger. `maxDuration = 120`. |
| `src/app/api/orders/[id]/prelim-analysis/route.ts` | GET | Full analysis payload for the modal. |
| `src/app/api/orders/[id]/prelim-analysis/status/route.ts` | GET | Lightweight polling. |
| `src/app/api/settings/tessa-prelim/route.ts` | GET | Effective feature flag for the UI. |
| `src/app/api/health/tessa/route.ts` | GET | Admin health check with schema-drift detection. |
| `src/app/api/admin/ops/tessa/route.ts` | GET | Ops dashboard stats. |

### 4.4 Triggers

| File | Trigger |
|---|---|
| `src/lib/domain/webhooks/softpro-handler.ts` | SoftPro prelim webhook → fire-and-forget analysis. |
| `src/lib/jobs/handlers/fetch-prelims.ts` | Cron: fetch prelims (Phase 1) + retry failed analyses (Phase 2). |

### 4.5 UI

| File | Role |
|---|---|
| `src/components/tessa/TessaPrelimResultsModal.tsx` | Full-screen modal. Load / poll / trigger / retry / render. |
| `src/components/tessa/TessaPrelimResults.tsx` | Section layout and icon map. |
| `src/components/tessa/TessaComplexityScore.tsx` | Gauge + reason pills. **Contains a duplicate copy of the scoring logic.** |
| `src/components/tessa/TessaSectionCard.tsx` | Collapsible card shell. |
| `src/components/tessa/TessaSeverityBadge.tsx` | Blocker / Material / Info pill. |
| `src/components/tessa/content/TessaSummaryContent.tsx` | Paragraph renderer for the summary. |
| `src/components/tessa/content/TessaPropertyContent.tsx` | Property key-value rows. |
| `src/components/tessa/content/TessaRequirementsContent.tsx` | Numbered requirement list. |
| `src/components/tessa/content/TessaLiensContent.tsx` | Lien list. |
| `src/components/tessa/content/TessaTaxContent.tsx` | Tax parcel cards with installment badges. |
| `src/components/tessa/content/TessaOtherFindingsContent.tsx` | Impact-colored finding cards. |
| `src/components/tessa/content/TessaDocStatusContent.tsx` | Completeness, metadata, missing sections. |
| `src/components/tessa/content/TessaShared.tsx` | `KV`, `Dollar`, `Recording`, `StatusBadge`, `SeverityBadgeInline`. |
| `src/components/admin/ops/tessa-status.tsx` | Ops dashboard panel. |

### 4.6 Entry points and hooks

| File | Role |
|---|---|
| `src/hooks/useTessaPrelimEnabled.ts` | Reads the effective flag; defaults false until loaded. |
| `src/components/sales/order-actions.tsx` | Renders "Prelim Summary" / "Regenerate Summary" when enabled. |
| `src/components/sales/use-sales-order-actions.tsx` | Opens the modal for both actions. |
| `src/components/sales/dashboard-content.tsx` | Same wiring on the sales dashboard. |
| `src/components/sales/sales-orders-table.tsx` | Passes the flag into `OrderActions`. |

### 4.7 Built but not wired (dead or dormant)

| File / symbol | Status |
|---|---|
| `TessaCheatSheet.tsx` | Realtor cheat-sheet UI. Only referenced by the barrel `index.ts`. |
| `TessaAgentToggle.tsx` | "Simplify for Agents" toggle. Only referenced by the barrel. |
| `TessaChatWidget.tsx` | Chat widget. Only referenced by the barrel. |
| `src/contexts/TessaContext.tsx` | Calls `/api/tessa/chat` — **route does not exist**. |
| `src/hooks/usePrelimAnalysis.ts` | Calls `/api/tessa/analyze` — **route does not exist**. |
| `TESSA_SYSTEM_PROMPT`, `buildPrelimAnalysisPrompt` | Legacy single-call markdown flow. Not called by the pipeline. |
| `AGENT_MODE_SYSTEM_PROMPT` | Not called. |
| `runGuardrailsStep1/2`, `validatePrelimOutput`, `buildRepairPrompt`, `stitchRepairSections` | Markdown-era guardrails. Not called by the pipeline. |

---

## 5. Prompts (verbatim)

All prompt text lives in `src/lib/tessa/tessa-prompts.ts`.

### 5.1 Extraction system prompt — ACTIVE

Sent as the `system` parameter on Claude call #1.

```
You are a title document analysis engine.
You extract structured data from Preliminary Title Reports.
You MUST respond with valid JSON only — no markdown, no backticks, no preamble.
Never invent data. If a value is not stated in the document, use null.
Use exact dollar amounts with $ and commas. Never round.
```

Four instruction-level guardrails are packed into five lines: JSON-only output, no hallucination, explicit null for absent values, and no rounding of money.

### 5.2 Extraction user prompt — ACTIVE

Built by `buildExtractionPrompt(pdfText, factsJson)`. Structure:

1. Instruction line: *"Analyze this Preliminary Title Report and return a JSON object matching this exact structure."*
2. **`GROUND TRUTH (pre-extracted facts — do NOT contradict these):`** followed by the serialized `PrelimFacts`.
3. The full required JSON schema, inline, with union types spelled out (`"blocker" | "material" | "informational"`, `"paid" | "open" | "delinquent" | "defaulted"`, etc.).
4. `DOCUMENT TEXT:` followed by `pdfText.slice(0, 50000)`.

The schema block is the actual contract — reproduced in §8.1.

Note the double truncation: `extractPdfText` already caps at 50,000 characters, and `buildExtractionPrompt` slices to 50,000 again. The second slice is redundant but harmless defense in depth.

### 5.3 Summary system prompt — ACTIVE

```
You are a title industry expert writing a plain-English
summary of a preliminary title report analysis. Write for a real estate professional.
Be concise. Lead with what matters most for closing.
```

### 5.4 Summary user prompt — ACTIVE

Built by `buildSummaryPrompt(extractedJson)`:

```
Based on this extracted analysis of a Preliminary Title Report, write:

1. A section headed "TOP CLOSING RISKS" — numbered list, one risk per line in this format:
   1) **Risk Title** — brief explanation of why it delays closing
   Include only risks with material or higher impact. Max 5 items.

2. A 2-3 sentence narrative summarizing the overall title condition, property address (if known),
   and what must happen before this transaction can close.

Extracted analysis data:
{extractedJson}

Format as plain markdown. No extra headers beyond "TOP CLOSING RISKS".
```

Critically, the summary call receives **the repaired extraction JSON, not the raw PDF text**. The summary can therefore only describe facts that survived guardrails — it cannot reintroduce a hallucination that the repair step removed.

### 5.5 TESSA general system prompt — NOT CALLED BY THE PIPELINE

`TESSA_SYSTEM_PROMPT` is the full chat persona ported from pct.com. It is exported but no server code calls it. It is preserved because it encodes the domain policy the team agreed on, and it is the reference for any future chat surface. Verbatim:

```
You are Tessa™, an expert California Title & Escrow assistant for Pacific Coast Title Company.

PRIMARY GOAL (ALWAYS FIRST):
Identify and clearly list the TITLE REQUIREMENTS and the actions needed to close. Requirements are must-do items (provide, sign, record, payoff, obtain, clear). If the document says "The Company will require..." or similar, treat each as a requirement.

TRUST + FACTS RULE:
- When facts_json is provided, it is ground truth. Do not contradict it.
- Never invent amounts, parties, recording refs, or statuses. If not stated, write "Not stated" or "Unclear".

OUTPUT ORDER (DO NOT CHANGE):
1) **TITLE REQUIREMENTS**
2) **SUMMARY**
3) **PROPERTY INFORMATION**
4) **LIENS AND JUDGMENTS**
5) **TAXES AND ASSESSMENTS**
...
**OTHER FINDINGS**
7) **DOCUMENT STATUS**

CLOSING-FIRST MINDSET:
- Think like a closer: what blocks funding/recording, who owns the next step, and what to request.
- Prefer short, directive language (e.g., "Obtain payoff demand", "Provide trust certification", "Record reconveyance").

STRICT MONEY RULE:
- Use exact dollar amounts with $ and commas when present. No rounding.

SCHEDULE A PRIORITY RULE:
- If Schedule A states "SUBJECT TO ITEM NOS. …", treat those item numbers as priority requirements/exceptions and call them out at the top of TITLE REQUIREMENTS.

SEVERITY / IMPACT:
- Closing impact must be one of: Blocker, Material, Informational.

TAX RATES - DO NOT PROVIDE:
- Do not provide property tax rates or transfer tax rates. Redirect users to the calculator at pct.com or to their local office.
```

The **TAX RATES — DO NOT PROVIDE** clause is a compliance guardrail: quoting tax or transfer-tax rates is a liability surface, so the assistant is instructed to redirect to the official calculator.

### 5.6 Agent-mode reprompt — NOT CALLED

`AGENT_MODE_SYSTEM_PROMPT` rewrites a technical analysis into agent-friendly English while forbidding fact removal ("Never remove or contradict facts — only simplify the language"). Built for the `TessaAgentToggle` component, which is not wired.

### 5.7 Legacy full-analysis prompt — NOT CALLED

`buildPrelimAnalysisPrompt` is a ~160-line markdown-output prompt with a rigid seven-section template, a non-negotiable separation rule between "Requirements (Company stated)" and "Clearing Items (Exceptions to address)", a deduplication rule, owner-assignment guidance, foreclosure escalation rules, and a 15,000-character excerpt cap. It represents the previous architecture: one LLM call producing formatted markdown. The current architecture replaced it with JSON extraction plus a separate summary, which is why it is dormant.

---

## 6. Model configuration

`src/lib/tessa/ai-client.ts`:

| Constant | Value |
|---|---|
| `VENDOR` | `'anthropic'` |
| `MODEL` | `'claude-sonnet-4-20250514'` |

| Call | `max_tokens` | `temperature` | System prompt |
|---|---|---|---|
| `callExtraction` | 4096 | **0** | `EXTRACTION_SYSTEM_PROMPT` |
| `callSummary` | 1200 | 0.1 | `SUMMARY_SYSTEM_PROMPT` |

Temperature 0 on extraction is deliberate: extraction must be as reproducible as possible because it feeds the score and the guardrail comparison. The summary gets a small amount of temperature (0.1) purely for readable prose.

The model name is written twice — once as the `MODEL` constant in `ai-client.ts`, and again as a hardcoded string literal `'claude-sonnet-4-20250514'` in `pipeline.ts` when persisting `extraction_model` and `summary_model`. A model upgrade requires changing both.

### 6.1 Vendor logging

Every Anthropic call, success or failure, inserts a `vendor_api_logs` row:

| Field | Value |
|---|---|
| `vendor` | `anthropic` |
| `operation` | `tessa_extract` or `tessa_summarize` |
| `requestId` | `crypto.randomUUID()` |
| `startedAt` / `endedAt` | Wall-clock bounds |
| `success` | boolean |
| `errorCategory` | `null` on success, `API_ERROR` on failure |
| `requestMeta` | `{ model, pdfChars }` (extract) or `{ model }` (summarize) |
| `responseMeta` | `{ inputTokens, outputTokens }` or `{ error }` |

The logging insert is wrapped in a bare `try { } catch { }` — logging can never break the pipeline.

---

## 7. Guardrails — all layers

There are six distinct guardrail layers. Layers 1–2 run before the model, 3 constrains the model, 4–5 correct the model, and 6 bounds the blast radius.

### Layer 1 — Input validation

`src/lib/tessa/pdf-extract.ts`:

| Rule | Value | Rationale |
|---|---|---|
| `MIN_CHARS` | 100 | Below this the PDF is image-only or corrupt; throws rather than sending garbage to the model. |
| `MAX_CHARS` | 50,000 | Hard cap on prompt size and therefore cost. |
| Newline re-insertion | `text.replace(/(?<!\n)(\d{1,3}\.\s)/g, '\n$1')` | Prelims often collapse numbered items onto one line; the pre-parser's item splitter depends on leading newlines. |

The min-character rule is the single most valuable input guardrail — it is what converts "silent garbage analysis" into an explicit `status='failed'`, `error_step='extracting'` row.

`pipeline.ts` additionally requires that either `storageKey` or `pdfUrl` is supplied, and applies a 60-second timeout to URL downloads via `AbortSignal.timeout(60_000)`.

### Layer 2 — Deterministic pre-parser (ground truth)

`computeFacts(fullText)` in `src/lib/tessa/tessa-pre-parser.ts` runs before any LLM call and produces `PrelimFacts`.

It first isolates the **critical items section** — the text between `AT THE DATE HEREOF…WOULD BE AS FOLLOWS:` and `END OF ITEMS` — normalizes bullets, and splits it into numbered items. Everything downstream operates on those items.

Sub-parsers:

| Function | Extracts |
|---|---|
| `parseTaxesFromItems` | Property taxes (tax ID, fiscal year, both installments + status + penalties, exemption, code area), tax defaults with full redemption schedules, supplemental/special-district assessments, running delinquent and redemption totals. |
| `parseRequirements` | Company-stated requirements, matched by an explicit phrase allowlist, then classified. |
| `classifyRequirement` | Maps requirement text to a `type` + `severity` (see table below). |
| `parseForeclosureFlags` | US redemption rights (§2410), trustee's deed exceptions, Notice of Trustee's Sale with date/time/location. |
| `parseDeedsOfTrust` | Amount, dates, trustor/trustee/beneficiary, loan no., recording ref, assignments, substitutions, NOD/NTS flags, fractional interests. Sorted by recording date and re-positioned 1..n. |
| `parseHOALiens` | Association name, amount, recording ref. |
| `parseAssignmentOfRents` | Amount, assigned to/by, recording ref. |
| `parseEasements` | Purpose, in favor of, affects, recording ref. |
| `parseCCRs` | Recording ref, book/page, violation clause. |
| `parseOwnershipStructure` | Vesting type (individual/trust/TIC/corporate/LLC), trust name/date, TIC percentages, spousal-joinder requirement. |
| `parseRecentConveyances` | Grantor/grantee/date/ref, `days_ago`, `is_recent` (≤90 days), `seasoning_concern`. |
| `detectPropertyState` | CA / AZ / NV via ZIP patterns and county names; defaults `UNKNOWN`. |
| `detectPropertyType` | SFR / multi-family / commercial / condo. |
| `findScheduleASubjects` | Item numbers from `SUBJECT TO ITEM NOS. …`. |

**Requirement classification table** (`classifyRequirement`, evaluated in order — first match wins):

| Matched pattern (abridged) | `type` | `severity` |
|---|---|---|
| full reconveyance / reconvey…confirmation | `reconveyance_confirmation` | **blocker** |
| original note / original DOT / request for full reconveyance | `reconveyance_package` | **blocker** |
| Statement of Information + "various Liens and Judgments"/similar name | `statement_of_information_hits` | **blocker** |
| Statement of Information (general) | `statement_of_information` | **blocker** |
| spouse…join…conveyance / spouse of the vestee | `spousal_joinder` | **blocker** |
| "The Company will require…corporation" | `corp_authority` | material |
| Limited Liability Company / member-managed / Articles of Organization | `llc_authority` | material |
| Probate Code §18100.5 / certification of trust | `trust_docs` | material |
| suspended corporation / Certificate of Revivor | `suspended_corp_cure` | **blocker** |
| homeowner's association / assessments current | `hoa_clearance` | **blocker** |
| demands signed by all beneficiaries | `multi_beneficiary_demand` | **blocker** |
| inspection disclosed matters / inspection ordered | `survey_inspection` | material |
| ALTA/ACSM / Land Title Survey | `survey_inspection` | material |
| review and approval of the Company / Corporate Underwriting | `underwriting_review` | material |
| unrecorded lease/agreement / parties in possession | `unrecorded_docs_review` | material |
| *(fallback)* | `unspecified` | material |

**Special flags** computed in `computeFacts`: `solar_flag`, `ucc_flag`, `trust_flag`, `trust_cert_required`, `reconveyance_package_required`, `easement_estate`, `has_active_foreclosure`, `has_hoa_lien`, `has_tax_default`, `has_delinquent_taxes`, `is_out_of_state`, `has_tic_ownership`, `has_recent_conveyance`, `has_multiple_dots`, `has_fractional_beneficiaries`, `has_assignment_of_rents`, `has_easements`, `has_ccrs`.

### Layer 3 — Prompt-level constraints

Covered in §5. Summarized:

- "You MUST respond with valid JSON only — no markdown, no backticks, no preamble."
- "Never invent data. If a value is not stated in the document, use null."
- "Use exact dollar amounts with $ and commas. Never round."
- "GROUND TRUTH (pre-extracted facts — do NOT contradict these)."
- Explicit enum unions in the schema for every constrained field.
- `temperature: 0` on extraction.

### Layer 4 — Output parsing

`stripMarkdownFences()` in `ai-client.ts` defends against the model wrapping JSON in a fenced code block despite the instruction not to:

```ts
function stripMarkdownFences(text: string): string {
  let s = text.trim();
  if (s.startsWith('```json')) s = s.slice(7);
  else if (s.startsWith('```')) s = s.slice(3);
  if (s.endsWith('```')) s = s.slice(0, -3);
  return s.trim();
}
```

The cleaned string then goes through `JSON.parse()`. **There is no Zod or runtime schema validation** — the result is cast to `ExtractedAnalysis` on trust. A structurally valid but semantically wrong JSON object (say, `severity: "urgent"`) passes through. See §12.

A parse failure throws, which the pipeline catches and records as `status='failed'`, `error_step='analyzing'`.

### Layer 5 — Deterministic repair (`validateAndRepairExtraction`)

This is the guardrail that actually runs on every analysis. `src/lib/tessa/tessa-guardrails.ts:521`. Five rules, applied in order:

**1. Inject missing requirements.** For every pre-parser requirement, check whether the model's `title_requirements` contains it — matched either by the first 30 lowercase characters of the requirement text appearing in a description, or by exact `item_number` equality. If absent, push a synthetic entry using the pre-parser's classification for `severity` and `type`, with `action: 'Review'` and null instrument/assignee.

**2. Inject missing deeds of trust.** For every pre-parser DOT, check the model's `liens` for a matching `recording_ref`, or a matching amount plus a beneficiary whose first 15 characters appear in the model's beneficiary. If absent, push a lien with `type: 'deed_of_trust'`, `action_required: 'payoff'`, and `assigned_to` taken from the last assignment in the chain.

**3. Overwrite taxes entirely.** If the pre-parser found any property taxes, `extracted.taxes` is **replaced wholesale** with pre-parser values. Installment statuses are normalized through `normalizeInstallmentStatus` (`PAID`→`paid`, `DELINQUENT`→`delinquent`, `DEFAULTED`/`DEFAULT`→`defaulted`, anything else→`open`). Penalties are joined with `'; '`. This is the strongest guardrail in the system — the model's tax arithmetic is never trusted when a deterministic answer exists.

**4. Inject tax defaults.** If the pre-parser found defaults, `extracted.tax_defaults` is replaced with them.

**5. Force the foreclosure flag.** If any pre-parser foreclosure flag has `type === 'notice_of_trustee_sale'`, `extracted.foreclosure_detected` is forced to `true` regardless of what the model said. This one-way override matters because `foreclosure_detected` is worth +20 complexity points and drives the highest-severity display path.

Note the asymmetry: rules 1, 2, and 5 can only **add or escalate**; they never remove or downgrade the model's findings. Rules 3 and 4 replace. Nothing in the repair step can quietly delete a risk the model found.

### Layer 5b — Markdown guardrails (present, not invoked)

The file also contains a full markdown-era guardrail suite from the pct.com port: `renderTaxesMarkdown`, `renderCompanyRequirementsMarkdown`, `injectDeterministicRequirements`, `injectPropertyInfoGuardrails`, `injectLiensGuardrails`, `injectSummaryGuardrails`, `validatePrelimOutput` (a 21-field `missing` checklist), `buildRepairPrompt` (a second-pass LLM repair prompt), `runGuardrailsStep1/2`, and `stitchRepairSections`.

`validatePrelimOutput` checks, among other things: every pre-parser requirement item number appears in the TITLE REQUIREMENTS block; every tax ID appears somewhere in the output; the "For Tax Defaults / Redemptions" section exists when defaults exist; every default number and every redemption schedule line (amount **and** "by Month YYYY") appears; Notice of Trustee's Sale is mentioned; solar, UCC, easement-estate, trust, reconveyance, HOA, out-of-state, TIC, DOT count, assignment of rents, easements, CC&Rs, recent conveyance, delinquent tax, and fractional-beneficiary callouts are all present in the correct section.

**None of this is reachable from `pipeline.ts`.** It only makes sense against markdown output, and the pipeline produces JSON. It is retained as the specification of what a complete prelim summary must contain, and as the migration path if a markdown surface returns.

### Layer 6 — Operational guardrails

| Control | Where | Effect |
|---|---|---|
| `TESSA_AUTO_ANALYSIS_ENABLED` | env, default `true` | Off ⇒ zero LLM calls from cron and webhook. |
| `TESSA_MANUAL_ANALYSIS_ENABLED` | env, default `true` | Off ⇒ zero LLM calls from the manual API. |
| `tessa_prelim_enabled` | DB setting, default `false` | Off ⇒ feature hidden everywhere, no new analysis from any path, manual endpoint returns 503. |
| `prelim_summary_shut_off` | DB setting, default `false` | On ⇒ prelim webhooks are received and logged but not processed at all. |
| `MAX_TESSA_ATTEMPTS = 5` | `fetch-prelims.ts` | Caps retries per document; sets `error_type='max_attempts_reached'`. |
| Cron retry batch limit | `fetch-prelims.ts` | `limit 5` candidates per cycle. |
| `TIME_BUDGET_MS = 240_000` | `fetch-prelims.ts` | Phase 1 exits cleanly at 240s; Phase 2 is skipped entirely if Phase 1 timed out. |
| Row reuse + active-status skip | `pipeline.ts` | Skips if existing row is `complete` or in an active status, unless `force: true`. |
| `assertTessaLlmAllowed(triggeredBy)` | `ai-client.ts` | Throws `TessaAnalysisPausedError` **before** the Anthropic request is constructed. |
| `maxDuration = 120` | analyze route | Serverless execution ceiling. |
| `MAX_POLLS = 60` @ 3s | modal | UI gives up after 180 seconds. |
| Role allowlist | all routes | Ten roles; see §9. |
| `canAccessOrder` / `canAccessOrderDetailResource` | all routes | Per-order scope check. |

**Flag precedence** (`analysis-config.ts`): `effective = env_allows AND tessa_prelim_enabled`. Either-off means off. The env flags are the nuclear backstop and default to allow; the DB flag is the day-to-day control and defaults to deny, so a fresh deploy ships dark.

`isTessaPrelimEnabled()` (the UI-facing check, no trigger argument) is stricter still — it requires **both** the automated and manual env gates to allow, so the button only appears when the feature is fully live.

The kill switch is checked twice on purpose: once in `pipeline.ts` before any row mutation (so a paused prelim stays un-analyzed and re-queues cleanly on resume), and once in `ai-client.ts` immediately before each API call (so no code path can reach Anthropic by accident).

### Resume runbook (from the header comment in `analysis-config.ts`)

1. Set `TESSA_AUTO_ANALYSIS_ENABLED=true` in Render/Vercel env.
2. Redeploy or cold-start refresh — Next.js reads `process.env` at boot.
3. Backlog re-queues automatically: prelims stored during the pause have no analysis row, so Phase 1 picks them up; failed/pending rows under `MAX_TESSA_ATTEMPTS` go through the Phase 2 retry loop.
4. **Cost warning, verbatim from the code:** a large pause backlog may flood LLM calls on the first cron cycles after resume (new docs plus up to 5 retries per 30-minute cycle). Consider a staged resume or temporary rate limits if the backlog is large.

---

## 8. Output contract

### 8.1 Extraction JSON schema

The exact structure demanded by `buildExtractionPrompt` and typed by `ExtractedAnalysis`:

```json
{
  "title_requirements": [
    {
      "item_number": 0,
      "description": "<exact text from document>",
      "action": "<short directive: Obtain, Record, Provide, Pay, etc.>",
      "severity": "blocker | material | informational",
      "type": "payoff|reconveyance|trust_cert|soi|affidavit|lien_release|tax_clearance|other",
      "related_instrument": "<recording number or null>",
      "assignee": "Escrow|Seller|Buyer|Lender|Title|null"
    }
  ],
  "property_info": {
    "apn": null,
    "address": null,
    "legal_description": null,
    "vesting": "<current owner names and manner of holding or null>",
    "property_type": "SFR|condo|commercial|multi-unit|null",
    "ownership_structure": "individual|joint_tenants|community_property|trust|llc|tic|null"
  },
  "liens": [
    {
      "position": 1,
      "type": "deed_of_trust|tax_lien|mechanics_lien|judgment|hoa|ucc|other",
      "amount": "<exact dollar string or null>",
      "beneficiary": "<string>",
      "trustor": null,
      "recording_ref": null,
      "recording_date": null,
      "assigned_to": "<current holder if assigned, or null>",
      "action_required": "payoff|reconveyance|release|subordination|null"
    }
  ],
  "taxes": [
    {
      "tax_id": "<parcel number>",
      "fiscal_year": null,
      "first_installment":  { "amount": "<string>", "status": "paid|open|delinquent|defaulted" },
      "second_installment": { "amount": "<string>", "status": "paid|open|delinquent|defaulted" },
      "exemption": null,
      "code_area": null,
      "total_tax": null,
      "penalties": null
    }
  ],
  "tax_defaults": [
    { "tax_id": "<parcel number>", "default_year": "<string>", "amount": "<string>", "redemption_info": null }
  ],
  "other_findings": [
    {
      "item_number": null,
      "type": "easement|ccr|hoa|mineral_rights|restriction|other",
      "description": "<string>",
      "impact": "high|medium|low",
      "action": null,
      "recording_ref": null
    }
  ],
  "document_status": {
    "appears_complete": true,
    "document_date": null,
    "order_number": null,
    "missing_sections": ["<string>"],
    "notes": null
  },
  "schedule_a_subjects": [],
  "foreclosure_detected": false,
  "recent_conveyance_detected": false
}
```

### 8.2 Database — `prelim_analyses`

`src/lib/db/schema/tessa.ts`.

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `order_id` | integer → `orders.id` | |
| `document_id` | integer → `documents.id` | **unique index** — one analysis row per document |
| `file_number` | varchar(100) NOT NULL | |
| `status` | varchar(50) NOT NULL, default `pending` | |
| `triggered_by` | varchar(20) NOT NULL | `webhook` \| `cron` \| `manual` |
| `attempt_count` | integer NOT NULL, default 0 | |
| `pdf_text` | text | **Full extracted PDF text** |
| `pdf_char_count` | integer | |
| `facts_json` | jsonb | Pre-parser `PrelimFacts` |
| `extraction_json` | jsonb | Post-guardrail extraction — what the UI renders |
| `raw_extraction_json` | jsonb | Pre-guardrail LLM output — audit trail |
| `summary_text` | text | LLM markdown summary |
| `complexity_score` | integer | 0–100 |
| `complexity_level` | varchar(20) | `low` \| `moderate` \| `high` \| `very_high` |
| `complexity_reasons` | text[] | |
| `requirement_count` | integer | Denormalized |
| `blocker_count` | integer | Denormalized |
| `lien_count` | integer | Denormalized |
| `tax_count` | integer | Denormalized |
| `tax_default_count` | integer | Denormalized |
| `other_finding_count` | integer | Denormalized |
| `foreclosure_detected` | boolean NOT NULL, default false | |
| `extraction_model` | varchar(100) | |
| `summary_model` | varchar(100) | |
| `error_message` | text | |
| `error_step` | varchar(50) | |
| `error_type` | varchar(30) | e.g. `max_attempts_reached` |
| `created_at` / `updated_at` | timestamp NOT NULL | |
| `completed_at` | timestamp | |

Indexes: `prelim_analyses_order_idx`, `prelim_analyses_document_idx`, `prelim_analyses_status_idx`, and unique `prelim_analyses_document_id_unique`.

Storing both `raw_extraction_json` and `extraction_json` is what makes guardrail effectiveness measurable — you can diff them to see exactly what the deterministic layer corrected.

### 8.3 Status lifecycle

Values written by `pipeline.ts`:

`pending` → `downloading` → `extracting` → `analyzing` → `summarizing` → `complete`

Terminal alternatives: `failed` (with `error_step`), and `paused` (returned by `analyzePrelim` but **not persisted** — the kill-switch check returns before any row mutation).

`error_step` values: `creating_row`, `extracting`, `computing_facts`, `analyzing`, `summarizing`.

The UI's `PIPELINE_STEPS` array is `['pending', 'extracting', 'computing_facts', 'analyzing', 'validating', 'summarizing']`. Two of those — `computing_facts` and `validating` — are **never persisted as status values**, so their progress dots never light up as the active step. `downloading` is persisted but absent from the UI array. This is a cosmetic mismatch, not a functional bug.

### 8.4 Failure semantics

Each stage is wrapped in its own `try/catch` that writes `status='failed'` plus `error_message` and `error_step`, then returns rather than throwing. Partial work is preserved:

- Extraction failure ⇒ nothing downstream runs, but `pdf_text` may already be stored.
- Facts failure ⇒ `pdf_text` retained.
- Analysis failure ⇒ `facts_json` explicitly re-written in the failure update so it is not lost.
- **Summary failure ⇒ `extraction_json` and `raw_extraction_json` are already persisted.** The row is marked failed at `summarizing`, but the structured extraction survives. A retry re-runs the whole pipeline rather than resuming from the summary step.

---

## 9. API contracts

### `POST /api/orders/[id]/analyze-prelim`

Auth: session required; role must be in the allowlist; `canAccessOrder(session, orderId)` must pass.

Allowed roles (identical across all three order-scoped TESSA routes):
`super_admin`, `admin`, `cs_admin`, `title_officer`, `escrow_officer`, `title_production`, `sales_rep`, `sales_manager`, `open_order_team`, `escrow_assistant`.

Flow:
1. Resolve the order; 404 if missing.
2. Find the newest `documents` row with `category = 'prelim'`; 404 if none.
3. Unless `?force=true`, return any existing `complete` analysis as `{ analysisId, status: 'complete', cached: true }`.
4. Check `isTessaTriggerAllowed('manual')`; if off, return **503** with `{ status: 'paused', error: 'AI Prelim analysis is currently disabled by an administrator.' }`.
5. Reset the row for this document (`attempt_count = 0`, `status='pending'`, errors cleared).
6. Run `analyzePrelim` with `triggeredBy: 'manual'`, `force: true`, and await it.
7. On `failed`, re-read the row to return the **real** `errorMessage` and `errorStep` rather than a generic message.

Responses: `200` with the result, `401`, `403`, `400` (bad id), `404`, `503` (paused), `500` (`{ error, detail }`).

### `GET /api/orders/[id]/prelim-analysis`

Returns the newest analysis row for the order: `id`, `status`, `triggeredBy`, `complexityScore`, `complexityLevel`, `complexityReasons`, `summaryText`, `extractionJson`, `requirementCount`, `blockerCount`, `lienCount`, `taxParcelCount`, `findingCount`, `foreclosureDetected`, `errorMessage`, `errorStep`, `createdAt`, `completedAt`, and a computed `processingTimeMs`.

Note two field renames at the API boundary: `tax_count` → `taxParcelCount`, `other_finding_count` → `findingCount`. `404` when no row exists.

### `GET /api/orders/[id]/prelim-analysis/status`

Returns `{ analysisId, status, error }`. When no row exists it returns **`200`** with `{ analysisId: null, status: 'not_started', error: null }` — not a 404. The modal handles both shapes.

### `GET /api/settings/tessa-prelim`

Any signed-in user. Returns `{ enabled: boolean }` from `isTessaPrelimEnabled()`.

### `GET /api/health/tessa`

Admin-only (`super_admin`, `admin`). Seven checks:

1. **Schema drift** — compares live `information_schema.columns` against a hardcoded 30-column list. Any missing column returns **HTTP 500** with the missing/extra column lists and logs an error. This is the check added by `d67dd9d`, and it is the reason a bad migration surfaces immediately instead of as a runtime crash.

   The required-column list has itself drifted: it omits `attempt_count`, which migration `0014` added. Because only *missing* columns fail the check, `attempt_count` simply appears in the returned `extraColumns` array on every call. Harmless today, but the list should be brought back in sync so `extraColumns` stays meaningful.
2. `ANTHROPIC_API_KEY` present.
3. S3 `HeadBucket` on `AWS_BUCKET`.
4. Successful analyses in the last 24h.
5. Failures in the last 24h, with de-duplicated error messages.
6. Prelim documents vs. analyzed documents.
7. `pdf-parse` imports successfully.

Overall status: `broken` if schema, Anthropic key, or `pdf-parse` fail; `healthy` if all pass; otherwise `degraded`. Also returns lifetime stats: totals, avg processing ms, last success/failure timestamps.

---

## 10. Complexity score

### 10.1 The math

Implemented in `src/lib/tessa/complexity.ts` as `computeComplexity(extraction, facts)`. Purely additive, evaluated top to bottom, then clamped.

| # | Condition | Points | Reason string pushed |
|---|---|---|---|
| 1 | `liens.length >= 1` | +10 | `"{n} lien(s) on record"` |
| 2 | `liens.length >= 3` | +10 | `"Multiple liens detected"` |
| 3 | Any lien `type` matches `/hoa\|homeowner/i` | +5 | `"HOA lien present"` |
| 4 | Any lien `type` matches `/judgment/i` | +15 | `"Judgment lien detected"` |
| 5 | Any tax parcel with either installment matching `/unpaid\|delinquent/i` | +20 | `"{n} delinquent tax parcel(s)"` |
| 6 | `title_requirements.length >= 5` | +10 | `"{n} title requirements"` |
| 7 | `title_requirements.length >= 10` | +10 | `"High number of requirements"` |
| 8 | Any requirement with `severity === 'blocker'` | +15 | `"{n} blocking requirement(s)"` |
| 9 | `other_findings.length >= 3` | +10 | `"{n} other findings"` |
| 10 | Any finding with `impact === 'high'` | +10 | `"{n} high-impact finding(s)"` |
| 11 | `document_status.missing_sections.length > 0` | +8 | `"Missing document sections"` |
| 12 | `foreclosure_detected` | +20 | `"Foreclosure activity detected"` |
| 13 | `recent_conveyance_detected` | +5 | `"Recent conveyance"` |
| 14 | `facts.requirements.length >= 8` | +5 | *(no reason string)* |
| 15 | `facts.requirements.length >= 15` | +5 | *(no reason string)* |

Then `score = Math.min(score, 100)`.

Rules 1/2, 6/7, and 14/15 are **cumulative tiers**, not exclusive: three liens scores 20 points, not 10. Twelve requirements scores 20. Rules 14 and 15 intentionally add points without adding a reason pill — they nudge the score for document-wide density without cluttering the UI.

Theoretical maximum before clamping: 10+10+5+15+20+10+10+15+10+10+8+20+5+5+5 = **158**, so the clamp is load-bearing on genuinely bad files.

### 10.2 Bands

| Score | Level | Label | Hex | Card background |
|---|---|---|---|---|
| 0–25 | `low` | Low | `#16a34a` | `bg-green-50 border-green-200` |
| 26–50 | `moderate` | Moderate | `#d97706` | `bg-yellow-50 border-yellow-200` |
| 51–75 | `high` | High | `#ea580c` | `bg-orange-50 border-orange-200` |
| 76–100 | `very_high` | Very High | `#dc2626` | `bg-red-50 border-red-200` |

### 10.3 Worked example

A file with 2 deeds of trust, one HOA lien, one delinquent tax parcel, 11 requirements of which 3 are blockers, 4 other findings (one high impact), no foreclosure, no recent conveyance, and 9 pre-parser requirements:

| Rule | Points | Running |
|---|---|---|
| ≥1 lien (3 liens) | +10 | 10 |
| ≥3 liens | +10 | 20 |
| HOA lien | +5 | 25 |
| Delinquent tax parcel | +20 | 45 |
| ≥5 requirements | +10 | 55 |
| ≥10 requirements | +10 | 65 |
| 3 blockers | +15 | 80 |
| ≥3 other findings | +10 | 90 |
| 1 high-impact finding | +10 | 100 |
| Pre-parser reqs ≥8 | +5 | 105 → clamped **100** |

Result: **100 / Very High**, with nine reason pills.

### 10.4 The duplication problem

`TessaComplexityScore.tsx` contains its own `computeScore()` — a byte-for-byte reimplementation of the same rules, plus the color/background mapping. The component **does not import** `computeComplexity` from `complexity.ts`.

Consequences today:

- The score persisted in `prelim_analyses.complexity_score` comes from `complexity.ts`.
- The score rendered in the gauge comes from the component's own copy, recomputed client-side from `extractionJson`.
- They currently agree because the logic is identical.
- The modal passes `facts` as `undefined` (it never fetches `facts_json`), so **rules 14 and 15 never fire in the UI**. The stored score includes them; the displayed score does not. On a file with ≥8 pre-parser requirements, the displayed gauge can read up to 10 points lower than the stored `complexity_score` — and can land in a lower band.

This is the highest-value cleanup in the feature: delete the component's copy, import the shared function, and either send `facts_json` to the client or drop rules 14–15.

---

## 11. UI and styling

### 11.1 Entry points

Rendered only when `useTessaPrelimEnabled()` returns true:

| Button | Action | Classes |
|---|---|---|
| **Prelim Summary** | `prelim_summary` | `text-[11px] px-2 py-1 rounded … bg-blue-600 text-white hover:bg-blue-700` |
| **Regenerate Summary** | `regenerate_summary` | `text-[11px] px-2 py-1 rounded border border-gray-200 bg-white text-gray-700 hover:bg-gray-50` |

Both dispatch to the same handler (`setTessaOrder(order)`), so "Regenerate" opens the same modal — the actual regeneration happens via the modal's retry path, which calls the analyze route with `?force=true`.

The hook defaults to `false` and only flips true after `/api/settings/tessa-prelim` resolves, and stays false on fetch error. The feature is invisible unless explicitly confirmed on.

### 11.2 Modal shell — `TessaPrelimResultsModal.tsx`

Full-screen overlay: `fixed inset-0 z-50 flex flex-col bg-white`.

**Header:** `bg-[#1B2A4A] text-white` (PCT navy), with a `w-8 h-8 rounded-lg bg-[#F26B2B]` orange tile containing a black **T**, the title *"TESSA™ Prelim Analysis"*, and the file number in `text-white/70`.

**Body:** `max-w-4xl mx-auto px-6 py-8`, scrollable.

**Footer disclaimer:** `text-xs text-gray-400 text-center` —

> AI-generated analysis for informational purposes only. Review with your title officer before relying on this analysis.

Escape key closes the modal.

**Five states:**

| State | Render |
|---|---|
| `loading` | Three pulsing gray blocks (`h-24`, `h-40`, `h-32`, `rounded-xl`). |
| `polling` / `triggering` | Pulsing orange **T** tile, "Analyzing Prelim…", the current step label, a numbered step rail, and "This usually takes 15–30 seconds". |
| `not_found` | Gray **T** tile, "No Analysis Yet", orange **Run Analysis** button. |
| `failed` | Red `!` tile, "Analysis Failed", the error in a `bg-red-50 border-red-200` box, orange **Retry Analysis** button (calls with `force=true`). |
| `complete` | `TessaPrelimResults`. |

**Step rail colors:** done = `bg-green-500 border-green-500 text-white` with a `✓`; active = `bg-[#F26B2B] border-[#F26B2B] text-white animate-pulse`; pending = `bg-gray-100 border-gray-300 text-gray-400`. Separator arrows are `text-gray-300`.

**Step labels:**

| Status | Label |
|---|---|
| `pending` | Queued… |
| `extracting` | Extracting PDF text… |
| `computing_facts` | Computing facts… |
| `analyzing` | Analyzing document… |
| `validating` | Validating findings… |
| `summarizing` | Generating summary… |

**Polling:** 3-second interval, `MAX_POLLS = 60` (180s ceiling), then `failed` with "Analysis timed out — please try again". Network errors during polling are swallowed so a transient blip does not kill the poll. An `inflightRef` guard prevents double-triggering.

### 11.3 Results layout — `TessaPrelimResults.tsx`

Vertical stack (`space-y-5`): complexity card, then collapsible section cards, then CTAs, then disclaimer.

**Section icon map:**

| Section | Letter | Color |
|---|---|---|
| Requirements | `✓` | `#16a34a` |
| Summary | `Σ` | `#2563eb` |
| Property | `P` | `#0891b2` |
| Liens | `$` | `#dc2626` |
| Taxes | `T` | `#d97706` |
| Other | `!` | `#7c3aed` |
| Doc Status | `i` | `#6b7280` |

Only **Summary** is `defaultOpen`. Requirements and Other Findings render only when non-empty; Liens and Taxes always render (showing "Clear" / "None" badges when empty).

**Badges:** Requirements `"{n} items"`, Liens `"{n} found"` or `"Clear"`, Taxes `"{n} parcels"` or `"None"`.

**CTAs:** an orange `tel:+18667241050` link — *"📞 Talk to a Title Officer"* (`bg-[#F26B2B] … hover:bg-[#e05a1f]`) — and a bordered *"↩ Analyze Another Prelim"* button that closes the modal.

**Results disclaimer:**

> TESSA™ is an AI-powered analysis tool. Always review the complete Preliminary Title Report and consult a licensed title officer for guidance. ©{year} Pacific Coast Title Company.

### 11.4 Section card — `TessaSectionCard.tsx`

`rounded-xl border overflow-hidden transition-shadow hover:shadow-sm`. Summary cards get `bg-blue-50/60 border-blue-200`; all others `bg-white border-gray-200`.

Header is a full-width button with `aria-expanded`: a `w-7 h-7 rounded-md` icon square filled with the section color, an uppercase `tracking-wide` title, an optional pill badge (`bg-gray-100 text-gray-600 border-gray-200`, hidden below `sm`), and a chevron that rotates 180° when open.

Body: `px-6 pb-6 pt-3 border-t border-gray-100 tessa-card-body-enter`.

**`tessa-card-body-enter` is not defined in any stylesheet in the repo** — it is a no-op class. The intended entrance animation does not run.

### 11.5 Complexity card — `TessaComplexityScore.tsx`

Container: `rounded-2xl border-2 p-5 {bandBackground} flex flex-col sm:flex-row items-start sm:items-center gap-5`.

**Gauge:** an inline SVG semicircular arc, `viewBox="0 0 104 60"`, rendered at `w-24 h-14`. Radius 42, path `M 10 52 A 42 42 0 0 1 94 52`. A gray track (`#e5e7eb`, `strokeWidth 8`, round caps) sits under a colored arc whose `strokeDasharray` is `${π·42·(score/100)} ${π·42}`, animated with `transition: stroke-dasharray 0.8s ease`. The numeric score is centered at `(52, 48)` in `fontSize 16`, `fontWeight 900`.

Under the gauge: `"{Label} Complexity"` in `text-xs font-black tracking-wider uppercase`, colored to the band.

Right side: "Complexity Assessment" heading, the property address (truncated, `max-w-xs`), a large `{score}/100` in `text-2xl font-black`, and the reason pills — `text-xs bg-white/70 border border-gray-200 text-gray-700 px-2.5 py-1 rounded-full font-medium`. Empty state: *"No significant complexity factors detected."*

### 11.6 Content components

**Requirements** (`TessaRequirementsContent`) — each item is a flex row with a `w-6 h-6 rounded-full bg-[#f26b2b]/10 text-[#f26b2b]` number chip, an uppercase type label, a severity pill, the description, then optional blue `→ {action}`, assignee, and related instrument lines.

Severity pills here:

| Severity | Classes |
|---|---|
| blocker | `bg-red-100 text-red-700 border-red-200` |
| material | `bg-yellow-100 text-yellow-700 border-yellow-200` |
| informational | `bg-green-100 text-green-700 border-green-200` |

**Liens** (`TessaLiensContent`) — empty state is a green `✓` with *"No liens or judgments detected."* Each lien is a row with a `bg-red-400` dot, uppercase red type, an amount pill, `#position`, then beneficiary / trustor / assigned-to / recorded / ref lines and a blue `→ {action_required}`.

**Taxes** (`TessaTaxContent`) — one card per parcel. Delinquent or defaulted parcels get `bg-red-50 border-red-200`; others `bg-gray-50 border-gray-200`. A monospace `ID: {tax_id}` chip, fiscal year, code area, then a two-column installment grid.

Installment status badge colors:

| Status | Classes |
|---|---|
| paid | `text-green-700 bg-green-100 border-green-300` |
| open | `text-yellow-700 bg-yellow-100 border-yellow-300` |
| delinquent | `text-red-700 bg-red-100 border-red-300` |
| defaulted | `text-red-900 bg-red-200 border-red-400` |

Exemptions render green; penalties render red.

**Other findings** (`TessaOtherFindingsContent`) — the whole card is tinted by impact: high `bg-red-50 text-red-700 border-red-200`, medium `bg-yellow-50 text-yellow-700 border-yellow-200`, low `bg-gray-50 text-gray-600 border-gray-200`.

**Document status** (`TessaDocStatusContent`) — a green `✓` / yellow `?` chip with "Document appears complete" or "Document may be incomplete", a gray metadata strip for date and order number, a red "Missing Sections" list, and notes.

**Property** (`TessaPropertyContent`) — label/value rows for Address, APN, Legal Description, Vesting, Property Type, Ownership. Rows with null values are omitted entirely.

**Summary** (`TessaSummaryContent`) — splits on blank lines and renders each block as `text-sm text-gray-700 leading-relaxed whitespace-pre-wrap`. **Markdown is not parsed**, so `**Risk Title**` from the summary prompt renders with literal asterisks.

### 11.7 Shared primitives — `TessaShared.tsx`

`KV` (label/value row), `Dollar` (tabular-nums, normal or large), `Recording` (monospace ref · date), `StatusBadge` (`✓ PAID` emerald / `◷ OPEN` amber / `✕ DELINQUENT` red), `SeverityBadgeInline` (dot + uppercase pill in red/amber/blue).

There are **three parallel severity badge implementations**: `TessaSeverityBadge.tsx` (emoji style — `🔴 BLOCKER` / `🟡 MATERIAL` / `🔵 INFO`), `SeverityBadgeInline` in `TessaShared.tsx` (dot style), and the inline `SEVERITY_BADGE` map in `TessaRequirementsContent.tsx` (plain style, the only one actually on screen in the production modal).

### 11.8 Brand tokens

| Token | Hex | Used for |
|---|---|---|
| PCT orange | `#F26B2B` | Primary buttons, active step, logo tile, requirement chips |
| Orange hover | `#E05A1A` (modal) / `#e05a1f` (results CTA) | Button hover — two casings of nearly the same color |
| PCT navy | `#1B2A4A` | Modal header |

---

## 12. Known gaps and risks

Stated plainly, in rough priority order.

1. **Duplicate scoring logic.** `TessaComplexityScore.tsx` reimplements `complexity.ts`. Because the modal never passes `facts`, the displayed score omits rules 14–15 and can be up to 10 points below the stored score, occasionally crossing a band boundary. (§10.4)
2. **No runtime schema validation on LLM JSON.** `JSON.parse` + a TypeScript cast. An out-of-enum `severity` or a string where a number is expected flows straight into the database and the UI. A Zod parse at the `callExtraction` boundary would close this with a few lines.
3. **Full PDF text is persisted.** `prelim_analyses.pdf_text` holds the entire prelim, which includes owner names, addresses, and loan details. There is no redaction, no retention policy, and no truncation on the stored copy. Any PII review of the database must account for this column.
4. **No cost cap.** There is no token budget, no per-day spend ceiling, and no rate limiter. Cost control is entirely the on/off switches plus the 5-per-cycle cron batch. The resume runbook explicitly warns about a backlog flood.
5. **Two orphaned client integrations.** `TessaContext.tsx` calls `/api/tessa/chat` and `usePrelimAnalysis.ts` calls `/api/tessa/analyze`; neither route exists. Both files are dead weight that will 404 if ever mounted.
6. **The markdown guardrail suite is unreachable.** ~400 lines of validated, ported logic (`validatePrelimOutput`, `buildRepairPrompt`, the injectors) that the pipeline never calls. It should either be wired to a markdown surface or removed, but leaving it invites someone to assume it runs.
7. **No repair retry loop.** The JSON path has no equivalent of `buildRepairPrompt` — if the model produces a structurally poor extraction, the deterministic injections are the only correction. There is no second LLM pass.
8. **Status label mismatch.** `computing_facts` and `validating` appear in the UI step rail but are never persisted; `downloading` is persisted but missing from the rail.
9. **`tessa-card-body-enter` is undefined.** Dead CSS class; the intended card entrance animation never plays.
10. **Model name hardcoded twice.** `MODEL` in `ai-client.ts` and two string literals in `pipeline.ts`.
11. **Three severity badge components.** Only one is on screen; the other two drift unnoticed.
12. **No unit tests on the core.** There are no tests for `pipeline.ts`, `tessa-guardrails.ts`, `complexity.ts`, `ai-client.ts`, or `tessa-pre-parser.ts`. The only TESSA-adjacent tests are `src/app/api/orders/[id]/detail-tabs-access.test.ts` (route access control) and `src/components/sales/closed-files-drilldown-modal.test.ts` (asserts the dead modal stayed deleted). `computeComplexity` is a pure function with fifteen branches and is the single easiest high-value test target.
13. **Summary markdown is not rendered as markdown.** Bold syntax from the summary prompt shows as literal asterisks.

---

## 13. Operations

### 13.1 Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Required. No key ⇒ health check reports `broken`. |
| `TESSA_AUTO_ANALYSIS_ENABLED` | `true` | Cron + webhook master kill. |
| `TESSA_MANUAL_ANALYSIS_ENABLED` | `true` | Manual API master kill. |
| `AWS_BUCKET`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | — | PDF download from S3. |

Flag parsing accepts `true`/`1`/`yes` and `false`/`0`/`no` case-insensitively; anything else falls back to the default.

### 13.2 Admin settings

| Key | Default | Category | Effect |
|---|---|---|---|
| `tessa_prelim_enabled` | `false` | TESSA | Master admin toggle. Off hides the buttons, blocks all new analysis, and makes the manual endpoint reject. Existing analyses are **not** deleted. |
| `prelim_summary_shut_off` | `false` | Notifications | Prelim webhooks are received and logged as `prelim_webhook_skipped` but not processed. |

Toggling `tessa_prelim_enabled` in `SettingsPanel.tsx` shows a confirmation dialog.

### 13.3 Cron behavior — `fetch-prelims`

**Phase 1 (fetch):** selects up to 50 orders in `open`/`in_process`/`completed` status that have no active prelim document and whose `last_prelim_fetch_at` is null or older than 6 hours, ordered nulls-first. For each, pulls from SoftPro `GetAttachedDocuments`, stores to S3, and — if `isTessaAutoAnalysisEnabled()` — triggers `analyzePrelim({ triggeredBy: 'cron' })`. Exits cleanly at the 240-second budget with `timedOut: true`.

**Phase 2 (retry):** skipped entirely if Phase 1 timed out, or if auto-analysis is paused (logs one line per cycle). Otherwise a `distinct on (document_id)` CTE picks the latest analysis per prelim document and selects up to **5** candidates where the analysis is missing, or is `failed`/`pending` with `attempt_count < 5`, and no `complete` analysis exists for that document. On the fifth failed attempt, `markTessaRetryCapReached` sets `status='failed'`, `attempt_count=5`, `error_type='max_attempts_reached'`, and `error_message = "Failed after 5 attempts: {error}"`.

The retry cap exists because of a specific incident — the code comment cites *"ops report incident 2026-05-26 (Orders 324, 3259)"*, image-based PDFs that could never be text-extracted and were retried indefinitely.

### 13.4 Webhook behavior

`handlePrelimWebhook` resolves the order, checks `prelim_summary_shut_off`, then per URL: downloads the PDF, stores it to S3 as a `prelim` document, runs `maybeAutoDeliverPrelim`, queues an `order.document.received` event, and calls `analyzePrelim({ triggeredBy: 'webhook' })` **without awaiting** — the promise gets a `.catch` that logs, and is handed to `waitUntil` when available. A TESSA failure can never fail the webhook response.

### 13.5 Monitoring

- **`GET /api/health/tessa`** — the seven checks in §9.
- **Ops dashboard** (`src/components/admin/ops/tessa-status.tsx`) — monthly totals, successful/failed/pending counts, prelims awaiting analysis, an error breakdown, and the ten most recent analyses with per-row processing time. Auto-refreshes every 60 seconds. Shows a red banner when there are failures and zero successes.
- **Daily ops report, section 12** (`getTessaPrelimAnalysisSection` in `src/lib/domain/ops/daily-report.ts`) — cron-triggered count, on-demand count, successes, failures, and `backlogFetchedNotAnalyzed` (active prelim documents with no complete analysis) over the reporting window.
- **`vendor_api_logs`** — every Anthropic call with token counts, filterable by `operation IN ('tessa_extract','tessa_summarize')`. This is the source for actual spend reconciliation.

### 13.6 Debugging a failed analysis

1. `GET /api/health/tessa` — rule out schema drift, a missing key, S3, and `pdf-parse`.
2. Read the row: `select status, error_step, error_message, error_type, attempt_count, pdf_char_count from prelim_analyses where order_id = ?`.
3. Interpret `error_step`:
   - `extracting` — usually an image-only PDF (`Extracted text too short`) or an S3 miss. If `attempt_count = 5` and `error_type = 'max_attempts_reached'`, it will never self-heal; the PDF needs OCR or manual handling.
   - `computing_facts` — a pre-parser regex threw. Inspect `pdf_text`.
   - `analyzing` — Anthropic error or unparseable JSON. Check `vendor_api_logs` for the matching `tessa_extract` row.
   - `summarizing` — the extraction is intact and stored; only the narrative is missing.
4. Diff `raw_extraction_json` against `extraction_json` to see what the guardrails corrected.
5. Retry with `POST /api/orders/{id}/analyze-prelim?force=true`, which resets `attempt_count` to 0.

---

## 14. Reading order for a new maintainer

1. `src/lib/tessa/pipeline.ts` — the spine.
2. `src/lib/tessa/analysis-config.ts` — why nothing runs when it does not run.
3. `src/lib/tessa/tessa-pre-parser.ts` — where truth comes from.
4. `src/lib/tessa/tessa-prompts.ts` — what the model is told.
5. `src/lib/tessa/tessa-guardrails.ts`, `validateAndRepairExtraction` only (line 521 onward).
6. `src/lib/tessa/complexity.ts` — the score.
7. `src/lib/db/schema/tessa.ts` — the record.
8. `src/components/tessa/TessaPrelimResultsModal.tsx` — the surface.
