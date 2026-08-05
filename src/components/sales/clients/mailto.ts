// Building the mailto: URL that hands a draft off to Outlook.
//
// mailto is plain text and has no standard length limit, but real clients and
// browsers cap the URL. Windows historically truncates around 2000 characters,
// so we budget against that rather than the body length alone — percent-encoding
// can double or triple a character's cost, and a body that looks short can still
// blow the URL.

/** Conservative ceiling for the whole mailto: URL. */
export const MAX_MAILTO_URL = 1900;

export interface MailtoParts {
  to: string | null;
  subject?: string;
  body?: string;
}

export interface MailtoResult {
  href: string;
  /** True when the body had to be shortened to fit the URL budget. */
  truncated: boolean;
  /** True when there is no recipient — the client opens with an empty To. */
  missingRecipient: boolean;
}

/**
 * Builds a mailto: href, trimming the body if the encoded URL would exceed the
 * budget. Trimming the BODY specifically (never the subject or recipient) keeps
 * the email usable — a cut-off subject line looks broken, a slightly shortened
 * body the rep is about to edit anyway does not.
 *
 * A client with no email on record still gets a valid href with an empty
 * recipient, so the action degrades to "opens Outlook" rather than erroring.
 */
export function buildMailto({ to, subject, body }: MailtoParts): MailtoResult {
  const recipient = (to ?? '').trim();
  const missingRecipient = recipient.length === 0;

  const base = `mailto:${encodeURIComponent(recipient)}`;
  const subjectParam = subject?.trim()
    ? `subject=${encodeURIComponent(subject.trim())}`
    : '';

  const assemble = (b: string): string => {
    const params = [subjectParam, b ? `body=${encodeURIComponent(b)}` : '']
      .filter(Boolean)
      .join('&');
    return params ? `${base}?${params}` : base;
  };

  const full = (body ?? '').trim();
  let href = assemble(full);
  if (href.length <= MAX_MAILTO_URL || !full) {
    return { href, truncated: false, missingRecipient };
  }

  // Binary search the longest body that fits — encoded length is not linear in
  // character count, so trimming by a fixed ratio would either overshoot or
  // leave the URL still too long.
  let lo = 0;
  let hi = full.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (assemble(full.slice(0, mid)).length <= MAX_MAILTO_URL) lo = mid;
    else hi = mid - 1;
  }

  href = assemble(full.slice(0, lo));
  return { href, truncated: true, missingRecipient };
}
