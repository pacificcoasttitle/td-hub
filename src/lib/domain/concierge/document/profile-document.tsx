import React from 'react';
import {
  Document, Page, Text, View, Image, StyleSheet, Font, Svg, Rect, Line, Text as SvgText,
} from '@react-pdf/renderer';
import type { CompFilterResult, CompCriteria } from '../comp-filter';
import type { MarketMetrics } from '../metrics';
import type { NormalizedSubject, NormalizedTax, NormalizedTransfer } from '../normalize';
import {
  acres, californiaInstallments, compRange, currentVestingDeed, lotCoverage,
  parseLegal, parseOwners, taxShare, transferCounts,
} from './derive';

// ─── The Concierge Property Profile ──────────────────────────────────────────
//
// v2 of the layout (design: Concierge Property Profile v3, 23 Sep 2026). Eight
// pages, fixed order, letter. The redesign changes structure and hierarchy, not
// the palette — the tokens below are the family's, shared with the three
// farming documents, and the mock's Instrument Sans / #16324F are deliberately
// NOT used.
//
// TEMPLATE_VERSION is stored on every generated row, so an old PDF is always
// tied to the template that made it. Bump it on any layout change.
//
// FOUR RULES THE LAYOUT ENFORCES:
//
//   1. ONE SCOPE. Tables, charts and the map all iterate `filter.selected`.
//      The legacy report used the selection for the table and everything-
//      returned for the charts, so a single page disagreed with itself. The
//      redesign states this on page 5: the numbers are the same on 5, 6 and 7.
//
//   2. GAPS ARE RENDERED, NEVER FILLED. Any absent value prints as an em dash
//      and any absent section prints an Absent box saying why. Nothing is
//      inferred, averaged or borrowed from a comparable.
//
//   3. ONE CAVEAT PER PAGE, as a footnote line. Not inline tags, not chips.
//
//   4. ORANGE MEANS ONE THING: foreclosure-related records, and the one
//      absence that changes the reading (no subject sale). Navy marks the
//      current vesting deed. Orange used for emphasis generally would make
//      the foreclosure colour mean nothing.
//
// ─── THE ESTIMATED VALUE IS OFF BY DEFAULT ───────────────────────────────────
//
// The design leads page 1 with "$749,400, range $701,900 – $779,200". That is
// a statement about THIS HOUSE — a conclusion — where the data is a statement
// about the market. A title company publishing a per-property valuation is a
// compliance question, not a design one, and it is not ours to answer, so the
// document ships with SHOW_ESTIMATED_VALUE false: pages 1 and 6 lead with the
// comparable rate and its range instead, which says what the comparables did
// without asserting what this property is worth.
//
// Turning it on is one constant. Do it only once whoever advises Pacific Coast
// Title on compliance has said yes, and note that the assertion appears TWICE
// in the design — page 1 and the page 6 panel — so both follow this flag.
export const SHOW_ESTIMATED_VALUE = false;

export const TEMPLATE_VERSION = 'v2';

/**
 * Disable hyphenation document-wide.
 *
 * react-pdf hyphenates by default, which turned "LOS ANGELES" into "LOS ANGE-
 * LES" in a cover tile. On a property report the values are proper nouns,
 * addresses and identifiers — a hyphen inserted mid-word reads as part of the
 * data. Returning the word unsplit makes it wrap or shrink instead.
 */
Font.registerHyphenationCallback((word) => [word]);

// The family's tokens. The three farming documents import these, so all four
// artefacts are genuinely one family rather than approximately one.
export const NAVY = '#1B2A4A';
export const ORANGE = '#F26B2B';
export const MUTED = '#526174';
export const BORDER = '#D7DDE5';
export const TINT = '#F8F9FA';
export const GAP = '—';

/** Between TINT and BORDER: the v3 layout leans on filled rows, not rules. */
const FILL = '#F1F3F6';
const PAGE_H = 40;

const s = StyleSheet.create({
  // No vertical padding: the navy bars are full-bleed top and bottom.
  page: { paddingBottom: 48, fontSize: 9.5, color: '#14181D', fontFamily: 'Helvetica', flexDirection: 'column' },
  bar: { backgroundColor: NAVY, paddingHorizontal: PAGE_H, paddingVertical: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  brand: { color: '#FFFFFF', fontSize: 10, fontFamily: 'Helvetica-Bold', letterSpacing: 1.4 },
  barRight: { color: '#FFFFFF', fontSize: 8.5, opacity: 0.75 },
  body: { paddingHorizontal: PAGE_H },

  h1: { fontSize: 20, fontFamily: 'Helvetica-Bold', letterSpacing: -0.3 },
  lede: { fontSize: 10, color: MUTED, marginTop: 6, lineHeight: 1.45 },
  eyebrow: { fontSize: 7.5, letterSpacing: 1.1, color: NAVY, fontFamily: 'Helvetica-Bold', marginBottom: 6 },

  // Filled key/value rows, alternating. The v3 layout replaces ruled rows.
  kv: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7, paddingHorizontal: 10 },
  kvFill: { backgroundColor: FILL },
  kvKey: { fontSize: 9, color: MUTED },
  kvVal: { fontSize: 9, fontFamily: 'Helvetica-Bold' },
  kvAbsent: { fontSize: 9, color: '#8A8580' },

  tiles: { flexDirection: 'row' },
  // marginRight on every tile, never flex `gap`: react-pdf's layout engine
  // ignores gap, which is why the price range once ran into median SF.
  tile: { flex: 1, backgroundColor: FILL, padding: 10, marginRight: 3 },
  tileLast: { marginRight: 0 },
  tileNavy: { backgroundColor: NAVY },
  tileWarn: { backgroundColor: '#FDF1E7' },
  tileLabel: { fontSize: 7, color: MUTED },
  tileLabelOn: { fontSize: 7, color: '#FFFFFF', opacity: 0.8 },
  tileLabelWarn: { fontSize: 7, color: '#B4620B' },
  tileValue: { fontSize: 13, fontFamily: 'Helvetica-Bold', marginTop: 5 },
  tileValueOn: { fontSize: 13, fontFamily: 'Helvetica-Bold', marginTop: 5, color: '#FFFFFF' },
  tileValueWarn: { fontSize: 13, fontFamily: 'Helvetica-Bold', marginTop: 5, color: '#B4620B' },

  th: { fontSize: 7.5, color: MUTED, backgroundColor: '#E8EBEF', paddingVertical: 7, paddingHorizontal: 8 },
  td: { fontSize: 8.5, paddingVertical: 7, paddingHorizontal: 8 },
  tdB: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', paddingVertical: 7, paddingHorizontal: 8 },

  /** The single caveat line at the foot of a page's content. */
  caveat: { fontSize: 8, color: '#8A8580', lineHeight: 1.5, marginTop: 10 },
  callout: { backgroundColor: '#FDF1E7', padding: 14, marginTop: 14 },
  calloutTitle: { fontSize: 10.5, fontFamily: 'Helvetica-Bold', color: '#B4620B' },
  calloutBody: { fontSize: 9, color: '#3C3A36', marginTop: 6, lineHeight: 1.5 },

  footBar: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: NAVY, paddingHorizontal: PAGE_H, paddingVertical: 9, flexDirection: 'row', justifyContent: 'space-between' },
  footText: { color: '#FFFFFF', fontSize: 7.5, opacity: 0.7 },

  gapBox: { borderWidth: 1, borderColor: BORDER, padding: 12, backgroundColor: TINT, marginTop: 6 },
  pin: { width: 15, height: 15, borderRadius: 7.5, color: '#FFFFFF', fontSize: 8, fontFamily: 'Helvetica-Bold', textAlign: 'center', paddingTop: 3.5 },
});

