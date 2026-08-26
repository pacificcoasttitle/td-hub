// ─── Two title-case functions, deliberately ─────────────────────────────────
//
// Legacy has ONE (custom.js:1051-1053) and uses it for both addresses and
// owner names. It is correct for addresses and wrong for names: it produces
// "Mcdonald", "O'brien" and "Smith-jones", because it only ever uppercases the
// first character of each whitespace-delimited token.
//
// That is fine in a search box. It is not fine printed as a legal name on a
// title document, so names get their own.

/**
 * Legacy's toTitleCase, character for character.
 *
 *   str.replace(/\w\S*!/g, txt => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase())
 *
 * Use for the property ADDRESS and CITY, which is where legacy uses it and
 * where its behaviour is right. State and ZIP are deliberately NOT passed
 * through it — legacy leaves those alone so "CA" stays "CA".
 */
export function legacyToTitleCase(str: string): string {
  return str.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
}

const ROMAN = new Set(['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X']);

/**
 * Mac is genuinely ambiguous and there is no rule that gets it right.
 * "MACDONALD" wants MacDonald; "MACIAS" and "MACEY" absolutely do not want
 * MacIas and MacEy. An allowlist of the common Scottish/Irish surnames is
 * honest about that; everything else falls through to plain capitalisation and
 * reads as "Macias", which is correct.
 */
const MAC_NAMES = new Set([
  'macdonald', 'macarthur', 'mackenzie', 'macleod', 'macgregor', 'macmillan',
  'macpherson', 'macintyre', 'macneil', 'macfarlane', 'macdougall', 'macaulay',
  'macallister', 'macbride', 'maccarthy', 'macgowan', 'mackay', 'macknight',
]);

const cap = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/** One word, no hyphens or apostrophes left in it. */
function capCore(word: string): string {
  if (!word) return word;
  if (ROMAN.has(word.toUpperCase())) return word.toUpperCase();
  const lower = word.toLowerCase();
  if (MAC_NAMES.has(lower)) return `Mac${cap(lower.slice(3))}`;
  // Mc is unambiguous in a way Mac is not: McDonald, McBride, McEwan.
  if (lower.startsWith('mc') && lower.length > 2) return `Mc${cap(lower.slice(2))}`;
  return cap(lower);
}

/**
 * O'Brien and D'Angelo capitalise after the apostrophe; Jones's does not.
 * The discriminator is the length of the part before it — name particles are
 * one or two letters, possessives and contractions follow a whole word.
 */
function capApostrophes(segment: string): string {
  if (!segment.includes("'")) return capCore(segment);
  const parts = segment.split("'");
  const head = parts[0]!;
  const tail = parts.slice(1);
  if (head.length <= 2) return [capCore(head), ...tail.map(capCore)].join("'");
  return [capCore(head), ...tail.map((t) => t.toLowerCase())].join("'");
}

/**
 * Title-case a personal name: Mc/Mac prefixes, internal apostrophes, hyphenated
 * surnames and roman-numeral suffixes all survive.
 *
 *   MCDONALD      -> McDonald
 *   O'BRIEN       -> O'Brien
 *   SMITH-JONES   -> Smith-Jones
 *   SANCHEZ III   -> Sanchez III
 *   MACIAS        -> Macias        (not MacIas — see MAC_NAMES)
 */
export function nameTitleCase(str: string): string {
  return str.replace(/\S+/g, (token) => token.split('-').map(capApostrophes).join('-'));
}
