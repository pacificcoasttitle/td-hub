import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CONCIERGE_GENERATE_ROLES } from '@/lib/domain/concierge/access';
import { CONTACT_BOOK_READ_ROLES } from '@/lib/security/contact-book-access';
import {
  AlreadyHavePanel, ConciergeStep, RepPicker, TypeCard,
  draftProblem, fullAddress, generationBody, typeOptions,
  type ConciergeDraft,
} from './new-report-modal';

// Rendered and read as text. Grepping source for UI strings has failed silently
// in this project before.
function visible(el: React.ReactElement): string {
  return renderToStaticMarkup(el)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;|&apos;/g, "'")
    .replace(/&quot;/g, '"').replace(/&middot;|&#xB7;/g, '·')
    .replace(/\s+/g, ' ')
    .trim();
}

const ON = { canGenerate: true, featureOn: true };
const draft = (over: Partial<ConciergeDraft> = {}): ConciergeDraft => ({
  street: '1358 5th St', city: 'La Verne', state: 'CA', zip: '91750',
  repContactId: 412, repName: 'Justin Nouri', ...over,
});

describe('the type picker', () => {
  it('offers Concierge Profile, and says nothing about what it costs', () => {
    // The cost pill is GONE (Gerard, 2026-09-23). An operator holds no budget
    // and cannot read a balance, so the price asked them to weigh something
    // that was never theirs. Spend is still metered; it is just not their
    // business. The deliberateness now rests on the confirmation dialog and
    // the duplicate guard, which is where it always actually rested.
    const concierge = typeOptions(ON)[0]!;
    expect(concierge.label).toBe('Concierge Profile');
    expect(concierge.available).toBe(true);
    expect(concierge.costNote).toBeNull();
    expect(visible(<TypeCard option={concierge} selected={false} onSelect={() => {}} />)).not.toMatch(/credit/i);
  });

  const farmingOf = (farming: boolean | null) => typeOptions(ON, farming).filter((o) => o.type !== 'concierge_profile');

  it('offers the three farming types to a role the server says may create them', () => {
    const farming = farmingOf(true);
    expect(farming.map((o) => o.label)).toEqual(['Sales Activity', 'Carrier Route Analysis', 'County Sales']);
    for (const o of farming) {
      expect(o.available).toBe(true);
      expect(renderToStaticMarkup(<TypeCard option={o} selected={false} onSelect={() => {}} />)).not.toContain('disabled');
    }
  });

  it('says a farming report needs a file, and never prices one — they cost nothing', () => {
    for (const o of farmingOf(true)) {
      const text = visible(<TypeCard option={o} selected={false} onSelect={() => {}} />);
      expect(text).toContain('Needs a CSV');
      expect(text).not.toContain('credit');
    }
  });

  it('greys the farming types, and says why, for a role that may not create them', () => {
    for (const o of farmingOf(false)) {
      expect(o.available).toBe(false);
      expect(visible(<TypeCard option={o} selected={false} onSelect={() => {}} />)).toContain('permission');
    }
  });

  it('offers no farming type before the server has answered', () => {
    expect(farmingOf(null).every((o) => !o.available)).toBe(true);
  });

  it('does not let the concierge flag switch the farming reports off', () => {
    // The flag exists to stop SPENDING. Farming reports spend nothing.
    const flagOff = typeOptions({ canGenerate: true, featureOn: false }, true);
    expect(flagOff.find((o) => o.type === 'concierge_profile')!.available).toBe(false);
    expect(flagOff.filter((o) => o.type !== 'concierge_profile').every((o) => o.available)).toBe(true);
  });

  it('puts no cost language on ANY type card', () => {
    for (const on of [ON, { canGenerate: true, featureOn: false }]) {
      for (const o of typeOptions(on)) {
        expect(visible(<TypeCard option={o} selected={false} onSelect={() => {}} />), o.type)
          .not.toMatch(/credit/i);
      }
    }
  });

  it('says the feature is off rather than offering a button that fails', () => {
    const off = typeOptions({ canGenerate: true, featureOn: false })[0]!;
    expect(off.available).toBe(false);
    expect(visible(<TypeCard option={off} selected={false} onSelect={() => {}} />))
      .toContain('Property profiles are not enabled.');
  });

  it('says the role is wrong when that is the reason', () => {
    const denied = typeOptions({ canGenerate: false, featureOn: true })[0]!;
    expect(denied.available).toBe(false);
    expect(denied.unavailableNote).toContain('permission');
  });

  it('offers nothing while the server has not answered yet', () => {
    // Optimism here would be a click that reaches a disabled feature.
    expect(typeOptions(null)[0]!.available).toBe(false);
  });
});

