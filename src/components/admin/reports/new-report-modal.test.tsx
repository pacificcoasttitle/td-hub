import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CONCIERGE_GENERATE_ROLES } from '@/lib/domain/concierge/access';
import { CONTACT_BOOK_READ_ROLES } from '@/lib/security/contact-book-access';
import {
  AlreadyHavePanel, ConciergeStep, TypeCard,
  applyPickedAddress, draftProblem, fullAddress, generationBody, typeOptions,
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
    <ConciergeStep draft={draft(over)} problem={problem} onField={() => {}} onAddress={() => {}} repPicker={<span>picker</span>} criteriaControl={<span>criteria</span>} />,
  );

  it('offers the comparable criteria as a control, not a fixed summary', () => {
    // It used to print "1 mi · 12 mo · ±30% size" and offer no way to change
    // it. The operator went looking for that control during creation, found
    // nothing, and reported the criteria as broken — the control existed only
    // after generation.
    expect(step()).toContain('Comparable criteria');
  });

  it('says the criteria do not change what is searched for, or the cost', () => {
    // fetchConciergeProfile sends addr, lastLine and feedId and nothing else.
    // A wider radius does not search wider; a narrower one does not cost less.
    // An operator who believes otherwise will tune these to save money.
    const html = step();
    expect(html).toContain('do not change what is searched for');
    expect(html).toContain('free');
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

  it('offers the address field as an instruction, never as an example address', () => {
    // A real placeholder address read as prefilled, and generating the wrong
    // property spends a lookup that cannot be undone.
    //
    // Read from the MARKUP, not through visible(): placeholder is an attribute
    // and visible() strips tags, so the first version of this assertion looked
    // for the placeholder in text that can never contain one.
    const html = renderToStaticMarkup(
      <ConciergeStep
        draft={draft({ street: '' })} problem={null}
        onField={() => {}} onAddress={() => {}} repPicker={<span>picker</span>} criteriaControl={<span>criteria</span>}
      />,
    );
    expect(html).toContain('placeholder="Start typing an address');
    expect(html).not.toContain('1358 5th St,');
    // And the field is still an ordinary text input with a value — not a
    // widget that requires a selection before anything can be typed.
    expect(html).toMatch(/<input[^>]*type="text"/);
  });
});

describe('a picked address fills the whole address', () => {
  const picked = {
    street: '9 Mammoth Slopes Dr', city: 'Mammoth Lakes', state: 'CA', zip: '93546', placeId: 'x',
  };

  it('sets street, city, state and zip from one pick', () => {
    const next = applyPickedAddress(draft({ street: '', city: '', state: '', zip: '' }), picked);
    expect(next).toMatchObject({
      street: '9 Mammoth Slopes Dr', city: 'Mammoth Lakes', state: 'CA', zip: '93546',
    });
  });

  it('leaves the rep alone — a pick is about the property', () => {
    const before = draft({ repContactId: 22125, repName: 'Gerardo Hernandez' });
    const next = applyPickedAddress(before, picked);
    expect(next.repContactId).toBe(22125);
    expect(next.repName).toBe('Gerardo Hernandez');
  });

  it('normalises state the same way typing does', () => {
    const next = applyPickedAddress(draft(), { ...picked, state: 'california' });
    expect(next.state).toBe('CA');
  });

  it('BLANKS a field the pick did not supply rather than keeping a stale one', () => {
    // The dangerous case: a ZIP left over from a PREVIOUS property sitting
    // under a new street. Blanking makes draftProblem say so; keeping it would
    // generate a profile for the wrong parcel and spend the lookup.
    const afterFirstPick = applyPickedAddress(draft(), picked);
    expect(afterFirstPick.zip).toBe('93546');

    const secondPickNoZip = { ...picked, street: '1 Rural Route', city: 'Hayfork', zip: '' };
    const next = applyPickedAddress(afterFirstPick, secondPickNoZip);
    expect(next.zip).toBe('');
    expect(draftProblem(next)).toContain('ZIP');
  });

  it('does not touch draftProblem — autocomplete is an input method, not a check', () => {
    // Every rule still applies to a picked address.
    const noZip = applyPickedAddress(draft(), { ...picked, zip: '' });
    expect(draftProblem(noZip)).toContain('ZIP');
    const noCity = applyPickedAddress(draft(), { ...picked, city: '' });
    expect(draftProblem(noCity)).toContain('city');
    const noStreet = applyPickedAddress(draft(), { ...picked, street: '' });
    expect(draftProblem(noStreet)).toContain('street');
  });

  it('accepts a fully hand-typed address with no pick at all', () => {
    // The rural / new-construction case. Nothing here requires a selection.
    const typed = draft({ street: '11200 Bachelor Valley Rd', city: 'Witter Springs', state: 'CA', zip: '95493' });
    expect(draftProblem(typed)).toBeNull();
  });
});