// Exported as a group so the formatting rules are unit-testable. Each of these
// exists because the first cut got it wrong in a way only visible on the page.
export const fmt = { money: (n: number | null | undefined) => money(n), year: (n: number | null | undefined) => year(n), sqft: (n: number | null | undefined) => sqft(n), miles: (n: number | null | undefined) => miles(n), moneyShort: (n: number | null | undefined) => moneyShort(n), numf: (n: number | null | undefined, sfx?: string) => numf(n, sfx) };

const money = (n: number | null | undefined) => (typeof n === 'number' && n > 0 ? '$' + Math.round(n).toLocaleString('en-US') : GAP);
const numf = (n: number | null | undefined, suffix = '') => (typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('en-US') + suffix : GAP);
/**
 * Years are labels, not quantities — 1948, never "1,948". Deliberately a
 * separate formatter from numf so a year can never pick up a thousands
 * separator by being passed to the same helper as square feet and dollars.
 */
const year = (n: number | null | undefined) => (typeof n === 'number' && Number.isFinite(n) ? String(Math.round(n)) : GAP);
/** Compact money for tight tiles: $835k rather than $835,000. */
const moneyShort = (n: number | null | undefined) => {
  if (typeof n !== 'number' || n <= 0) return GAP;
  if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1) + 'M';
  if (n >= 1_000) return '$' + Math.round(n / 1000) + 'k';
  return '$' + Math.round(n);
};
/** Square feet, one format everywhere: "6,625 sf". */
const sqft = (n: number | null | undefined) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') + ' sf' : GAP);
const miles = (n: number | null | undefined) => {
  if (typeof n !== 'number' || !Number.isFinite(n)) return GAP;
  return `${n} ${n === 1 ? 'mile' : 'miles'}`;
};
const txt = (v: string | null | undefined) => (v && v.trim() ? v : GAP);
const dt = (iso: string | null | undefined) => {
  if (!iso) return GAP;
  const d = new Date(iso + 'T00:00:00Z');
  return Number.isNaN(d.getTime()) ? GAP
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
};
const dtLong = (d: Date) => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
/** "$504" — a rate, always whole dollars. */
const rate = (n: number | null | undefined) => (typeof n === 'number' && n > 0 ? '$' + Math.round(n) : GAP);
const pct = (f: number | null | undefined, dp = 0) => (typeof f === 'number' && Number.isFinite(f) ? `${(f * 100).toFixed(dp)}%` : GAP);
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
/**
 * The subject of the page-2 sentence. SiteX's use descriptions are labels
 * ("Single Family Residential"), not nouns, and lower-casing one gives "a
 * single family residential built in 1949". These four cover almost every
 * residential profile; anything else keeps the vendor's own words rather than
 * having a noun invented for it.
 */
const houseNoun = (useDescription: string | null | undefined): string => {
  const v = (useDescription ?? '').trim().toLowerCase();
  if (!v) return 'A property';
  if (v.includes('single family')) return 'A single-family home';
  if (v.includes('condo')) return 'A condominium';
  if (v.includes('duplex') || v.includes('triplex') || v.includes('fourplex') || v.includes('multi')) return 'A multi-family property';
  if (v.includes('vacant') || v.includes('land')) return 'A parcel of land';
  return `A property recorded as ${useDescription!.trim()}`;
};
/** "five" up to ten, so the page 7 heading reads as a sentence. */
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const spell = (n: number) => (n >= 0 && n < WORDS.length ? WORDS[n]! : String(n));

export interface ProfileDocumentInput {
  subject: NormalizedSubject;
  tax: NormalizedTax;
  transfers: NormalizedTransfer[];
  filter: CompFilterResult;
  metrics: MarketMetrics;
  criteria: CompCriteria;
  /** Data URI for the comps map, if we snapshotted one. */
  compMapImage: string | null;
  /** Data URI for the plat map, already converted to PNG. */
  platMapImage: string | null;
  platMapStatus: string | null;
  preparedFor: { name: string | null; company: string | null } | null;
  presentingRep: { name: string | null; email: string | null; phone: string | null; title: string | null } | null;
  generatedAt: Date;
  /** When the vendor payload was captured, if it differs from generation. */
  capturedAt?: Date | null;
  /** Recorded on every call — the handle tying this report to an invoice line. */
  sitexSearchId?: number | null;
}

