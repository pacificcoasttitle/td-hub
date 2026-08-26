import { describe, expect, it } from 'vitest';
import { parseSiteXOwners } from './sitex-owner-names';
import { entityMarker, looksLikeEntity } from './entity-markers';

// ─── The three-way rule ─────────────────────────────────────────────────────

describe('deed present — the discriminator is structural', () => {
  it('entity: the string passes through whole, nothing split or flipped', () => {
    const r = parseSiteXOwners('5558 RIVERTON LLC', undefined, 'entity');
    expect(r.isEntity).toBe(true);
    expect(r.branch).toBe('entity-deed');
    expect(r.primary).toEqual({ firstName: '', middleName: '', lastName: '5558 RIVERTON LLC' });
    // The defect this whole branch exists to kill: a person named 5558.
    expect(r.primary!.firstName).not.toBe('5558');
    expect(r.primary!.lastName).not.toBe('5558');
  });

  it('entity: NOT title-cased — a legal name is not a name to case', () => {
    const r = parseSiteXOwners('1501 Reeves Holdings, LLC', undefined, 'entity');
    expect(r.primary!.lastName).toBe('1501 Reeves Holdings, LLC');
    expect(r.primary!.lastName).not.toContain('Llc');
  });

  it('person: parses exactly as before', () => {
    const r = parseSiteXOwners('SANCHEZ SERGIO T', undefined, 'person');
    expect(r.branch).toBe('person-deed');
    expect(r.isEntity).toBe(false);
    expect(r.primary).toEqual({ firstName: 'Sergio', middleName: 'T', lastName: 'Sanchez' });
  });

  it('a deed saying person BEATS an entity marker in the string', () => {
    // "Trust" in a person's name must not override the vendor's own answer.
    const r = parseSiteXOwners('TRUST, MARY JANE', undefined, 'person');
    expect(r.isEntity).toBe(false);
    expect(r.branch).toBe('person-deed');
  });
});

describe('no deed — the marker list may only abstain', () => {
  it('abstains on an entity marker and says why', () => {
    const r = parseSiteXOwners('5558 RIVERTON LLC');
    expect(r.branch).toBe('entity-marker');
    expect(r.primary!.lastName).toBe('5558 RIVERTON LLC');
    expect(r.warnings.some((w) => w.includes('organization') && w.includes('LLC'))).toBe(true);
  });

  it('the real trust our sync mangled is left whole', () => {
    // We stored "Tony Living Trust (Dtd 03/07/18) Louka"; SoftPro had it right.
    const r = parseSiteXOwners('LOUKA TONY LIVING TRUST (DTD 03/07/18)');
    expect(r.isEntity).toBe(true);
    expect(r.primary!.lastName).toBe('LOUKA TONY LIVING TRUST (DTD 03/07/18)');
  });

  it('no marker: parses exactly as before — the working case is not traded away', () => {
    for (const [input, expected] of [
      ['SANCHEZ SERGIO T', { firstName: 'Sergio', middleName: 'T', lastName: 'Sanchez' }],
      ['HAMILTON CHRISTOPHER KENNETH JR', { firstName: 'Christopher', middleName: 'Kenneth Jr', lastName: 'Hamilton' }],
      ['DE VEYRA, TED T', { firstName: 'Ted', middleName: 'T', lastName: 'De Veyra' }],
    ] as const) {
      const r = parseSiteXOwners(input);
      expect(r.branch, input).toBe('person-parsed');
      expect(r.isEntity, input).toBe(false);
      expect(r.primary, input).toEqual(expected);
    }
  });

  it('the multi-owner comma rule still works underneath', () => {
    const r = parseSiteXOwners('TIEU, DANIEL QUI & KHANH TRINH');
    expect(r.primary).toEqual({ firstName: 'Daniel', middleName: 'Qui', lastName: 'Tieu' });
    expect(r.secondary).toEqual({ firstName: 'Khanh', middleName: 'Trinh', lastName: 'Tieu' });
  });
});

// ─── The standing rule: prove the check can FAIL before trusting it passes ──
//
// A marker list that matched everything would report a beautiful abstention
// count and suppress every real person. These assert the negative side.

