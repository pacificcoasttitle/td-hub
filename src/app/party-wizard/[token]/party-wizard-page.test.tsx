import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { classifyLinkState } from '@/lib/domain/parties/party-wizard-context';
import type {
  ResolveResult, ResolvedLink, WizardOrderContext,
} from '@/lib/domain/parties/party-wizard-service';
import { getRoleForm } from '@/lib/domain/parties/party-wizard-fields';
import { FAILURE_PANEL } from '@/components/party-wizard/status-panel';
import { WizardPageBody } from './wizard-page-body';
import { SubmittedPanel } from './party-wizard-form';

// ─── The public page, state by state ─────────────────────────────────────────
//
// Rendered rather than read. The whole subsystem exists to be looked at by a
// stranger who suspects it is phishing, so the assertions are about what a
// stranger can see, and the most important one is what they CANNOT.

const LISTING_AGENT_FORM = getRoleForm('listing_agent')!;

/** A real order shape: outside escrow officer, purchase, seller on file. */
function context(over: Partial<WizardOrderContext> = {}): WizardOrderContext {
  return {
    fileNumber: '20021227-OCT',
    propertyAddress: '8613 Bonita Rd, Fontana, CA, 92335',
    transactionType: 'Purchase',
    openedAt: new Date('2026-08-19T17:00:00Z'),
    counterpartName: 'Alex Dorado Jimenez',
    contact: {
      name: 'Rose Lucero',
      company: 'Powerhouse Escrow',
      email: 'rose@powerhouseescrow.com',
      phone: '(818) 643-3225',
      kind: 'escrow_officer',
    },
    ...over,
  };
}

function link(over: Partial<ResolvedLink> = {}): ResolvedLink {
  return {
    linkId: 1,
    orderId: 7420,
    role: 'listing_agent',
    tokenId: 'a'.repeat(32),
    form: LISTING_AGENT_FORM,
    order: context(),
    previousValues: null,
    alreadySubmitted: false,
    ...over,
  };
}

function render(resolved: ResolveResult): string {
  return renderToStaticMarkup(<WizardPageBody token="tok" resolved={resolved} />);
}