/** Any comp the tables/charts/map use. Always `filter.selected`, never the raw set. */
// normalizeComps returns these alongside every CompCandidate; the filter's
// type does not name them, so they are declared here rather than reached for
// with a cast at each use.
type Sel = ProfileDocumentInput['filter']['selected'][number]
  & Partial<{ address: string | null; city: string | null; state: string | null; zip: string | null }>;

const TOTAL = 8;

function Shell({ children, page }: { children: React.ReactNode; page: number }) {
  return (
    <Page size="LETTER" style={s.page}>
      <View style={s.bar}>
        <Text style={s.brand}>PACIFIC COAST TITLE</Text>
        <Text style={s.barRight}>Property Profile</Text>
      </View>
      {children}
      <View style={s.footBar} fixed>
        <Text style={s.footText}>Pacific Coast Title Company · SiteX Title Profile_144 · Template {TEMPLATE_VERSION}</Text>
        <Text style={s.footText}>{`${page} of ${TOTAL}`}</Text>
      </View>
    </Page>
  );
}

/** The page title and its one-line, data-generated summary. */
function Head({ title, lede }: { title: string; lede: string }) {
  return (
    <View style={{ paddingTop: 22, paddingBottom: 14 }}>
      <Text style={s.h1}>{title}</Text>
      <Text style={s.lede}>{lede}</Text>
    </View>
  );
}

function KV({ k, v, fill, absent }: { k: string; v: string; fill?: boolean; absent?: boolean }) {
  return (
    <View style={fill ? [s.kv, s.kvFill] : s.kv}>
      <Text style={s.kvKey}>{k}</Text>
      <Text style={absent ? s.kvAbsent : s.kvVal}>{v}</Text>
    </View>
  );
}

function Tile({ label, value, last, tone }: { label: string; value: string; last?: boolean; tone?: 'navy' | 'warn' }) {
  const box = [s.tile, ...(tone === 'navy' ? [s.tileNavy] : tone === 'warn' ? [s.tileWarn] : []), ...(last ? [s.tileLast] : [])];
  return (
    <View style={box}>
      <Text style={tone === 'navy' ? s.tileLabelOn : tone === 'warn' ? s.tileLabelWarn : s.tileLabel}>{label}</Text>
      <Text style={tone === 'navy' ? s.tileValueOn : tone === 'warn' ? s.tileValueWarn : s.tileValue}>{value}</Text>
    </View>
  );
}

/** A rendered absence — used wherever the vendor gave us nothing. */
function Absent({ what, why }: { what: string; why: string }) {
  return (
    <View style={s.gapBox}>
      <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold' }}>{what} not available</Text>
      <Text style={{ fontSize: 8.5, color: MUTED, marginTop: 4, lineHeight: 1.5 }}>{why}</Text>
    </View>
  );
}

/**
 * One bar per selected comparable, scaled to the highest sale.
 *
 * Svg primitives, not a charting library — the same approach the farming
 * documents take. Bars start at zero, which the page says, because a bar chart
 * with a suppressed baseline exaggerates every difference on it.
 */
function CompBars({ comps, medianPrice }: { comps: Sel[]; medianPrice: number | null }) {
  const W = 515, ROW = 26, PAD_L = 150, PAD_R = 54;
  const priced = comps.filter((c) => typeof c.salePrice === 'number' && c.salePrice! > 0);
  if (!priced.length) return <Absent what="Price comparison" why="No selected comparable carried a sale price." />;
  const max = Math.max(...priced.map((c) => c.salePrice!));
  const plotW = W - PAD_L - PAD_R;
  const H = priced.length * ROW + 20;
  return (
    <Svg width={W} height={H}>
      {priced.map((c, i) => {
        const y = i * ROW;
        const isMedian = typeof medianPrice === 'number' && c.salePrice === medianPrice;
        const w = (c.salePrice! / max) * plotW;
        return (
          <React.Fragment key={i}>
            <SvgText x={0} y={y + 15} style={{ fontSize: 8, fill: '#14181D' }}>
              {`${i + 1}  ${(c.address ?? '').slice(0, 26) || 'Comparable ' + (i + 1)}`}
            </SvgText>
            <Rect x={PAD_L} y={y + 4} width={plotW} height={15} fill="#E8EBEF" />
            <Rect x={PAD_L} y={y + 4} width={w} height={15} fill={isMedian ? NAVY : '#3C3A36'} />
            <SvgText x={PAD_L + w - 4} y={y + 15} style={{ fontSize: 8, fill: '#FFFFFF' }} textAnchor="end">
              {money(c.salePrice)}
            </SvgText>
            <SvgText x={W} y={y + 15} style={{ fontSize: 7.5, fill: MUTED }} textAnchor="end">
              {typeof c.proximityMiles === 'number' ? `${c.proximityMiles.toFixed(2)} mi` : ''}
            </SvgText>
          </React.Fragment>
        );
      })}
      <Line x1={PAD_L} y1={priced.length * ROW + 3} x2={W - PAD_R} y2={priced.length * ROW + 3} strokeWidth={0.6} stroke={BORDER} />
      <SvgText x={PAD_L} y={priced.length * ROW + 15} style={{ fontSize: 7, fill: '#8A8580' }}>$0</SvgText>
      <SvgText x={W - PAD_R} y={priced.length * ROW + 15} style={{ fontSize: 7, fill: '#8A8580' }} textAnchor="end">{money(max)}</SvgText>
    </Svg>
  );
}

