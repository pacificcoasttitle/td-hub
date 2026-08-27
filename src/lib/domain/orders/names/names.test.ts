import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { legacyToTitleCase, nameTitleCase } from './title-case';
import { splitFullName } from './split-full-name';
import { parseSiteXOwners } from './sitex-owner-names';

const fml = (n: { firstName: string; middleName: string; lastName: string } | null) =>
  n ? `${n.firstName} / ${n.middleName} / ${n.lastName}` : '(none)';

// ─── The required cases, verbatim from the ruling ───────────────────────────

describe('required test cases', () => {
  it('SiteX: "SANCHEZ SERGIO T" -> Sergio / T / Sanchez', () => {
    expect(fml(parseSiteXOwners('SANCHEZ SERGIO T').primary)).toBe('Sergio / T / Sanchez');
  });

  it('SiteX: "TIEU DANIEL QUI & TIEU KHANH TRINH" -> two owners, both first-last ordered', () => {
    const r = parseSiteXOwners('TIEU DANIEL QUI & TIEU KHANH TRINH');
    expect(fml(r.primary)).toBe('Daniel / Qui / Tieu');
    expect(fml(r.secondary)).toBe('Khanh / Trinh / Tieu');
  });

  it('manual: "John Smith" -> John / "" / Smith, NOT Smith / "" / John', () => {
    const r = splitFullName('John Smith');
    expect(fml(r)).toBe('John /  / Smith');
    expect(r.firstName).not.toBe('Smith');
  });

  it('manual: "Mary Jane Watson" -> Mary / Jane / Watson', () => {
    expect(fml(splitFullName('Mary Jane Watson'))).toBe('Mary / Jane / Watson');
  });

  it('SiteX: "SMITH" is NOT duplicated into Smith / "" / Smith', () => {
    const r = parseSiteXOwners('SMITH');
    // Legacy emits first="Smith" last="Smith" because indexOf(" ") is -1 and
    // parts[0] === parts[len-1]. We record a surname with no invented first
    // name, and say so.
    expect(fml(r.primary)).toBe(' /  / Smith');
    expect(r.warnings.some((w) => w.includes('single word'))).toBe(true);
  });
});

// ─── The trap: the flip must never touch a hand-typed name ──────────────────

describe('the flip is SiteX-only', () => {
  it('splitFullName never reorders — every manual name keeps its order', () => {
    for (const [input, expected] of [
      ['John Smith', 'John /  / Smith'],
      ['Mary Jane Watson', 'Mary / Jane / Watson'],
      ['Sergio Sanchez', 'Sergio /  / Sanchez'],
      ['Daniel Qui Tieu', 'Daniel / Qui / Tieu'],
      ['Anna Maria de la Cruz', 'Anna / Maria de la / Cruz'],
    ] as const) {
      expect(fml(splitFullName(input))).toBe(expected);
    }
  });

  it('feeding a natural-order name back through splitFullName is idempotent', () => {
    const once = splitFullName('John Smith');
    const twice = splitFullName(`${once.firstName} ${once.lastName}`);
    expect(fml(twice)).toBe(fml(once));
  });

  // Structural guard. The flip is only reachable through parseSiteXOwners, and
  // nothing on the submit path may import that module — otherwise a future edit
  // could route a typed name through it and reverse every manual order.
  it('the submit path does not import the SiteX owner parser', () => {
    const root = join(__dirname, '..');
    for (const file of ['create-order.ts', 'softpro-payload.ts', 'client-wizard-to-create.ts']) {
      const src = readFileSync(join(root, file), 'utf8');
      expect(src).not.toContain('sitex-owner-names');
      expect(src).not.toContain('parseSiteXOwners');
    }
  });

  // Same guard for the read-back. `enrich-orders` writes `order_parties`
  // `external_name` straight from SoftPro's `GetOrderContacts` strings, and
  // that is the answer to "can re-enrichment overwrite a correct SoftPro name
  // with a flipped one" — it cannot, because the flip is not on the path.
  // Pinned here so the answer stays no.
  it('the SoftPro read-back does not import the SiteX owner parser', () => {
    const src = readFileSync(
      join(__dirname, '..', '..', '..', 'jobs', 'handlers', 'enrich-orders.ts'),
      'utf8',
    );
    expect(src).not.toContain('sitex-owner-names');
    expect(src).not.toContain('parseSiteXOwners');
    expect(src).not.toContain('orders/names');
  });

  it('the flip itself is not exported', async () => {
    const mod = await import('./sitex-owner-names');
    expect(Object.keys(mod)).toEqual(['parseSiteXOwners']);
  });
});