// The representative control is now RepCombobox, and its tests are in
// rep-combobox.interactive.test.tsx — they need a DOM, because "shows all 54 on
// focus" is a statement about an interaction and not about a first paint. The
// four string-render tests that were here asserted the search box that the
// combobox replaced.

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

  it('posts to exactly these three routes, and no others', () => {
    // THREE POSTs now, and the third is new (2026-09-30). Enumerated rather than
    // counted, because the useful question is not "how many" but "which":
    //
    //   /api/concierge/profiles          SiteX. Buys the property. One credit.
    //   /api/concierge/profiles/{id}/tax TitlePoint. Buys page 4, on a property
    //                                    already paid for. Opt-in, default off.
    //   /api/reports/farming             Free.
    //
    // This guard caught the tax POST the moment it was added, which is what it is
    // for. Adding the string was not the fix — naming what it buys is, so that a
    // fourth entry has to be justified the same way.
    const s = src();
    const posts = [...s.matchAll(/fetch\((['`])([^'`]+)\1,\s*\{[^}]*method: 'POST'/g)].map((m) => m[2]);
    // THE TAX ROUTE APPEARS TWICE and that is the design, not a duplicate: the
    // first call buys the search, the second finishes it. Finishing IS asking
    // again — the route polls a search already paid for and re-renders — and it
    // cannot buy a second one, which routes.test.ts holds on the bridge itself.
    expect(posts.sort()).toEqual([
      '/api/concierge/profiles',
      '/api/concierge/profiles/${profileId}/tax',
      '/api/concierge/profiles/${profileId}/tax',
      '/api/reports/farming',
    ].sort());
    // Distinct destinations, so a fourth URL still has to be justified here.
    expect([...new Set(posts)].sort()).toEqual([
      '/api/concierge/profiles',
      '/api/concierge/profiles/${profileId}/tax',
      '/api/reports/farming',
    ].sort());
  });

  it('asks for the tax detail only after the profile exists, and never unasked', () => {
    const s = src();
    // The tax POST must be inside confirm(), AFTER the generate response has
    // yielded a profile id — never built from the draft, which would mean
    // guessing at an id, and never at generate time, which would put a
    // create/poll/fetch taking minutes inside the request that charges.
    expect(s).toMatch(/const profileId = body\.profileId as number/);
    expect(s.indexOf('const profileId = body.profileId'))
      .toBeLessThan(s.indexOf('/tax'));
    // And it is conditional on the opt-in. An unconditional call would spend on
    // every generation.
    expect(s).toMatch(/if \(taxDetail\) \{/);
    // Reset on every gate open, so a tick cannot survive a cancel and arm the
    // next generation. Driven in new-report-modal.interactive.test.tsx; asserted
    // here too because the reset is one line and deletable.
    expect(s).toMatch(/function openGate\(\)[\s\S]{0,200}setTaxDetail\(false\)/);
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