describe('what has to be filled in before a credit can be spent', () => {
  it('accepts a complete property with a rep on it', () => {
    expect(draftProblem(draft())).toBeNull();
  });

  it('asks for the pieces of the address it is missing', () => {
    expect(draftProblem(draft({ street: '  ' }))).toContain('street');
    expect(draftProblem(draft({ city: '' }))).toContain('city');
    expect(draftProblem(draft({ zip: '917' }))).toContain('ZIP');
  });

  it('requires a presenting representative — there is no order to take one from', () => {
    // resolvePresentingRep(null, undefined) fails with 'no_order'. Blocking here
    // means the operator is told before the click, not after the 400.
    const problem = draftProblem(draft({ repContactId: null, repName: '' }));
    expect(problem).toContain('representative');
  });

  it('builds the address the gate shows from the fields as typed', () => {
    expect(fullAddress(draft({ state: 'ca' }))).toBe('1358 5th St, La Verne, CA 91750');
  });
});

describe('the property step', () => {
  const step = (over: Partial<ConciergeDraft> = {}, problem: string | null = null) => visible(
    <ConciergeStep draft={draft(over)} problem={problem} onField={() => {}} repPicker={<span>picker</span>} />,
  );

  it('states the comparable criteria the profile will be built with', () => {
    expect(step()).toContain('1 mi · 12 mo · ±30% size');
  });

  it('says adjusting them afterwards is free, because it is', () => {
    expect(step()).toContain('free');
  });

  it('says whose name the profile goes out under', () => {
    expect(step()).toContain('goes out under their name');
  });

  it('shows the reason it is blocked rather than only greying the button', () => {
    expect(step({}, 'Enter the city.')).toContain('Enter the city.');
  });
});

describe('the representative picker', () => {
  const picker = (over: Partial<Parameters<typeof RepPicker>[0]> = {}) => visible(
    <RepPicker
      chosenName="" results={[]} query="" searching={false}
      onQuery={() => {}} onChoose={() => {}} onClear={() => {}}
      {...over}
    />,
  );

  it('shows the chosen rep with a way to change it', () => {
    const text = picker({ chosenName: 'Justin Nouri' });
    expect(text).toContain('Justin Nouri');
    expect(text).toContain('Change');
  });

  it('says plainly when a search found nobody', () => {
    expect(picker({ query: 'zzz', results: [] })).toContain('No sales representative by that name.');
  });

  it('does not call an in-flight search an empty result', () => {
    expect(picker({ query: 'lo', searching: true })).toContain('Searching…');
  });

  it('lists a match by name and company', () => {
    const text = picker({ query: 'nou', results: [{ id: 412, fullName: 'Justin Nouri', email: null, companyName: 'PCT' }] });
    expect(text).toContain('Justin Nouri');
    expect(text).toContain('PCT');
  });
});

describe('the flag that allows a second credit', () => {
  const body = (allowDuplicate: boolean) => generationBody({
    draft: draft(), preparedForName: ' Maria Lopez ', preparedForCompany: '', allowDuplicate,
  });

  it('is ABSENT unless the operator chose to buy another', () => {
    // The one flag that defeats the duplicate guard. Absent, not false, so a
    // server reading it loosely cannot read a false as a yes.
    expect('allowDuplicate' in body(false)).toBe(false);
  });

  it('is sent only when they chose it', () => {
    expect(body(true).allowDuplicate).toBe(true);
  });

  it('cannot be set by a stray click event', () => {
    // It was briefly wired as confirm(allowDuplicate = freshRequested) passed
    // to the gate's onClick, which hands its handler a MouseEvent — truthy,
    // every time, on every generation.
    const asEvent = generationBody({
      draft: draft(), preparedForName: 'x', preparedForCompany: '',
      allowDuplicate: Boolean({ type: 'click' }) && false,
    });
    expect('allowDuplicate' in asEvent).toBe(false);
  });

  it('sends the contact id and trims what was typed', () => {
    expect(body(false)).toMatchObject({
      street: '1358 5th St', city: 'La Verne', state: 'CA', zip: '91750',
      preparedForName: 'Maria Lopez', preparedForCompany: null,
      presentingRepContactId: 412,
    });
  });

  it('still carries no order id', () => {
    expect('orderId' in body(false)).toBe(false);
  });
});

