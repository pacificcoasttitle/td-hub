/**
 * California County FIPS codes (Federal Information Processing Standards).
 * Format: state code (06) + county code (3 digits) = 5-digit FIPS.
 * All 58 California counties included.
 * Keys are lowercase county names WITHOUT the word "county".
 */
const CA_COUNTY_FIPS: Record<string, string> = {
  'alameda': '06001',
  'alpine': '06003',
  'amador': '06005',
  'butte': '06007',
  'calaveras': '06009',
  'colusa': '06011',
  'contra costa': '06013',
  'del norte': '06015',
  'el dorado': '06017',
  'fresno': '06019',
  'glenn': '06021',
  'humboldt': '06023',
  'imperial': '06025',
  'inyo': '06027',
  'kern': '06029',
  'kings': '06031',
  'lake': '06033',
  'lassen': '06035',
  'los angeles': '06037',
  'madera': '06039',
  'marin': '06041',
  'mariposa': '06043',
  'mendocino': '06045',
  'merced': '06047',
  'modoc': '06049',
  'mono': '06051',
  'monterey': '06053',
  'napa': '06055',
  'nevada': '06057',
  'orange': '06059',
  'placer': '06061',
  'plumas': '06063',
  'riverside': '06065',
  'sacramento': '06067',
  'san benito': '06069',
  'san bernardino': '06071',
  'san diego': '06073',
  'san francisco': '06075',
  'san joaquin': '06077',
  'san luis obispo': '06079',
  'san mateo': '06081',
  'santa barbara': '06083',
  'santa clara': '06085',
  'santa cruz': '06087',
  'shasta': '06089',
  'sierra': '06091',
  'siskiyou': '06093',
  'solano': '06095',
  'sonoma': '06097',
  'stanislaus': '06099',
  'sutter': '06101',
  'tehama': '06103',
  'trinity': '06105',
  'tulare': '06107',
  'tuolumne': '06109',
  'ventura': '06111',
  'yolo': '06113',
  'yuba': '06115',
};

/**
 * Resolve a FIPS code from a California county name.
 * Handles: "Los Angeles", "Los Angeles County", "LOS ANGELES COUNTY", etc.
 * Returns undefined if the county is not recognized.
 */
export function resolveCaliforniaFips(county: string | null | undefined): string | undefined {
  if (!county) return undefined;
  const normalized = county
    .toLowerCase()
    .replace(/\s+county\s*$/i, '')
    .trim();
  return CA_COUNTY_FIPS[normalized];
}