/** Strip tags so copy assertions are not defeated by markup between words. */
function text(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

const FRESH: ResolveResult = { ok: true, link: link() };
const RETURNING: ResolveResult = {
  ok: true,
  link: link({
    alreadySubmitted: true,
    previousValues: {
      agentName: 'Jane Smith',
      agentEmail: 'jane@coastrealty.com',
      agentPhone: '(555) 555-5555',
      agentCompany: 'Coast Realty',
    },
  }),
};
const INACTIVE: ResolveResult = { ok: false, reason: 'inactive', order: context() };
const INVALID: ResolveResult = { ok: false, reason: 'invalid' };
const UNSUPPORTED: ResolveResult = { ok: false, reason: 'unsupported', order: context() };
/**
 * Rate limited. No `order`, and not by omission — the guard blocks in front of
 * resolution, so on this path no order has been loaded at all.
 */
const THROTTLED: ResolveResult = { ok: false, reason: 'throttled' };

const ALL_STATES: Array<[string, ResolveResult]> = [
  ['fresh form', FRESH],
  ['returning to a used link', RETURNING],
  ['inactive link', INACTIVE],
  ['invalid link', INVALID],
  ['unsupported role', UNSUPPORTED],
  ['throttled request', THROTTLED],
];

// ─── The constraint that matters most ────────────────────────────────────────

describe('the NEVER list is never rendered, in any state', () => {
  /**
   * The order this page is built from carries all of these. None of them may
   * reach an unauthenticated stranger holding a forwarded URL.
   *
   * Matched as labels rather than values because a value can be coincidental —
   * a label is proof someone deliberately added a row.
   */
  const FORBIDDEN_LABELS = [
    /sales\s*price/i,
    /purchase\s*price/i,
    /loan\s*(amount|number)/i,
    /\blender\b/i,
    /mortgage/i,
    /\bbuyer\b/i,
    /\bborrower\b/i,
    /\bvesting\b/i,
    /\bapn\b/i,
    /\bcounty\b/i,
    /legal\s*description/i,
    /policy\s*type/i,
    /underwriter/i,
    /\bescrow\s*number\b/i,
    /\btitle\s*company\b/i,
  ];

  /**
   * Our own wordmark says "Pacific Coast Title Company" and the escrow officer
   * works at one. The forbidden thing is the OTHER title company on the order
   * (orders.title_company_id), so the two known-safe names come out before the
   * label scan rather than the pattern being weakened to let them through.
   */
  function scannable(state: ResolveResult): string {
    return text(render(state))
      .replace(/PACIFIC COAST TITLE COMPANY/g, '')
      .replace(/Pacific Coast Title Company/g, '')
      .replace(/Title officer, Pacific Coast Title/g, '');
  }

  it.each(ALL_STATES)('%s shows no forbidden label', (_name, state) => {
    const rendered = scannable(state);
    for (const label of FORBIDDEN_LABELS) {
      expect(rendered, `matched ${label} in: ${rendered.slice(0, 400)}`).not.toMatch(label);
    }
  });

  /**
   * Money has a shape. `sales_price` and `loan_amount` are decimals stored as
   * "775000.00", and formatCurrency renders them as "$775,000" — so the two
   * shapes below are what a leak would actually look like. Bare integers are
   * not checked, because a street number and a ZIP are both approved.
   */
  it.each(ALL_STATES)('%s shows nothing shaped like money', (_name, state) => {
    const rendered = text(render(state));
    expect(rendered).not.toMatch(/\$\s?\d/);
    expect(rendered).not.toMatch(/\d,\d{3}\b/);
    expect(rendered).not.toMatch(/\b\d+\.\d{2}\b/);
  });

  /**
   * The real enforcement point. Nothing forbidden can be rendered if nothing
   * forbidden is in the context, so this asserts the shape of the context
   * itself. Adding a field here should be a decision someone makes on purpose,
   * with the owner, and a failing test is how that decision gets forced.
   */
  it('the order context carries exactly the approved fields and no others', () => {
    expect(Object.keys(context()).sort()).toEqual([
      'contact',
      'counterpartName',
      'fileNumber',
      'openedAt',
      'propertyAddress',
      'transactionType',
    ]);
  });

  it('the contact carries no title and no extension, because neither exists in the data', () => {
    const contact = context().contact!;
    expect(Object.keys(contact).sort()).toEqual(['company', 'email', 'kind', 'name', 'phone']);
  });
});

// ─── Each state renders the right panel ──────────────────────────────────────

describe('fresh form', () => {
  const html = render(FRESH);
  const body = text(html);

  it('leads with the referrer, named, at their own company', () => {
    expect(body).toContain('Rose Lucero at Powerhouse Escrow asked us to reach you about this file.');
  });

  it('shows the four approved order facts and the form heading', () => {
    expect(body).toContain('Listing agent details');
    expect(body).toContain('8613 Bonita Rd, Fontana, CA, 92335');
    expect(body).toContain('20021227-OCT');
    expect(body).toContain('Purchase');
    expect(body).toContain('Aug 19, 2026');
  });

  it('states the size of the ask, counted from the form definition', () => {
    // LISTING_AGENT_FORM.sections[0] has four fields.
    expect(LISTING_AGENT_FORM.sections[0].fields).toHaveLength(4);
    expect(body).toContain('Four fields, about a minute.');
  });

  it('carries the anti-phishing line', () => {
    expect(body).toContain('We will never ask you for a bank account, a wire instruction, or a password.');
  });

  it('keeps the mobile input contract — 44px targets and 16px text', () => {
    const inputs = html.match(/<input[^>]*>/g) ?? [];
    expect(inputs).toHaveLength(7);
    for (const input of inputs) {
      expect(input).toContain('min-h-[44px]');
      expect(input).toContain('text-base');
    }
    expect(html).toContain('inputMode="tel"');
    expect(html).toContain('inputMode="email"');
    expect(html).toContain('autoComplete="organization"');
  });

  it('offers a 48px submit target', () => {
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*class="[^"]*min-h-\[48px\]/);
  });
});

describe('returning to a link that was already used', () => {
  const body = text(render(RETURNING));

  it('says the details arrived instead of showing a live form', () => {
    expect(body).toContain('You have already sent these details');
    expect(body).toContain('Update these details');
  });

  it('shows what was sent, read-only', () => {
    expect(body).toContain('Jane Smith');
    expect(body).toContain('jane@coastrealty.com');
    expect(body).toContain('Coast Realty');
  });

  it('renders no text inputs at all — a prefilled form reads as one that was never received', () => {
    expect(render(RETURNING).match(/<input/g)).toBeNull();
  });

  it('does not offer the submit button', () => {
    expect(body).not.toContain('Submit details');
  });
});

describe('just submitted', () => {
  const body = text(renderToStaticMarkup(<SubmittedPanel />));

  it('confirms receipt', () => {
    expect(body).toContain('Thank you — we have your details');
  });

  it('states the three things that actually happen, and no others', () => {
    expect(body).toContain('Your details are recorded against the file.');
    expect(body).toContain('They are posted to the order notes, where your escrow officer sees them.');
    expect(body).toContain('Nobody else is contacted on your behalf.');
  });

  it('offers no call to action, because there is nothing further to ask for', () => {
    expect(renderToStaticMarkup(<SubmittedPanel />)).not.toContain('<button');
  });
});