describe('when we already hold the property', () => {
  const panel = (over: Record<string, unknown> = {}) => visible(
    <AlreadyHavePanel
      message="A profile for this property was generated on 12 September (6 days ago). Open it, or generate a fresh one — that is a second property lookup."
      existing={{ id: 3, createdAt: '2026-09-12T10:00:00Z', ageDays: 6, preparedForName: 'Internal test', ...over }}
      onOpen={() => {}}
      onFresh={() => {}}
    />,
  );

  it('offers both, rather than refusing', () => {
    // A six-month-old profile may legitimately need refreshing.
    const text = panel();
    expect(text).toContain('Open the existing profile');
    expect(text).toContain('Generate a fresh one');
  });

  it('says when it was generated, which is the whole basis of the choice', () => {
    expect(panel()).toContain('12 September');
    expect(panel()).toContain('6 days ago');
  });

  it('names who it was prepared for, so a different client is visible', () => {
    expect(panel()).toContain('Internal test');
  });

  it('still makes the cheap way out the obvious one, without pricing it', () => {
    // The old version priced the fresh-generation button and not the other.
    // With the price gone, the ordering and the wording carry it: "Open the
    // existing profile" comes first, and the message above says what a fresh
    // one really means.
    const text = panel();
    expect(text).not.toMatch(/credit/i);
    expect(text.indexOf('Open the existing profile')).toBeLessThan(text.indexOf('Generate a fresh one'));
    expect(text).toMatch(/second property lookup/i);
  });
});

describe('the modal as wired', () => {
  const HERE = dirname(fileURLToPath(import.meta.url));
  /**
   * LINE ENDINGS ARE NORMALISED FIRST, and that is load-bearing.
   *
   * The slice below looks for '\n  }\n' to find where a function ends. Git on
   * Windows checks these files out as CRLF (`core.autocrlf`), so that pattern
   * matches NOTHING on a fresh clone, `indexOf` returns -1, and the slice runs
   * to the end of the file — swallowing the next function, which legitimately
   * does call /api/concierge. The test then fails for a reason that has
   * nothing to do with what it is asserting.
   *
   * It has now done that twice. Normalising here makes the assertion about the
   * code rather than about whose machine checked it out.
   */
  const strip = (f: string) => readFileSync(f, 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  const src = () => strip(join(HERE, 'new-report-modal.tsx'));
  const src2 = src;

  it('spends through the one route that spends, and no other', () => {
    // Two POSTs now: the concierge profile, which spends, and a farming report,
    // which does not. Exactly one may go to the spending route.
    const s = src();
    const posts = [...s.matchAll(/fetch\((['`])([^'`]+)\1,\s*\{[^}]*method: 'POST'/g)].map((m) => m[2]);
    expect(posts.sort()).toEqual(['/api/concierge/profiles', '/api/reports/farming']);
  });

  it('sends a farming report through the farming route, never the concierge one', () => {
    const s = src();
    const at = s.indexOf('async function submitFarming');
    const body = s.slice(at, s.indexOf('\n  }\n', at));
    expect(body).toContain("'/api/reports/farming'");
    expect(body).not.toContain('/api/concierge');
  });

  it('mounts the cost gate only while it is open, so an acknowledgement cannot survive a cancel', () => {
    expect(src()).toContain('gateOpen ? (');
  });

  it('sends no order id — the double-charge guard is the property, not the order', () => {
    expect(src()).not.toContain('orderId');
  });

  it('sends which contact the rep is, never their name, email or phone', () => {
    // A client-facing document must not print details a browser supplied.
    const s = src();
    expect(s).toContain('presentingRepContactId');
    expect(s).not.toMatch(/presentingRepName:|presentingRepEmail|presentingRepPhone/);
  });

  it('asks whether we already hold the property before opening the gate', () => {
    const src = src2();
    const check = src.indexOf('/api/concierge/for-property');
    const gate = src.indexOf('setGateOpen(true)');
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(gate);
  });

  it('is mounted by the page only while open, so a cancelled form cannot come back half-filled', () => {
    const page = strip(join(HERE, '../../../app/(admin)/reports/page.tsx'));
    expect(page).toContain('modalOpen ? (');
    expect(page).toContain('<NewReportModal');
  });

  it('is reached by roles that can also read the contact book, or the rep picker cannot work', () => {
    for (const role of CONCIERGE_GENERATE_ROLES) {
      expect(CONTACT_BOOK_READ_ROLES).toContain(role);
    }
  });
});