// ─── Multi-owner splitting ──────────────────────────────────────────────────

describe('multi-owner strings', () => {
  it('splits on the first semicolon, in preference to any ampersand', () => {
    const r = parseSiteXOwners('TIEU DANIEL; TIEU KHANH & SOMEONE ELSE');
    expect(r.primary?.lastName).toBe('Tieu');
    expect(r.primary?.firstName).toBe('Daniel');
    expect(r.secondary?.firstName).toBe('Khanh');
  });

  it('splits on the FIRST ampersand only — A & B & C leaves C attached to B', () => {
    const r = parseSiteXOwners('SMITH ALAN & SMITH BETH & SMITH CARL');
    expect(fml(r.primary)).toBe('Alan /  / Smith');
    // Matched to legacy deliberately: the third owner stays in the second slot.
    expect(r.secondary?.firstName).toBe('Beth');
    expect(r.warnings.some((w) => w.includes('Three or more owners'))).toBe(true);
  });

  it('falls back to SiteX\'s own secondary field when the primary has no delimiter', () => {
    const r = parseSiteXOwners('SANCHEZ SERGIO', 'SANCHEZ MARIA');
    expect(fml(r.primary)).toBe('Sergio /  / Sanchez');
    expect(fml(r.secondary)).toBe('Maria /  / Sanchez');
  });

  it('a delimiter in the primary OVERRIDES the secondary field, as legacy does', () => {
    const r = parseSiteXOwners('SMITH ALAN & SMITH BETH', 'IGNORED PERSON');
    expect(r.secondary?.firstName).toBe('Beth');
  });

  it('returns nothing for an empty owner name rather than a blank person', () => {
    expect(parseSiteXOwners('').primary).toBeNull();
    expect(parseSiteXOwners(null).primary).toBeNull();
    expect(parseSiteXOwners('   ').primary).toBeNull();
  });
});

// ─── Commas ─────────────────────────────────────────────────────────────────

// The comma is a delimiter SiteX put there, and it is the ONLY thing that says
// whether a segment states its own surname. Legacy stripped it and flipped
// everything positionally; that is the deliberate departure.
describe('the comma decides whether a segment states its own surname', () => {
  it('splits at the FIRST comma — later ones stay in the given names', () => {
    const r = parseSiteXOwners('TIEU, DANIEL, QUI');
    expect(fml(r.primary)).toBe('Daniel, / Qui / Tieu');
  });

  it('reads each owner\'s own comma separately after the split', () => {
    const r = parseSiteXOwners('TIEU, DANIEL & TIEU, KHANH');
    expect(fml(r.primary)).toBe('Daniel /  / Tieu');
    expect(fml(r.secondary)).toBe('Khanh /  / Tieu');
  });

  // PINNED BY VALUE. This is the production string, and the second owner is the
  // whole point — a not-null assertion is what let it ship wrong.
  it('the real production string: surname stated once, carried to both owners', () => {
    // Sent to SoftPro on 2026-08-24 as DANIEL / "QUI & KHANH TRINH" / "TIEU,"
    const r = parseSiteXOwners('TIEU, DANIEL QUI & KHANH TRINH');
    expect(fml(r.primary)).toBe('Daniel / Qui / Tieu');
    expect(fml(r.secondary)).toBe('Khanh / Trinh / Tieu');
    // Not "Trinh / / Khanh", which is what the positional flip produced.
    expect(r.secondary!.lastName).toBe('Tieu');
    expect(r.secondary!.firstName).not.toBe('Trinh');
  });

  it('says so when a surname was carried over rather than stated', () => {
    const r = parseSiteXOwners('TIEU, DANIEL QUI & KHANH TRINH');
    expect(r.warnings.some((w) => w.includes('states no surname of its own'))).toBe(true);
  });

  it('carries nothing over when the first owner stated no surname either', () => {
    // No comma, so both segments are positional and there is nothing to inherit.
    const r = parseSiteXOwners('TIEU DANIEL QUI & KHANH TRINH');
    expect(fml(r.secondary)).toBe('Trinh /  / Khanh');
    expect(r.warnings.some((w) => w.includes('states no surname of its own'))).toBe(false);
  });
});

