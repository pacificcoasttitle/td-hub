import { describe, expect, it } from 'vitest';
import {
  buildPartyWizardEmail, buildPartyWizardSubject, buildPartyWizardText,
} from './party-wizard-email';

const URL_A = 'https://hub.pctitle.com/party-wizard/abc123.secret.sig';
const URL_B = 'https://hub.pctitle.com/party-wizard/def456.secret.sig';

const base = {
  fileNumber: '20020625-OCT',
  propertyAddress: '1358 5th St, La Verne, CA 91750',
  transactionType: 'Purchase',
  recipientName: 'Liliana Arias',
  audience: 'internal' as const,
  openedAt: new Date('2026-08-15T17:00:00Z'),
  roleLinks: [{ role: 'listing_agent' as const, url: URL_A }],
};

/** Same order, resolved to an outside escrow firm instead of a PCT officer. */
const external = {
  ...base,
  recipientName: 'Dana Ruiz',
  recipientCompany: 'Corner Escrow, Inc.',
  audience: 'external' as const,
};

describe('party wizard invite email', () => {
  it('names the file in the subject so it threads against the order', () => {
    expect(buildPartyWizardSubject(base)).toBe('Missing listing agent details — file 20020625-OCT');
  });

  it('labels the forward instruction unmistakably', () => {
    expect(buildPartyWizardEmail(base)).toContain('Forward this to the listing agent');
  });

  it('greets the officer by first name only', () => {
    expect(buildPartyWizardEmail(base)).toContain('Hi Liliana,');
  });

  it('falls back to a plain greeting when the name is unknown', () => {
    const html = buildPartyWizardEmail({ ...base, recipientName: null });
    expect(html).toContain('Hi,');
  });

  it('includes the link as both a button and a readable URL', () => {
    // Some clients drop the anchor when the mail is forwarded and re-quoted.
    const html = buildPartyWizardEmail(base);
    expect(html).toContain(`href="${URL_A}"`);
    expect(html.split(URL_A).length - 1).toBeGreaterThanOrEqual(2);
  });

  it('shows the file details the officer needs to recognise the order', () => {
    const html = buildPartyWizardEmail(base);
    expect(html).toContain('20020625-OCT');
    expect(html).toContain('1358 5th St, La Verne, CA 91750');
    expect(html).toContain('Purchase');
  });

  it('omits detail rows that have no value rather than printing blanks', () => {
    const html = buildPartyWizardEmail({ ...base, propertyAddress: null, transactionType: null });
    expect(html).not.toContain('Property</td>');
    expect(html).not.toContain('Transaction</td>');
    expect(html).toContain('File number');
  });

  it('states the 60-day expiry so the officer knows it is not indefinite', () => {
    expect(buildPartyWizardEmail(base)).toContain('60 days');
  });

  it('makes clear PCT is not emailing the party directly', () => {
    expect(buildPartyWizardEmail(base)).toContain('the forward remains yours to make');
  });

  // ─── Copy the operator approved ───────────────────────────────────────────
  //
  // Reviewed against real output for file 20021227-OCT. Both defects below were
  // visible only once a full body was read, which is why the dry run keeps one.

  describe('the approved copy', () => {
    /**
     * The two bodies worded the same ask differently — "the listing agent details
     * for this file" in HTML, "listing agent details on file X" in text. Whoever
     * approved one had not read the other.
     */
    it('words the ask identically in HTML and plain text', () => {
      const ask = 'We do not have the listing agent details for this file, so we cannot '
        + 'contact them directly. Please forward the secure link below.';
      expect(buildPartyWizardEmail(base)).toContain(ask);
      expect(buildPartyWizardText(base)).toContain(ask);
    });

    /**
     * The email said what to do and gave no reason to do it today. This states
     * the consequence, and claims only what is true: the job invites once per
     * file and never follows up.
     */
    it('says what happens if the link is not forwarded, in both bodies', () => {
      const consequence = 'This is the only reminder we send for this file. Until the listing '
        + 'agent details are on the order we have no way to contact them ourselves, so anything '
        + 'they need keeps coming back to you.';
      expect(buildPartyWizardEmail(base)).toContain(consequence);
      expect(buildPartyWizardText(base)).toContain(consequence);
    });

    it('promises no date it cannot keep — there is no closing date on the record', () => {
      for (const body of [buildPartyWizardEmail(base), buildPartyWizardText(base)]) {
        expect(body).not.toMatch(/business days/i);
        expect(body).not.toMatch(/within \d+ (hours|days)/i);
        expect(body).not.toMatch(/by (Monday|Tuesday|Wednesday|Thursday|Friday)/i);
      }
    });
  });

  // ─── The external variant ─────────────────────────────────────────────────
  //
  // The copy above was written for a PCT escrow officer. Only 18.2% of the
  // escrow-officer contacts orders point at are on a @pct.com address, and the
  // escrow_company fallback resolves almost entirely to outside firms. Sending
  // colleague copy to a stranger reads as a misdirected email, and a
  // misdirected email does not get forwarded.

  describe('external recipients get copy written for a stranger', () => {
    it('names PCT in the subject, which the internal subject never does', () => {
      expect(buildPartyWizardSubject(external)).toBe(
        'Pacific Coast Title — listing agent details needed on file 20020625-OCT',
      );
      expect(buildPartyWizardSubject(base)).not.toContain('Pacific Coast Title');
    });

    it('introduces PCT and states the relationship to their file, in both bodies', () => {
      const ask = 'Pacific Coast Title is handling the title work on this file, which you are '
        + 'holding escrow on. We do not have the listing agent details, so we cannot contact '
        + 'them directly. If you have them, please forward the secure link below.';
      expect(buildPartyWizardEmail(external)).toContain(ask);
      expect(buildPartyWizardText(external)).toContain(ask);
    });

    it('gives a stranger a way out if the file is not theirs, in both bodies', () => {
      const out = 'If this file is not one of yours, please disregard this message — no reply '
        + 'is needed and we will not follow up.';
      expect(buildPartyWizardEmail(external)).toContain(out);
      expect(buildPartyWizardText(external)).toContain(out);
      // A colleague can just open the order; they do not need this.
      expect(buildPartyWizardEmail(base)).not.toContain('please disregard this message');
      expect(buildPartyWizardText(base)).not.toContain('please disregard this message');
    });

    it('names the firm so they can tell which of their files this is', () => {
      expect(buildPartyWizardEmail(external)).toContain('Corner Escrow, Inc.');
      expect(buildPartyWizardText(external)).toContain('Escrow held by: Corner Escrow, Inc.');
    });

    it('says "Pacific Coast Title" where the internal copy says "TD Hub"', () => {
      expect(buildPartyWizardEmail(base))
        .toContain('TD Hub will not contact the party');
      expect(buildPartyWizardEmail(external))
        .toContain('Pacific Coast Title will not contact the party');
      expect(buildPartyWizardEmail(external)).not.toContain('TD Hub will not contact');
    });

    /**
     * "Action required" is what you say to a colleague. To an outside firm doing
     * us a favour on a file we have no claim over, it is an instruction we are
     * not entitled to give.
     */
    it('asks rather than instructs', () => {
      expect(buildPartyWizardEmail(base)).toContain('Action required');
      expect(buildPartyWizardEmail(external)).not.toContain('Action required');
      expect(buildPartyWizardEmail(external)).toContain('Request');
    });

    /**
     * The consequence line is the one the owner approved and it is true for both
     * readers: whoever holds escrow is the routing point for anything the
     * missing party needs. It must not drift per audience.
     */
    it('keeps the approved consequence line word for word', () => {
      const consequence = 'This is the only reminder we send for this file. Until the listing '
        + 'agent details are on the order we have no way to contact them ourselves, so anything '
        + 'they need keeps coming back to you.';
      for (const body of [
        buildPartyWizardEmail(external), buildPartyWizardText(external),
        buildPartyWizardEmail(base), buildPartyWizardText(base),
      ]) {
        expect(body).toContain(consequence);
      }
    });

    it('makes no promise it cannot keep, same as the internal copy', () => {
      for (const body of [buildPartyWizardEmail(external), buildPartyWizardText(external)]) {
        expect(body).not.toMatch(/business days/i);
        expect(body).not.toMatch(/within \d+ (hours|days)/i);
      }
    });

    it('still carries the link as a button and a readable URL', () => {
      const html = buildPartyWizardEmail(external);
      expect(html).toContain(`href="${URL_A}"`);
      expect(html.split(URL_A).length - 1).toBeGreaterThanOrEqual(2);
      expect(buildPartyWizardText(external)).toContain(URL_A);
    });

    it('omits the firm row when we do not have the company name', () => {
      const html = buildPartyWizardEmail({ ...external, recipientCompany: null });
      expect(html).not.toContain('Escrow held by');
      expect(html).toContain('20020625-OCT');
    });

    it('keeps the plain-text variant free of markup', () => {
      expect(buildPartyWizardText(external)).not.toMatch(/<[a-z/]/i);
    });
  });

  describe('extends to more roles without a redesign', () => {
    const two = {
      ...base,
      roleLinks: [
        { role: 'listing_agent' as const, url: URL_A },
        { role: 'buyer_agent' as const, url: URL_B },
      ],
    };

    it('renders one forwardable block per role', () => {
      const html = buildPartyWizardEmail(two);
      expect(html).toContain('Forward this to the listing agent');
      expect(html).toContain('Forward this to the buyer agent');
      expect(html).toContain(URL_A);
      expect(html).toContain(URL_B);
    });

    it('pluralises the copy and the subject', () => {
      expect(buildPartyWizardSubject(two)).toContain('listing agent and buyer agent');
      expect(buildPartyWizardEmail(two)).toContain('secure links below');
    });
  });

  it('escapes HTML in order data so a crafted address cannot inject markup', () => {
    const html = buildPartyWizardEmail({ ...base, propertyAddress: '<script>alert(1)</script>' });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  describe('plain-text fallback', () => {
    it('carries the same instruction and the raw URL', () => {
      const text = buildPartyWizardText(base);
      expect(text).toContain('FORWARD THIS TO THE LISTING AGENT:');
      expect(text).toContain(URL_A);
    });

    it('contains no markup', () => {
      expect(buildPartyWizardText(base)).not.toMatch(/<[a-z/]/i);
    });

    it('lists every role link', () => {
      const text = buildPartyWizardText({
        ...base,
        roleLinks: [
          { role: 'listing_agent' as const, url: URL_A },
          { role: 'buyer_agent' as const, url: URL_B },
        ],
      });
      expect(text).toContain(URL_A);
      expect(text).toContain(URL_B);
    });
  });
});