export function ProfileDocument(input: ProfileDocumentInput) {
  const { subject, tax, transfers, filter, metrics, criteria } = input;
  const comps = filter.selected as Sel[];
  const n = comps.length;

  const owners = parseOwners(subject.primaryOwner);
  const legal = parseLegal(subject.legalDescription, subject);
  const counts = transferCounts(transfers);
  const vesting = currentVestingDeed(transfers);
  const range = compRange(filter, subject, metrics.medianPricePerSqft);
  const coverage = lotCoverage(subject.buildingArea, subject.lotSize);
  const ac = acres(subject.lotSize);
  const share = taxShare(tax);
  const state = (subject.siteCityState ?? '').match(/,\s*([A-Z]{2})\b/)?.[1] ?? null;
  const installments = californiaInstallments(tax, state);
  const captured = input.capturedAt ?? null;

  // Page 5/6/7 superlatives, each from its OWN field — the defect the carrier
  // route report fixed, applied here before it can be repeated.
  const nearest = comps.reduce<Sel | null>((b, c) => (typeof c.proximityMiles === 'number' && (!b || c.proximityMiles < (b.proximityMiles ?? Infinity)) ? c : b), null);
  const dearest = comps.reduce<Sel | null>((b, c) => (typeof c.salePrice === 'number' && (!b || c.salePrice > (b.salePrice ?? -1)) ? c : b), null);

  const soldSpan = (() => {
    const ds = comps.map((c) => c.recordingDate).filter((d): d is string => typeof d === 'string' && d.length > 0).sort();
    if (!ds.length) return GAP;
    const f = (iso: string) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
    return ds[0] === ds[ds.length - 1] ? f(ds[0]!) : `${f(ds[0]!)} – ${f(ds[ds.length - 1]!)}`;
  })();

  return (
    <Document>
      {/* ── 1 · Overview ─────────────────────────────────────────────────── */}
      <Shell page={1}>
        <View style={{ flexGrow: 1, minHeight: 232, backgroundColor: '#EDE9E1', position: 'relative' }}>
          {input.compMapImage
            // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf <Image> is a PDF primitive, not a DOM <img>
            ? <Image src={input.compMapImage} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : null}
          {/* The address sits on a navy band over the map — or on the band
              alone when there is no map, which is why the band is not part of
              the image. */}
          <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: NAVY, opacity: input.compMapImage ? 0.93 : 1, paddingHorizontal: PAGE_H, paddingVertical: 16 }}>
            <Text style={{ color: '#FFFFFF', fontSize: 25, fontFamily: 'Helvetica-Bold', letterSpacing: -0.5 }}>
              {txt(subject.siteAddress)}
            </Text>
            <Text style={{ color: '#FFFFFF', fontSize: 10.5, marginTop: 6, opacity: 0.85 }}>
              {`${txt(subject.siteCityState)} · APN ${txt(subject.apn)}`}
            </Text>
          </View>
        </View>

        <View style={[s.body, { paddingTop: 20 }]}>
          {/* The market statement. See SHOW_ESTIMATED_VALUE at the top of this
              file: what the comparables did, not what this property is worth. */}
          <Text style={{ fontSize: 9.5, color: MUTED }}>
            {SHOW_ESTIMATED_VALUE ? "What the comparable sales suggest it's worth" : 'What comparable homes sold for, per square foot'}
          </Text>
          {SHOW_ESTIMATED_VALUE && range?.midpoint ? (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginTop: 8 }}>
                <Text style={{ fontSize: 30, fontFamily: 'Helvetica-Bold', color: NAVY, letterSpacing: -0.7 }}>{money(range.midpoint)}</Text>
                <Text style={{ fontSize: 11, marginLeft: 12, marginBottom: 4, color: '#3C3A36' }}>{`range ${money(range.low)} – ${money(range.high)}`}</Text>
              </View>
              <Text style={{ fontSize: 8.5, color: '#8A8580', marginTop: 7, lineHeight: 1.5 }}>
                {`${sqft(subject.buildingArea)} at the comparable range of ${rate(range.minPerSqft)}–${rate(range.maxPerSqft)} per sf. Informational — not an appraisal.`}
              </Text>
            </>
          ) : range ? (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginTop: 8 }}>
                <Text style={{ fontSize: 30, fontFamily: 'Helvetica-Bold', color: NAVY, letterSpacing: -0.7 }}>
                  {`${rate(range.minPerSqft)} – ${rate(range.maxPerSqft)}`}
                </Text>
                <Text style={{ fontSize: 11, marginLeft: 12, marginBottom: 4, color: '#3C3A36' }}>
                  {`median ${rate(range.medianPerSqft)} per sf`}
                </Text>
              </View>
              <Text style={{ fontSize: 8.5, color: '#8A8580', marginTop: 7, lineHeight: 1.5 }}>
                {`Across ${plural(range.basedOn, 'comparable sale')} near this property. These are the comparables' own rates — no value has been calculated for this property, and this is not an appraisal.`}
              </Text>
            </>
          ) : (
            <Text style={{ fontSize: 8.5, color: '#8A8580', marginTop: 8, lineHeight: 1.5 }}>
              Not enough comparable sales carried both a price and a building area to state a range.
            </Text>
          )}
        </View>

        <View style={[s.tiles, { marginTop: 20, backgroundColor: FILL }]}>
          <Tile label="Building" value={sqft(subject.buildingArea)} />
          <Tile label="Beds / baths" value={`${numf(subject.beds)} / ${numf(subject.baths)}`} />
          <Tile label="Year built" value={year(subject.yearBuilt)} />
          <Tile label="Lot" value={sqft(subject.lotSize)} />
          <Tile label="Comparables" value={String(n)} last />
        </View>

        <View style={[s.body, { flexDirection: 'row', justifyContent: 'space-between', marginTop: 20, marginBottom: 6 }]}>
          <View>
            <Text style={{ fontSize: 8, color: MUTED }}>Presented by</Text>
            <Text style={{ fontSize: 11, fontFamily: 'Helvetica-Bold', marginTop: 5 }}>{txt(input.presentingRep?.name)}</Text>
            <Text style={{ fontSize: 9, color: MUTED, marginTop: 3 }}>
              {[input.presentingRep?.email, input.presentingRep?.phone].filter(Boolean).join(' · ') || GAP}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ fontSize: 8, color: MUTED }}>
              {input.preparedFor?.name ? `Prepared for ${input.preparedFor.name}` : 'Prepared for —'}
            </Text>
            {input.preparedFor?.company ? <Text style={{ fontSize: 9, marginTop: 5 }}>{input.preparedFor.company}</Text> : null}
            <Text style={{ fontSize: 9, color: '#3C3A36', marginTop: 5 }}>
              {dtLong(input.generatedAt) + (captured ? ` · data captured ${dtLong(captured)}` : '')}
            </Text>
          </View>
        </View>
      </Shell>

      {/* ── 2 · The property ─────────────────────────────────────────────── */}
      <Shell page={2}>
        <View style={s.body}>
          <Head
            title="The property"
            /* "A single family residential built in 1949" is what lower-casing
               the vendor's use description gives you. The lede is a sentence,
               so the common types get the word an English sentence wants and
               anything else falls back to the vendor's own phrase. */
            lede={`${houseNoun(subject.useDescription)}${subject.yearBuilt ? ` built in ${year(subject.yearBuilt)}` : ''}${tax.assessedValue ? `, assessed at ${money(tax.assessedValue)}${tax.year ? ` for ${year(tax.year)}` : ''}` : ''}.`}
          />

          <View style={{ flexDirection: 'row' }}>
            <View style={{ flex: 1, marginRight: 18 }}>
              <Text style={s.eyebrow}>THE HOUSE</Text>
              <KV k="Building area" v={sqft(subject.buildingArea)} fill />
              <KV k="Bedrooms" v={numf(subject.beds)} />
              <KV k="Bathrooms" v={numf(subject.baths)} fill />
              <KV k="Year built" v={year(subject.yearBuilt)} />
              <KV k="Use" v={txt(subject.useDescription)} fill />
              <KV k="Use code" v={txt(subject.useCode)} absent={!subject.useCode} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.eyebrow}>THE LAND</Text>
              <KV k="Lot area" v={ac ? `${sqft(subject.lotSize)} · ${ac.toFixed(2)} ac` : sqft(subject.lotSize)} fill />
              <KV k="House covers" v={coverage ? `${pct(coverage)} of lot` : GAP} absent={!coverage} />
              <KV k="Land value" v={money(tax.landValue)} fill />
              <KV k="Improvement value" v={money(tax.improvementValue)} />
              <KV k="Market value" v={money(tax.marketValue)} fill absent={!tax.marketValue} />
              <KV k="County" v={txt(subject.county)} />
            </View>
          </View>

          <Text style={[s.eyebrow, { marginTop: 22 }]}>LEGAL DESCRIPTION</Text>
          {legal ? (
            <>
              <View style={s.tiles}>
                <Tile label="Tract" value={legal.tract ?? GAP} />
                <Tile label="Lot" value={legal.lot ?? GAP} />
                <Tile label="County" value={txt(subject.county)} />
                <Tile label="FIPS" value={txt(subject.fips)} last />
              </View>
              <View style={{ backgroundColor: FILL, padding: 10, marginTop: 3 }}>
                <Text style={s.tileLabel}>As recorded</Text>
                <Text style={{ fontSize: 10, fontFamily: 'Helvetica-Bold', marginTop: 5 }}>{legal.asRecorded}</Text>
              </View>
            </>
          ) : (
            <Absent what="Legal description" why="SiteX returned no brief legal description for this parcel." />
          )}

          {subject.lastSalePrice === null ? (
            <View style={s.callout}>
              <Text style={s.calloutTitle}>No subject sale on record</Text>
              <Text style={s.calloutBody}>
                SiteX supplied no sale price or loan amount for this parcel, and nothing has been substituted in its place.
                The comparable sales are on pages 5 to 7; the ownership record is on page 4.
              </Text>
            </View>
          ) : (
            <>
              <Text style={[s.eyebrow, { marginTop: 22 }]}>LAST RECORDED SALE</Text>
              <KV k="Sale price" v={money(subject.lastSalePrice)} fill />
              <KV k="Sale date" v={dt(subject.lastSaleDate)} />
            </>
          )}
        </View>
      </Shell>

      {/* ── 3 · Owners and taxes ─────────────────────────────────────────── */}
      <Shell page={3}>
        <View style={s.body}>
          <Head
            title="Owners and taxes"
            lede={`${owners.length > 0 ? `${spell(owners.length).charAt(0).toUpperCase() + spell(owners.length).slice(1)} ${owners.length === 1 ? 'party is' : 'parties are'} vested.` : 'Vesting was not provided.'}${tax.taxAmount ? ` Taxes for ${year(tax.year)} total ${money(tax.taxAmount)}${tax.status ? ` and are ${tax.status.toLowerCase()}` : ''}.` : ''}`}
          />

          <Text style={s.eyebrow}>VESTED OWNERS</Text>
          {owners.length > 0 ? (
            <View style={{ flexDirection: 'row' }}>
              {owners.slice(0, 3).map((o, i) => (
                <View key={i} style={[s.tile, ...(i === Math.min(owners.length, 3) - 1 ? [s.tileLast] : [])]}>
                  <Text style={{ fontSize: 13, fontFamily: 'Helvetica-Bold', letterSpacing: -0.2 }}>{o.display}</Text>
                  <Text style={{ fontSize: 8, color: '#8A8580', marginTop: 5 }}>{`Recorded as ${o.recorded}`}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Absent what="Vesting" why="SiteX returned no owner of record for this parcel." />
          )}
          {owners.length > 3 ? (
            <Text style={s.caveat}>{`${owners.length - 3} further vested ${owners.length - 3 === 1 ? 'party is' : 'parties are'} recorded and not shown here.`}</Text>
          ) : null}

          <Text style={[s.eyebrow, { marginTop: 22 }]}>{`ASSESSMENT · ${year(tax.year)}`}</Text>
          <View style={s.tiles}>
            <Tile label="Total assessed" value={money(tax.assessedValue)} tone="navy" />
            <Tile label="Land" value={money(tax.landValue)} />
            <Tile label="Improvements" value={money(tax.improvementValue)} last />
          </View>

          <Text style={[s.eyebrow, { marginTop: 22 }]}>PROPERTY TAX</Text>
          {installments ? (
            <>
              <View style={{ flexDirection: 'row' }}>
                <Text style={[s.th, { flex: 1.1 }]}>Installment</Text>
                <Text style={[s.th, { flex: 1, textAlign: 'right' }]}>Amount</Text>
                <Text style={[s.th, { flex: 1.3 }]}>Due</Text>
                <Text style={[s.th, { flex: 1.5 }]}>Delinquent after</Text>
                <Text style={[s.th, { flex: 1 }]}>Status</Text>
              </View>
              {installments.map((it, i) => (
                <View key={it.label} style={i % 2 === 1 ? { flexDirection: 'row', backgroundColor: FILL } : { flexDirection: 'row' }}>
                  <Text style={[s.tdB, { flex: 1.1 }]}>{it.label}</Text>
                  <Text style={[s.tdB, { flex: 1, textAlign: 'right' }]}>{money(it.amount)}</Text>
                  <Text style={[s.td, { flex: 1.3 }]}>{it.due}</Text>
                  <Text style={[s.td, { flex: 1.5 }]}>{it.delinquentAfter}</Text>
                  <Text style={[s.td, { flex: 1, color: '#8A8580' }]}>Not provided</Text>
                </View>
              ))}
              <View style={{ flexDirection: 'row', backgroundColor: '#E8EBEF' }}>
                <Text style={[s.tdB, { flex: 1.1 }]}>Annual total</Text>
                <Text style={[s.tdB, { flex: 1, textAlign: 'right' }]}>{money(tax.taxAmount)}</Text>
                <Text style={[s.td, { flex: 2.8, color: MUTED }]}>{`Tax year ${year(tax.year)}${subject.county ? ` · ${subject.county} County` : ''}`}</Text>
                <Text style={[s.tdB, { flex: 1 }]}>{txt(tax.status)}</Text>
              </View>
              <Text style={s.caveat}>
                The payload carries only the annual amount and a status, so each installment shows half the annual total and
                California&rsquo;s statutory dates. Payment date, balance and penalty are not provided.
              </Text>
            </>
          ) : (
            <>
              <KV k="Annual tax" v={money(tax.taxAmount)} fill />
              <KV k="Status" v={txt(tax.status)} />
              <Text style={s.caveat}>
                Installment dates are set by statute and differ by state, so only the annual amount is shown.
              </Text>
            </>
          )}

          <View style={[s.tiles, { marginTop: 16 }]}>
            <Tile label="Tax as share of assessed value" value={pct(share, 2)} />
            <Tile label="Foreclosure-related records" value={counts.foreclosure > 0 ? `${counts.foreclosure} · see page 4` : '0'} tone={counts.foreclosure > 0 ? 'warn' : undefined} />
            <Tile label="Recorded documents" value={String(counts.total)} last />
          </View>
        </View>
      </Shell>

      {/* ── 4 · Ownership history ────────────────────────────────────────── */}
      <Shell page={4}>
        <View style={s.body}>
          <Head
            title="Ownership history"
            lede={`${plural(counts.total, 'document')} recorded${(() => {
              const ds = transfers.map((t) => t.recordingDate).filter((d): d is string => !!d).sort();
              return ds.length >= 2 ? ` between ${ds[0]!.slice(0, 4)} and ${ds[ds.length - 1]!.slice(0, 4)}` : '';
            })()}.`}
          />

          {vesting ? (
            <View style={{ backgroundColor: NAVY, padding: 14, flexDirection: 'row', justifyContent: 'space-between' }}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={{ fontSize: 8, color: '#F0C79A' }}>Current ownership rests on this deed</Text>
                <Text style={{ fontSize: 12, fontFamily: 'Helvetica-Bold', color: '#FFFFFF', marginTop: 6 }}>
                  {owners.map((o) => o.display).join(' & ') || GAP}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ fontSize: 11, fontFamily: 'Helvetica-Bold', color: '#FFFFFF' }}>{dt(vesting.recordingDate)}</Text>
                <Text style={{ fontSize: 8.5, color: '#FFFFFF', opacity: 0.75, marginTop: 4 }}>
                  {`${txt(vesting.documentType ?? vesting.transactionType)} · ${vesting.documentNumber ?? 'no document number'}`}
                </Text>
              </View>
            </View>
          ) : (
            <Absent what="Current vesting deed" why="No deed in the recorded history carries a current-owner flag." />
          )}

          <View style={[s.tiles, { marginTop: 14 }]}>
            <Tile label="Deeds" value={String(counts.deeds)} />
            <Tile label="Mortgages" value={String(counts.mortgages)} />
            <Tile label="Releases & assignments" value={String(counts.releasesAndAssignments)} />
            <Tile label="Foreclosure-related" value={String(counts.foreclosure)} tone={counts.foreclosure > 0 ? 'warn' : undefined} last />
          </View>

          <Text style={[s.eyebrow, { marginTop: 20 }]}>RECORDED DOCUMENTS</Text>
          <View style={{ flexDirection: 'row' }}>
            {[transfers.slice(0, Math.ceil(transfers.length / 2)), transfers.slice(Math.ceil(transfers.length / 2))].map((half, col) => (
              <View key={col} style={{ flex: 1, marginRight: col === 0 ? 14 : 0 }}>
                {half.map((t, i) => {
                  const fore = t.isForeclosure === true;
                  const isVesting = vesting !== null && t.sourcePosition === vesting.sourcePosition;
                  const bg = isVesting ? NAVY : fore ? '#FDF1E7' : i % 2 === 0 ? FILL : undefined;
                  const fg = isVesting ? '#FFFFFF' : fore ? '#B4620B' : '#14181D';
                  return (
                    <View key={t.sourcePosition} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, paddingHorizontal: 9, backgroundColor: bg, marginTop: i === 0 ? 0 : 1 }}>
                      <Text style={{ fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: fg }}>{dt(t.recordingDate)}</Text>
                      <Text style={{ fontSize: 8, color: isVesting ? '#F0C79A' : fore ? '#B4620B' : MUTED }}>
                        {isVesting
                          ? `${txt(t.documentType ?? t.transactionType)} · current vesting`
                          : `${txt(t.documentType ?? t.transactionType)} · ${t.documentNumber ?? 'no document number'}`}
                      </Text>
                    </View>
                  );
                })}
              </View>
            ))}
          </View>

          {counts.foreclosure > 0 ? (
            <View style={s.callout}>
              <Text style={s.calloutBody}>
                {`${plural(counts.foreclosure, 'foreclosure-related document')} appear in this history. Their presence does not mean a proceeding is active today — confirm current status through title review.`}
              </Text>
            </View>
          ) : null}
          <Text style={s.caveat}>
            Book and page references are shown where the payload provides them; this one does not.
          </Text>
        </View>
      </Shell>

      {/* ── 5 · Where the comparables are ────────────────────────────────── */}
      <Shell page={5}>
        <View style={s.body}>
          <Head
            title="Where the comparables are"
            lede={`${spell(n).charAt(0).toUpperCase() + spell(n).slice(1)} ${n === 1 ? 'sale' : 'sales'}${metrics.furthestSelectedMiles !== null ? `, all within ${metrics.furthestSelectedMiles} ${metrics.furthestSelectedMiles === 1 ? 'mile' : 'miles'}` : ''}. These numbers stay the same on pages 6 and 7.`}
          />
          {input.compMapImage
            // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf <Image> is a PDF primitive, not a DOM <img>
            ? <Image src={input.compMapImage} style={{ width: '100%', height: 250, objectFit: 'cover' }} />
            : <Absent what="Comparable map" why="No map image was captured for this profile." />}

          <View style={{ flexDirection: 'row', marginTop: 14 }}>
            <Text style={[s.th, { flex: 0.5 }]}> </Text>
            <Text style={[s.th, { flex: 3 }]}>Address</Text>
            <Text style={[s.th, { flex: 1.5 }]}>Sold</Text>
            <Text style={[s.th, { flex: 1.5, textAlign: 'right' }]}>Price</Text>
            <Text style={[s.th, { flex: 1, textAlign: 'right' }]}>Per sf</Text>
            <Text style={[s.th, { flex: 1.2, textAlign: 'right' }]}>Distance</Text>
          </View>
          {comps.map((c, i) => {
            const isNearest = nearest !== null && c === nearest;
            const tag = isNearest ? ' nearest' : dearest !== null && c === dearest ? ' highest sale' : '';
            return (
              <View key={i} style={{ flexDirection: 'row', backgroundColor: i % 2 === 1 ? FILL : undefined, alignItems: 'center' }}>
                <View style={{ flex: 0.5, paddingLeft: 6 }}>
                  <Text style={[s.pin, { backgroundColor: isNearest ? ORANGE : '#3C3A36' }]}>{String(i + 1)}</Text>
                </View>
                <Text style={[s.tdB, { flex: 3 }]}>{`${txt(c.address)}${tag}`}</Text>
                <Text style={[s.td, { flex: 1.5 }]}>{dt(c.recordingDate)}</Text>
                <Text style={[s.tdB, { flex: 1.5, textAlign: 'right' }]}>{money(c.salePrice)}</Text>
                <Text style={[s.td, { flex: 1, textAlign: 'right' }]}>{rate(c.pricePerSqft)}</Text>
                <Text style={[s.td, { flex: 1.2, textAlign: 'right' }]}>
                  {typeof c.proximityMiles === 'number' ? `${c.proximityMiles.toFixed(2)} mi` : GAP}
                </Text>
              </View>
            );
          })}
          <Text style={s.caveat}>
            {/* The capture date belongs to the MAP. Printing it when there is
                no map claimed a provenance for something absent. */}
            {`${captured && input.compMapImage ? `Map captured ${dtLong(captured)}. ` : ''}Price per sf is the sale price divided by building area.${metrics.compsMissingPricePerSqft > 0 ? ` ${plural(metrics.compsMissingPricePerSqft, 'sale')} carried no rate from the vendor.` : ''}`}
          </Text>
        </View>
      </Shell>

      {/* ── 6 · How they compare ─────────────────────────────────────────── */}
      <Shell page={6}>
        <View style={s.body}>
          <Head
            title="How they compare"
            /* NOT "the middle sale is X". With an even number of sales the
               median is midway between the two middle ones, so no sale on the
               page carries that figure and the sentence describes a row that
               is not there. This wording is true either way — and it is why
               the navy bar highlights a sale only when one genuinely IS the
               median. */
            lede={`Half of these sales are above ${money(metrics.medianSalePrice)} and half below. Bars start at zero and scale to the highest sale.`}
          />
          <View style={s.tiles}>
            <Tile label="Median sale" value={money(metrics.medianSalePrice)} tone="navy" />
            <Tile label="Median per sf" value={rate(metrics.medianPricePerSqft)} />
            <Tile label="Median size" value={sqft(metrics.medianBuildingArea)} />
            <Tile label="Sold between" value={soldSpan} last />
          </View>

          <View style={{ marginTop: 20 }}>
            <CompBars comps={comps} medianPrice={metrics.medianSalePrice} />
          </View>

          <View style={{ flexDirection: 'row', marginTop: 18 }}>
            <View style={{ flex: 1, backgroundColor: FILL, padding: 13, marginRight: 3 }}>
              <Text style={{ fontSize: 10, fontFamily: 'Helvetica-Bold' }}>How the range was built</Text>
              <Text style={{ fontSize: 8.5, color: '#3C3A36', marginTop: 6, lineHeight: 1.5 }}>
                Price per sf is calculated for each sale from its own price and building area, then the middle of those
                rates is taken. No adjustment was made for condition, view or upgrades.
              </Text>
            </View>
            <View style={{ flex: 1, backgroundColor: NAVY, padding: 13 }}>
              <Text style={{ fontSize: 10, fontFamily: 'Helvetica-Bold', color: '#F0C79A' }}>
                {SHOW_ESTIMATED_VALUE ? 'Applied to this property' : 'The comparable rates'}
              </Text>
              {SHOW_ESTIMATED_VALUE && range?.midpoint ? (
                <>
                  <Text style={{ fontSize: 15, fontFamily: 'Helvetica-Bold', color: '#FFFFFF', marginTop: 6 }}>
                    {`${money(range.low)} – ${money(range.high)}`}
                  </Text>
                  <Text style={{ fontSize: 8.5, color: '#FFFFFF', opacity: 0.8, marginTop: 5, lineHeight: 1.5 }}>
                    {`Midpoint ${money(range.midpoint)} at the median ${rate(range.medianPerSqft)} per sf.`}
                  </Text>
                </>
              ) : range ? (
                <>
                  <Text style={{ fontSize: 15, fontFamily: 'Helvetica-Bold', color: '#FFFFFF', marginTop: 6 }}>
                    {`${rate(range.minPerSqft)} – ${rate(range.maxPerSqft)} per sf`}
                  </Text>
                  <Text style={{ fontSize: 8.5, color: '#FFFFFF', opacity: 0.8, marginTop: 5, lineHeight: 1.5 }}>
                    {`Median ${rate(range.medianPerSqft)} across ${plural(range.basedOn, 'sale')}. Applying a rate to this property is a judgement for the reader, not a figure this report states.`}
                  </Text>
                </>
              ) : (
                <Text style={{ fontSize: 8.5, color: '#FFFFFF', opacity: 0.8, marginTop: 6, lineHeight: 1.5 }}>
                  Too few comparable sales carried both a price and a building area to state a range.
                </Text>
              )}
            </View>
          </View>
        </View>
      </Shell>

      {/* ── 7 · The sales in detail ──────────────────────────────────────── */}
      <Shell page={7}>
        <View style={s.body}>
          <Head
            title={`The ${spell(n)} ${n === 1 ? 'sale' : 'sales'} in detail`}
            lede="Same numbers as the map and the chart."
          />
          {comps.length === 0 ? (
            <Absent what="Comparable sales" why="No candidate passed the filter criteria applied to this profile." />
          ) : comps.map((c, i) => (
            <View key={i} style={{ backgroundColor: i % 2 === 0 ? FILL : undefined, padding: 11, marginBottom: 3 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={[s.pin, { backgroundColor: i === 0 ? ORANGE : '#3C3A36', marginRight: 8 }]}>{String(i + 1)}</Text>
                  <Text style={{ fontSize: 11, fontFamily: 'Helvetica-Bold' }}>{txt(c.address)}</Text>
                </View>
                <Text style={{ fontSize: 12, fontFamily: 'Helvetica-Bold' }}>{money(c.salePrice)}</Text>
              </View>
              <View style={{ flexDirection: 'row', marginTop: 7 }}>
                {[
                  ['Sold', dt(c.recordingDate)],
                  ['Per sf', rate(c.pricePerSqft)],
                  ['Building', sqft(c.buildingArea)],
                  ['Beds / baths', `${numf(c.bedrooms)} / ${numf(c.baths)}`],
                  ['Year', year(c.yearBuilt)],
                  ['Distance', typeof c.proximityMiles === 'number' ? `${c.proximityMiles.toFixed(2)} mi` : GAP],
                ].map(([k, v], j) => (
                  <View key={j} style={{ flex: 1 }}>
                    <Text style={{ fontSize: 7, color: MUTED }}>{k}</Text>
                    <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', marginTop: 3 }}>{v}</Text>
                  </View>
                ))}
              </View>
            </View>
          ))}
        </View>
      </Shell>

      {/* ── 8 · Parcel map and sources ───────────────────────────────────── */}
      <Shell page={8}>
        <View style={s.body}>
          <Head title="Parcel map and sources" lede="Where every figure in this report came from." />
          {input.platMapImage
            // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf <Image> is a PDF primitive, not a DOM <img>
            ? <Image src={input.platMapImage} style={{ width: '100%', height: 300, objectFit: 'contain' }} />
            : <Absent what="Parcel map" why={input.platMapStatus ? `The county plat map could not be attached: ${input.platMapStatus}.` : 'No plat map was available for this parcel.'} />}

          <Text style={[s.eyebrow, { marginTop: 20 }]}>COMPARABLE CRITERIA, AS APPLIED</Text>
          <View style={s.tiles}>
            <Tile label="Radius" value={metrics.appliedRadiusMiles !== null ? miles(metrics.appliedRadiusMiles) : GAP} />
            <Tile label="Sold within" value={criteria.months !== null ? plural(criteria.months, 'month') : GAP} />
            <Tile label="Size tolerance" value={criteria.livingAreaPct !== null ? `±${criteria.livingAreaPct}%` : GAP} />
            <Tile label="Shown of qualifying" value={`${n} of ${filter.counts.qualified}`} last />
          </View>
          <Text style={s.caveat}>
            {`${filter.counts.returned} candidate ${filter.counts.returned === 1 ? 'sale was' : 'sales were'} returned; ${filter.counts.qualified} passed every rule and ${n} ${n === 1 ? 'is' : 'are'} shown. The maximum is a ceiling, not a quota — a profile with fewer qualifying sales shows fewer, and none are added to reach a count.`}
          </Text>

          <Text style={[s.eyebrow, { marginTop: 20 }]}>SOURCES</Text>
          <View style={{ backgroundColor: FILL, padding: 13 }}>
            <Text style={{ fontSize: 8.5, color: '#3C3A36', lineHeight: 1.6 }}>
              {`Property, tax and comparable data from SiteX Title Profile_144${captured ? `, captured ${dtLong(captured)}` : ''}.`}
              {input.sitexSearchId ? ` Vendor search id ${input.sitexSearchId}.` : ''}
              {' Owner names are shown in natural reading order; entity names are unchanged. '}
              {`Report generated ${dtLong(input.generatedAt)}. For informational purposes only — not an appraisal or a commitment to insure.`}
            </Text>
          </View>
        </View>
      </Shell>
    </Document>
  );
}
