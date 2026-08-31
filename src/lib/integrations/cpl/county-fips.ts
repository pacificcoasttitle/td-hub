// ─── County FIPS codes ──────────────────────────────────────────────────────
//
// Westcor marks `CountyFips` REQUIRED on the Order/Update property object
// ("REQUIRED: County FIPS Code, (MAX LENGTH 50)"). We have never sent it, and
// Westcor has accepted every order anyway — which is why nobody noticed.
//
// ─── THE FORMAT IS THE 3-DIGIT COUNTY CODE, NOT THE 5-DIGIT STATE+COUNTY ────
//
// The spec's own example pairs:
//
//     "CountyName": "Orange County",  "CountyFips": "095"
//
// Orange County, Florida is FIPS 12095 — state 12, county 095. So the field
// takes the county portion alone.
//
// This matters because our other FIPS source disagrees: SiteX returns
// `FIPS: "06037"` for Los Angeles County, which is the full 5-digit code.
// Handing that straight to Westcor would send a 5-digit value into a 3-digit
// field. `countyFipsFrom` normalises either shape.
//
// ─── WHY A TABLE RATHER THAN THE STORED COLUMN ─────────────────────────────
//
// order_properties.fips is populated on 8 of 8,063 rows. The county name is
// populated on 7,728. A lookup keyed on county+state therefore covers three
// orders of magnitude more of the book than the column does, and county FIPS
// codes are fixed by statute — they do not drift, so a table cannot go stale
// the way cached data can.
//
// All counties of every state we operate in are listed, not only the 69 seen
// in the data, so a first order in a new county resolves rather than falling
// back.

type CountyMap = Record<string, string>;

const CA: CountyMap = {
  alameda: '001', alpine: '003', amador: '005', butte: '007', calaveras: '009',
  colusa: '011', 'contra costa': '013', 'del norte': '015', 'el dorado': '017',
  fresno: '019', glenn: '021', humboldt: '023', imperial: '025', inyo: '027',
  kern: '029', kings: '031', lake: '033', lassen: '035', 'los angeles': '037',
  madera: '039', marin: '041', mariposa: '043', mendocino: '045', merced: '047',
  modoc: '049', mono: '051', monterey: '053', napa: '055', nevada: '057',
  orange: '059', placer: '061', plumas: '063', riverside: '065',
  sacramento: '067', 'san benito': '069', 'san bernardino': '071',
  'san diego': '073', 'san francisco': '075', 'san joaquin': '077',
  'san luis obispo': '079', 'san mateo': '081', 'santa barbara': '083',
  'santa clara': '085', 'santa cruz': '087', shasta: '089', sierra: '091',
  siskiyou: '093', solano: '095', sonoma: '097', stanislaus: '099',
  sutter: '101', tehama: '103', trinity: '105', tulare: '107', tuolumne: '109',
  ventura: '111', yolo: '113', yuba: '115',
};

const AZ: CountyMap = {
  apache: '001', cochise: '003', coconino: '005', gila: '007', graham: '009',
  greenlee: '011', 'la paz': '012', maricopa: '013', mohave: '015',
  navajo: '017', pima: '019', pinal: '021', 'santa cruz': '023',
  yavapai: '025', yuma: '027',
};

const NV: CountyMap = {
  churchill: '001', clark: '003', douglas: '005', elko: '007',
  esmeralda: '009', eureka: '011', humboldt: '013', lander: '015',
  lincoln: '017', lyon: '019', mineral: '021', nye: '023', pershing: '027',
  storey: '029', washoe: '031', 'white pine': '033', 'carson city': '510',
};

const BY_STATE: Record<string, CountyMap> = { CA, AZ, NV };

/**
 * Normalise a county name for lookup.
 *
 * The data holds case variants — "Los Angeles" and "LOS ANGELES", "Orange" and
 * "ORANGE" — and Westcor's own CountyName convention appends " County", which
 * our buildProperty also does. Both forms must resolve to the same key.
 */
function keyOf(county: string): string {
  return county
    .toLowerCase()
    .replace(/\bcounty\b/g, ' ')
    .replace(/[^a-z ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The 3-digit county code, or null when it cannot be determined. */
export function countyFips(county: string | null | undefined, state: string | null | undefined): string | null {
  const name = (county ?? '').trim();
  const st = (state ?? '').trim().toUpperCase();
  if (!name || !st) return null;

  const table = BY_STATE[st];
  if (!table) return null;

  return table[keyOf(name)] ?? null;
}

/**
 * The value to send as `CountyFips`, preferring a stored code over the lookup.
 *
 * A stored code may be 5-digit (SiteX returns "06037") or already 3-digit. Both
 * reduce to the last three digits. Anything else falls through to the county
 * name lookup rather than being sent as-is — a malformed identifier on a legal
 * instrument is worse than an absent one.
 */
export function countyFipsFrom(
  storedFips: string | null | undefined,
  county: string | null | undefined,
  state: string | null | undefined,
): string | null {
  const raw = (storedFips ?? '').replace(/[^0-9]/g, '');
  if (raw.length === 5 || raw.length === 3) return raw.slice(-3);
  return countyFips(county, state);
}
