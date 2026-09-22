/**
 * The choices a farming report is made from — safe for the browser.
 *
 * Separate from generate.ts because that module reaches the database, and the
 * New Report modal needs these lists: a client component importing generate.ts
 * would pull the postgres driver into the browser bundle, which is the build
 * failure of 2026-09-17 (see lib/db/no-db-in-client-bundle.test.ts).
 */
export const FARMING_WINDOWS = [3, 6, 12] as const;
export type FarmingWindow = typeof FARMING_WINDOWS[number];

/** The six counties the County Sales report has always covered. */
export const FARMING_COUNTIES = ['Los Angeles', 'Orange', 'Riverside', 'San Bernardino', 'San Diego', 'Ventura'] as const;
export type FarmingCounty = typeof FARMING_COUNTIES[number];

/**
 * What the preparer may state the area's property type as. A CAPTION: the sales
 * file carries no type column, and the page says so rather than implying a
 * filter that never ran.
 */
export const PROPERTY_TYPE_CHOICES = ['Single family', 'Condominium', '2-4 units', '5+ units'] as const;