describe('the marker list can fail, and here is where', () => {
  it('does NOT match ordinary personal names', () => {
    for (const name of [
      'SANCHEZ SERGIO T', 'HAMILTON CHRISTOPHER KENNETH JR', 'DE VEYRA, TED T',
      'TIEU, DANIEL QUI', 'O\'BRIEN SEAN', 'MCDONALD RONALD', 'VAN DER BERG, ANNA MARIE',
      'SMITH', 'AJAYI, HOSEA J', 'KUROKAWA MUTSUMI', 'ALVARADO RAFAEL',
    ]) {
      expect(looksLikeEntity(name), name).toBe(false);
    }
  });

  it('matches tokens WHOLE — the substring version is how Vincent becomes a company', () => {
    // Each of these CONTAINS an entity token as a substring and must not match.
    for (const name of [
      'INCLINE JOHN',        // INC
      'CORPUS MARIA',        // CORP
      'TRUSTMAN HAROLD',     // TRUST
      'COOPER, LP JAMES',    // LP mid-string is initials, not a partnership
      'LTDA JOSE',           // LTD
      'GROUPE ANDRE',        // GROUP
    ]) {
      expect(looksLikeEntity(name), name).toBe(false);
    }
  });

  it('two-letter tokens match only in final position', () => {
    // Caught by this suite before it shipped: a positional-blind LP match
    // suppresses a person whose initials are L.P.
    expect(looksLikeEntity('COOPER, LP JAMES')).toBe(false);
    expect(looksLikeEntity('SMITH FAMILY LP')).toBe(true);
    expect(looksLikeEntity('SMITH FAMILY LP.')).toBe(true);
  });

  it('phrases match on word boundaries — ESTATE OF is not STATE OF', () => {
    // Found by measuring against all 5,418 stored owner strings: substring
    // matching flagged two people's estates as government entities.
    expect(looksLikeEntity('HARRIS JOSEPH JR ESTATE OF HARRIS EULA MAE')).toBe(false);
    expect(looksLikeEntity('HOWEY NANCY D ESTATE OF ROTHPLETZ')).toBe(false);
    expect(looksLikeEntity('STATE OF CALIFORNIA')).toBe(true);
  });

  it('does match real organization shapes', () => {
    for (const [name, token] of [
      ['5558 RIVERTON LLC', 'LLC'],
      ['LUCHSHEYE CORP', 'CORP'],
      ['B & A GROUP INC,', 'GROUP'],
      ['LOUKA TONY LIVING TRUST', 'LIVING TRUST'],
      ['AMBER INVESTMENT GROUP INC', 'INVESTMENT'],
      ['GREAT WESTERN CAPITAL LLC', 'CAPITAL'],
      ['1501 Reeves Holdings, LLC', 'HOLDINGS'],
      ['CITY OF GLENDALE', 'CITY OF'],
    ] as const) {
      const m = entityMarker(name);
      expect(m.matched, name).toBe(true);
      if (m.matched) expect(m.token, name).toBe(token);
    }
  });

  it('an empty or blank owner matches nothing', () => {
    expect(looksLikeEntity('')).toBe(false);
    expect(looksLikeEntity(null)).toBe(false);
    expect(looksLikeEntity('   ')).toBe(false);
  });
});

describe('the list can only abstain, never choose', () => {
  it('an entity result never invents a first or middle name', () => {
    for (const s of ['5558 RIVERTON LLC', 'B & A GROUP INC,', 'LOUKA TONY LIVING TRUST']) {
      const r = parseSiteXOwners(s);
      expect(r.primary!.firstName, s).toBe('');
      expect(r.primary!.middleName, s).toBe('');
      expect(r.primary!.lastName, s).toBe(s);
      expect(r.secondary, s).toBeNull();
    }
  });

  it('every abstention carries a warning the operator can see', () => {
    const r = parseSiteXOwners('5558 RIVERTON LLC');
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('every parse records the branch it took', () => {
    expect(parseSiteXOwners('X LLC', undefined, 'entity').branch).toBe('entity-deed');
    expect(parseSiteXOwners('X LLC').branch).toBe('entity-marker');
    expect(parseSiteXOwners('SANCHEZ SERGIO', undefined, 'person').branch).toBe('person-deed');
    expect(parseSiteXOwners('SANCHEZ SERGIO').branch).toBe('person-parsed');
    expect(parseSiteXOwners('').branch).toBe('empty');
  });
});