// ─── Suffixes ───────────────────────────────────────────────────────────────

describe('suffixes become middle names, as in legacy', () => {
  it('"SANCHEZ SERGIO JR" -> Sergio / Jr / Sanchez', () => {
    expect(fml(parseSiteXOwners('SANCHEZ SERGIO JR').primary)).toBe('Sergio / Jr / Sanchez');
  });

  it('"HAMILTON CHRISTOPHER KENNETH JR" -> Christopher / Kenneth Jr / Hamilton', () => {
    expect(fml(parseSiteXOwners('HAMILTON CHRISTOPHER KENNETH JR').primary))
      .toBe('Christopher / Kenneth Jr / Hamilton');
  });

  it('keeps roman numerals uppercase', () => {
    expect(fml(parseSiteXOwners('SANCHEZ SERGIO III').primary)).toBe('Sergio / III / Sanchez');
  });
});

// ─── Title casing ───────────────────────────────────────────────────────────

describe('name title-casing does not mangle real surnames', () => {
  it.each([
    ['MCDONALD RONALD', 'Ronald /  / McDonald'],
    ["O'BRIEN SEAN", "Sean /  / O'Brien"],
    ['SMITH-JONES ALICE', 'Alice /  / Smith-Jones'],
    ['MACDONALD FIONA', 'Fiona /  / MacDonald'],
    ['MACIAS JOSE', 'Jose /  / Macias'],
    ["D'ANGELO LUCA", "Luca /  / D'Angelo"],
  ])('%s -> %s', (input, expected) => {
    expect(fml(parseSiteXOwners(input).primary)).toBe(expected);
  });

  it('legacy toTitleCase is kept verbatim, and is exactly what we do NOT use for names', () => {
    expect(legacyToTitleCase('MCDONALD')).toBe('Mcdonald');
    expect(legacyToTitleCase("O'BRIEN")).toBe("O'brien");
    expect(legacyToTitleCase('SMITH-JONES')).toBe('Smith-jones');
    // ...while the name-aware one gets them right.
    expect(nameTitleCase('MCDONALD')).toBe('McDonald');
    expect(nameTitleCase("O'BRIEN")).toBe("O'Brien");
    expect(nameTitleCase('SMITH-JONES')).toBe('Smith-Jones');
  });

  it('legacy toTitleCase is right for addresses, which is where it is used', () => {
    expect(legacyToTitleCase('31195 EMERY CT')).toBe('31195 Emery Ct');
    expect(legacyToTitleCase('8641 UNIVERSE AVE')).toBe('8641 Universe Ave');
    expect(legacyToTitleCase('1434 N ELM ST')).toBe('1434 N Elm St');
    expect(legacyToTitleCase('WESTMINSTER')).toBe('Westminster');
  });

  it('does not turn a possessive into a capital', () => {
    expect(nameTitleCase("JONES'S")).toBe("Jones's");
  });
});