describe('inactive link — the collapsed revoked/expired state', () => {
  const body = text(render(INACTIVE));

  it('says nothing about why', () => {
    expect(body).toContain('This link is no longer active');
    expect(body).not.toMatch(/withdraw/i);
    expect(body).not.toMatch(/revok/i);
    expect(body).not.toMatch(/expired/i);
  });

  it('routes to a human with the file number prefilled into the mail client', () => {
    const html = render(INACTIVE);
    expect(html).toContain('mailto:rose@powerhouseescrow.com?subject=New%20link%20for%20file%2020021227-OCT');
    expect(body).toContain('Ask for a new link');
  });

  it('offers no self-service re-request, which would be a send path around the master switch', () => {
    expect(body).not.toMatch(/send me a new link/i);
    expect(render(INACTIVE)).not.toContain('<form');
  });

  it('says it once — the hero carries the message and the card carries the way out', () => {
    expect(body.match(/This link is no longer active/g)).toHaveLength(1);
  });
});

describe('the hero eyebrow tracks the state it sits above', () => {
  it('asks for action only where action is actually wanted', () => {
    expect(text(render(FRESH))).toContain('Action required');
  });

  it('does not ask for action from someone who already sent their details', () => {
    const body = text(render(RETURNING));
    expect(body).toContain('Already received');
    expect(body).not.toContain('Action required');
  });

  it('does not ask for action on a dead link', () => {
    const body = text(render(INACTIVE));
    expect(body).toContain('Link status');
    expect(body).not.toContain('Action required');
  });

  it('does not contradict the thank-you panel after a submission', () => {
    // The header is rendered by the form precisely so this cannot drift; see
    // the note on PartyWizardForm's `context` prop.
    const body = text(renderToStaticMarkup(<SubmittedPanel />));
    expect(body).not.toContain('Action required');
  });
});

describe('revoked and expired are indistinguishable', () => {
  const NOW = new Date('2026-08-26T12:00:00Z');
  const revoked = { revokedAt: new Date('2026-08-01T00:00:00Z'), expiresAt: new Date('2026-10-25T00:00:00Z') };
  const expired = { revokedAt: null, expiresAt: new Date('2026-06-01T00:00:00Z') };

  it('the page has no separate copy to give them, by construction', () => {
    expect(Object.keys(FAILURE_PANEL).sort())
      .toEqual(['inactive', 'invalid', 'misconfigured', 'throttled', 'unsupported']);
  });

  it('both classify to the same state and therefore render byte-identical markup', () => {
    const reasonFor = (row: typeof revoked | typeof expired) =>
      classifyLinkState(row, NOW) === 'inactive' ? 'inactive' as const : 'invalid' as const;

    expect(reasonFor(revoked)).toBe('inactive');
    expect(reasonFor(expired)).toBe('inactive');

    const order = context();
    const a = render({ ok: false, reason: reasonFor(revoked), order });
    const b = render({ ok: false, reason: reasonFor(expired), order });
    expect(a).toBe(b);
  });
});

describe('unsupported role — a live link that has no form', () => {
  const html = render(UNSUPPORTED);
  const body = text(html);

  it('says we cannot collect this online yet', () => {
    expect(body).toContain('We cannot collect this detail online yet');
    expect(body).toContain('cannot be entered through an online form');
  });

  it('does not offer a new link — a re-mint of the same role is the same dead end', () => {
    expect(body).not.toContain('Ask for a new link');
    expect(body).not.toMatch(/new link/i);
    expect(html).not.toContain('New%20link');
  });

  it('keeps the named contact and a mailto that is not a re-mint request', () => {
    expect(body).toContain('Rose Lucero');
    expect(html).toContain('mailto:rose@powerhouseescrow.com?subject=File%2020021227-OCT');
  });

  it('tells them to reply to the person below', () => {
    expect(body).toContain('Reply to the person below and they will take your details.');
  });
});

describe('invalid link', () => {
  const html = render(INVALID);
  const body = text(html);

  it('is branded even though there is no file to name', () => {
    expect(body).toContain('PACIFIC COAST TITLE COMPANY');
    expect(body).toContain('This link is not valid');
  });

  it('names no order, no property and no person', () => {
    expect(body).not.toContain('20021227-OCT');
    expect(body).not.toContain('Bonita');
    expect(body).not.toContain('Rose Lucero');
    expect(html).not.toContain('mailto:');
  });
});

