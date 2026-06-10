// ============================================================
// TESSA™ Analysis Kill Switches — env-driven, reversible pause
// ============================================================
//
// RESUME RUNBOOK
// --------------
// 1. Set TESSA_AUTO_ANALYSIS_ENABLED=true in Render/Vercel env.
// 2. Redeploy (or cold-start refresh — Next.js reads process.env at boot).
// 3. Backlog re-queues automatically:
//    - New prelims stored during pause have no analysis row → Phase 1 cron triggers analyzePrelim.
//    - Failed/pending rows with attempt_count < MAX_TESSA_ATTEMPTS → Phase 2 retry loop.
// 4. COST WARNING: A large pause backlog may flood LLM calls on the first cron cycles
//    after resume (new docs + up to 5 retries per 30-min cycle). Consider staged resume
//    or temporary rate limits if backlog is large.
//
// MANUAL / ON-DEMAND (Director decision)
// --------------------------------------
// TESSA_AUTO_ANALYSIS_ENABLED pauses cron + webhook automated spend only.
// TESSA_MANUAL_ANALYSIS_ENABLED (default true) gates user-initiated API analysis.
// Set TESSA_MANUAL_ANALYSIS_ENABLED=false to block ALL TESSA LLM spend including manual.

export type TessaTrigger = 'webhook' | 'cron' | 'manual';

function parseEnvFlag(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return defaultValue;
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  return defaultValue;
}

/** When false, cron + webhook paths make zero LLM calls. Defaults to true (enabled). */
export function isTessaAutoAnalysisEnabled(): boolean {
  return parseEnvFlag('TESSA_AUTO_ANALYSIS_ENABLED', true);
}

/** When false, manual analyze-prelim API makes zero LLM calls. Defaults to true (enabled). */
export function isTessaManualAnalysisEnabled(): boolean {
  return parseEnvFlag('TESSA_MANUAL_ANALYSIS_ENABLED', true);
}

export function isAutomatedTrigger(triggeredBy: TessaTrigger): boolean {
  return triggeredBy === 'cron' || triggeredBy === 'webhook';
}

export function isTessaLlmAllowed(triggeredBy: TessaTrigger): boolean {
  if (triggeredBy === 'manual') return isTessaManualAnalysisEnabled();
  return isTessaAutoAnalysisEnabled();
}

export class TessaAnalysisPausedError extends Error {
  readonly scope: 'auto' | 'manual';

  constructor(scope: 'auto' | 'manual') {
    const flag = scope === 'auto' ? 'TESSA_AUTO_ANALYSIS_ENABLED' : 'TESSA_MANUAL_ANALYSIS_ENABLED';
    super(`TESSA ${scope} analysis paused (${flag}=false)`);
    this.name = 'TessaAnalysisPausedError';
    this.scope = scope;
  }
}

/** Chokepoint guard — throws before any Anthropic API request is made. */
export function assertTessaLlmAllowed(triggeredBy: TessaTrigger): void {
  if (!isTessaLlmAllowed(triggeredBy)) {
    throw new TessaAnalysisPausedError(isAutomatedTrigger(triggeredBy) ? 'auto' : 'manual');
  }
}

export function logAutomatedAnalysisPaused(context: {
  triggeredBy: TessaTrigger;
  orderId: number;
  documentId: number;
}): void {
  console.log(
    `[TESSA] Auto-analysis PAUSED (TESSA_AUTO_ANALYSIS_ENABLED=false); ` +
      `skipped order ${context.orderId} doc ${context.documentId} ` +
      `trigger=${context.triggeredBy} — prelim remains un-analyzed for resume`,
  );
}

/** One log line per fetch-prelims cron cycle when auto-analysis is off. */
export function logCronCycleAutoAnalysisPaused(): void {
  console.log(
    '[TESSA] Auto-analysis PAUSED (TESSA_AUTO_ANALYSIS_ENABLED=false); ' +
      'fetch-prelims cron skipping all automated LLM calls this cycle. ' +
      'Prelims remain un-analyzed for resume.',
  );
}
