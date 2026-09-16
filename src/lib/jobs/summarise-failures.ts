// ─── A handler that RETURNS is not a handler that SUCCEEDED ─────────────────
//
// The runner recorded `status: 'completed'` for any handler that returned
// without throwing, whatever the returned object said. Handlers already count
// their failures — retry-softpro-document-attach returns
// `{ attempted, synced, failed, errors }` — and every one of those counts was
// discarded at the point of writing the row.
//
// MEASURED CONSEQUENCE. softpro.retry_document_attach: 5,926 runs, ZERO
// recorded as failed, ever, while the AddDocuments calls inside them returned
// 400 on every attempt for 20 orders. The job was the only thing watching that
// path, and it reported success 5,926 times.
//
// This reads the shape handlers already return. It invents no new contract and
// no handler has to change.

export interface JobOutcome {
  status: 'completed' | 'failed';
  error: string | null;
}

/** Numeric field from a handler result, if it is actually a number. */
function num(result: unknown, key: string): number | null {
  if (typeof result !== 'object' || result === null) return null;
  const v = (result as Record<string, unknown>)[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function summariseFailures(result: unknown): JobOutcome {
  const failed = num(result, 'failed');
  if (failed === null || failed <= 0) return { status: 'completed', error: null };

  const attempted = num(result, 'attempted') ?? num(result, 'total');
  const synced = num(result, 'synced') ?? num(result, 'succeeded');

  // Sample the handler's own error strings rather than inventing a message.
  let detail = '';
  if (typeof result === 'object' && result !== null) {
    const errs = (result as Record<string, unknown>).errors;
    if (Array.isArray(errs) && errs.length > 0) {
      const first = errs.slice(0, 3).map((e) => {
        if (typeof e === 'string') return e;
        if (typeof e === 'object' && e !== null) {
          const o = e as Record<string, unknown>;
          const id = o.documentId ?? o.orderId ?? o.id;
          return `${id != null ? `#${id}: ` : ''}${String(o.error ?? o.message ?? 'error')}`;
        }
        return String(e);
      });
      detail = ` — ${first.join(' | ')}${errs.length > 3 ? ` (+${errs.length - 3} more)` : ''}`;
    }
  }

  const counts = attempted !== null
    ? `${failed} of ${attempted} failed`
    : `${failed} failed`;

  // TOTAL failure is a failed run. Nothing the job set out to do happened, and
  // calling that "completed" is the defect this module exists to remove.
  //
  // PARTIAL failure keeps `completed` — work did land, and flipping the status
  // would make every partially-successful sweep look like an outage. The reason
  // still goes in `error`, so it is never silent either way.
  const totalFailure = synced !== null ? synced === 0 : attempted !== null && failed >= attempted;

  return {
    status: totalFailure ? 'failed' : 'completed',
    error: `${counts}${detail}`.slice(0, 2000),
  };
}