describe('throttled request', () => {
  const html = render(THROTTLED);
  const body = text(html);

  it('reuses the branded status card rather than a fifth visual language', () => {
    // Same subtree as the invalid state: brand header plus one StatusPanel.
    expect(body).toContain('PACIFIC COAST TITLE COMPANY');
    expect(html).toContain('rounded-full border text-lg font-bold');
    expect(html.match(/<h2/g)).toHaveLength(1);
  });

  it('is calm, and does not accuse the reader of anything', () => {
    expect(body).toContain('Please try again in a few minutes');
    expect(body).not.toMatch(/abuse|blocked|banned|suspicious|denied|forbidden|violation/i);
    expect(body).not.toMatch(/\berror\b/i);
  });

  it('says nothing about whether the link was real', () => {
    // The same card is served for a genuine forwarded link and for a guess, so
    // any word about validity either way would be the oracle this closes.
    expect(body).not.toMatch(/\bnot valid\b/i);
    expect(body).not.toMatch(/\bexpired\b/i);
    expect(body).not.toMatch(/no longer active/i);
    expect(body).toContain('Nothing is wrong with your link');
  });

  it('offers the way out that does not depend on us', () => {
    expect(body).toContain('reply to the person who sent it');
  });

  it('names no order, no property and no person, because none was loaded', () => {
    expect(body).not.toContain('20021227-OCT');
    expect(body).not.toContain('Bonita');
    expect(body).not.toContain('Rose Lucero');
    expect(html).not.toContain('mailto:');
  });

  it('renders no form, so a throttled caller cannot submit past the block', () => {
    expect(html).not.toContain('<form');
    expect(html).not.toContain('<input');
  });
});

// ─── The contact ladder, as rendered ─────────────────────────────────────────

describe('the contact block degrades without looking broken', () => {
  it('shows the phone when there is one', () => {
    expect(text(render(FRESH))).toContain('(818) 643-3225');
  });

  it('drops the phone line entirely rather than leaving a slot — the common case', () => {
    const noPhone = render({
      ok: true,
      link: link({ order: context({ contact: { ...context().contact!, phone: null } }) }),
    });
    expect(text(noPhone)).toContain('rose@powerhouseescrow.com');
    expect(noPhone).not.toContain('href="tel:');
  });

  it('labels the title officer correctly when it falls to tier two', () => {
    const titleOnly = render({
      ok: true,
      link: link({
        order: context({
          contact: {
            name: 'Dana Reyes', company: null, email: 'dreyes@pct.com',
            phone: null, kind: 'title_officer',
          },
        }),
      }),
    });
    expect(text(titleOnly)).toContain('Title officer, Pacific Coast Title');
    expect(text(titleOnly)).toContain('dreyes@pct.com');
  });

  it('falls back to the email they were forwarded when nothing resolves', () => {
    const nobody = render({ ok: true, link: link({ order: context({ contact: null }) }) });
    expect(text(nobody))
      .toContain('Reply to the email that sent you here and it will reach the right person.');
  });

  it('does not claim a referrer when only a title officer resolved', () => {
    const titleOnly = text(render({
      ok: true,
      link: link({
        order: context({
          contact: {
            name: 'Dana Reyes', company: null, email: 'dreyes@pct.com',
            phone: null, kind: 'title_officer',
          },
        }),
      }),
    }));
    expect(titleOnly).not.toContain('asked us to reach you');
    expect(titleOnly).not.toContain('Dana Reyes asked');
  });

  it('says nothing at all in the hero rather than restating the form intro below it', () => {
    const nobody = text(render({
      ok: true, link: link({ order: context({ contact: null }) }),
    }));
    // The form's own intro is the only place this claim is made.
    expect(nobody.match(/We are handling the title work/g)).toHaveLength(1);
  });
});

// ─── The counterpart confirmation ────────────────────────────────────────────

describe('the counterpart line', () => {
  it('offers the name back for confirmation, with a way to flag it', () => {
    const body = text(render(FRESH));
    expect(body).toContain('Representing Alex Dorado Jimenez');
    expect(body).toContain('not correct?');
  });

  it('is absent rather than wrong when there is no owner on the file', () => {
    const noOwner = render({
      ok: true,
      link: link({ order: context({ counterpartName: null }) }),
    });
    expect(text(noOwner)).not.toContain('Representing');
    expect(text(noOwner)).not.toContain('not correct?');
  });

  it('never appears on a state that is not a fillable form', () => {
    expect(text(render(INACTIVE))).not.toContain('Representing');
    expect(text(render(RETURNING))).not.toContain('not correct?');
  });
});
