import React from 'react';
import {
  Document, Page, Text, View, Image, StyleSheet, Font, Svg, Rect, Line, Text as SvgText,
} from '@react-pdf/renderer';
import type { CompFilterResult, CompCriteria } from '../comp-filter';
import type { MarketMetrics } from '../metrics';
import { pricePerSqft } from '../metrics';
import type { NormalizedSubject, NormalizedTax, NormalizedTransfer } from '../normalize';

// ─── The Concierge Property Profile ──────────────────────────────────────────
//
// TEMPLATE_VERSION is stored on every generated row. Changing the layout means
// bumping it, so an old PDF can always be tied to the template that made it.
//
// TWO RULES THE LAYOUT ENFORCES:
//
//   1. ONE SCOPE. Tables, charts and the map all iterate `filter.selected`.
//      The legacy report used the selection for the table and everything-
//      returned for the charts, so a single page disagreed with itself.
//
//   2. GAPS ARE RENDERED, NEVER FILLED. Any absent value prints as an em dash.
//      Nothing is inferred, averaged, or borrowed from a comparable — the
//      subject's own last sale is genuinely missing on some properties.

export const TEMPLATE_VERSION = 'v1';

/**
 * Disable hyphenation document-wide.
 *
 * react-pdf hyphenates by default, which turned "LOS ANGELES" into "LOS ANGE-
 * LES" in a cover tile. On a property report the values are proper nouns,
 * addresses and identifiers — a hyphen inserted mid-word reads as part of the
 * data. Returning the word unsplit makes it wrap or shrink instead.
 */
Font.registerHyphenationCallback((word) => [word]);

const NAVY = '#1B2A4A';
const ORANGE = '#F26B2B';
const MUTED = '#526174';
const BORDER = '#D7DDE5';
const TINT = '#F8F9FA';
const GAP = '—';

const s = StyleSheet.create({
  page: { paddingTop: 34, paddingBottom: 46, paddingHorizontal: 40, fontSize: 8.5, color: NAVY, fontFamily: 'Helvetica' },
  bar: { backgroundColor: NAVY, marginHorizontal: -40, marginTop: -34, paddingHorizontal: 40, paddingVertical: 13, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  brand: { color: '#FFFFFF', fontSize: 12, fontFamily: 'Helvetica-Bold', letterSpacing: 0.6 },
  kicker: { color: ORANGE, fontSize: 7.5, letterSpacing: 1.3, fontFamily: 'Helvetica-Bold' },
  h1: { fontSize: 17, fontFamily: 'Helvetica-Bold', marginTop: 16 },
  sub: { fontSize: 9, color: MUTED, marginTop: 3 },
  section: { fontSize: 7.5, letterSpacing: 1.2, color: ORANGE, fontFamily: 'Helvetica-Bold', marginTop: 16, marginBottom: 6 },
  tiles: { flexDirection: 'row' },
  // marginRight on every tile, not `gap`: react-pdf's layout engine does not
  // honour flex gap, which is why the price range ran into median SF.
  tile: { flex: 1, borderWidth: 1, borderColor: BORDER, borderRadius: 5, padding: 7, backgroundColor: TINT, marginRight: 6 },
  tileLast: { marginRight: 0 },
  tileLabel: { fontSize: 6, color: MUTED, letterSpacing: 0.6, fontFamily: 'Helvetica-Bold' },
  tileValue: { fontSize: 10.5, fontFamily: 'Helvetica-Bold', marginTop: 3 },
  tileValueSm: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', marginTop: 3 },
  row: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: BORDER, paddingVertical: 3.5 },
  th: { fontSize: 6, color: MUTED, fontFamily: 'Helvetica-Bold', letterSpacing: 0.5 },
  td: { fontSize: 7.5 },
  kv: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: BORDER, paddingVertical: 4 },
  kvKey: { flex: 1, fontSize: 7.5, color: MUTED },
  kvVal: { flex: 1.6, fontSize: 7.5, fontFamily: 'Helvetica-Bold' },
  note: { fontSize: 7.5, color: MUTED, lineHeight: 1.5 },
  foot: { position: 'absolute', bottom: 22, left: 40, right: 40, flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: BORDER, paddingTop: 6 },
  footText: { fontSize: 6, color: MUTED },
  gapBox: { borderWidth: 1, borderColor: BORDER, borderRadius: 5, padding: 12, backgroundColor: TINT, marginTop: 4 },
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
}

/** Any comp the tables/charts/map use. Always `filter.selected`, never the raw set. */
type Sel = ProfileDocumentInput['filter']['selected'][number] & Partial<{ address: string | null }>;

function Shell({ kicker, children, page, total }: { kicker: string; children: React.ReactNode; page: number; total: number }) {
  return (
    <Page size="LETTER" style={s.page}>
      <View style={s.bar}>
        <Text style={s.brand}>PACIFIC COAST TITLE</Text>
        <Text style={s.kicker}>{kicker}</Text>
      </View>
      {children}
      <View style={s.foot} fixed>
        <Text style={s.footText}>Pacific Coast Title Company · Property data: SiteX Title Profile_144 · Template {TEMPLATE_VERSION}</Text>
        <Text style={s.footText}>{`Page ${page} of ${total}`}</Text>
      </View>
    </Page>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <View style={s.kv}>
      <Text style={s.kvKey}>{k}</Text>
      <Text style={s.kvVal}>{v}</Text>
    </View>
  );
}

/** A rendered absence — used wherever the vendor gave us nothing. */
function Absent({ what, why }: { what: string; why: string }) {
  return (
    <View style={s.gapBox}>
      <Text style={{ fontSize: 8, fontFamily: 'Helvetica-Bold' }}>{what} not available</Text>
      <Text style={{ fontSize: 7.5, color: MUTED, marginTop: 3, lineHeight: 1.5 }}>{why}</Text>
    </View>
  );
}

function PriceChart({ comps }: { comps: Sel[] }) {
  const W = 515, H = 150, PAD_L = 46, PAD_B = 22, PAD_T = 8;
  const prices = comps.map((c) => c.salePrice ?? 0).filter((p) => p > 0);
  if (!prices.length) return <Absent what="Price comparison" why="No selected comparable carried a sale price." />;
  const max = Math.max(...prices);
  const plotW = W - PAD_L - 8, plotH = H - PAD_B - PAD_T;
  const bw = plotW / prices.length;
  return (
    <Svg width={W} height={H}>
      {[0, 0.5, 1].map((f, i) => {
        const y = PAD_T + plotH * (1 - f);
        return (
          <React.Fragment key={i}>
            <Line x1={PAD_L} y1={y} x2={W - 8} y2={y} strokeWidth={0.5} stroke={BORDER} />
            <SvgText x={4} y={y + 3} style={{ fontSize: 6, fill: MUTED }}>{'$' + Math.round((max * f) / 1000) + 'k'}</SvgText>
          </React.Fragment>
        );
      })}
      {prices.map((p, i) => (
        <Rect key={i} x={PAD_L + i * bw + bw * 0.18} y={PAD_T + plotH - (p / max) * plotH}
          width={bw * 0.64} height={(p / max) * plotH} fill={i === 0 ? ORANGE : NAVY} />
      ))}
      <Line x1={PAD_L} y1={PAD_T + plotH} x2={W - 8} y2={PAD_T + plotH} strokeWidth={0.8} stroke={NAVY} />
      <SvgText x={PAD_L} y={H - 7} style={{ fontSize: 6, fill: MUTED }}>
        {`${prices.length} selected comparable sales, nearest first (orange = closest)`}
      </SvgText>
    </Svg>
  );
}

export function ProfileDocument(input: ProfileDocumentInput) {
  const { subject, tax, transfers, filter, metrics, criteria } = input;
  const comps = filter.selected as Sel[];
  const TOTAL = 8;

  return (
    <Document>
      {/* 1 — cover */}
      <Shell kicker="PROPERTY PROFILE" page={1} total={TOTAL}>
        <Text style={s.h1}>{txt(subject.siteAddress)}</Text>
        <Text style={s.sub}>{txt(subject.siteCityState)}</Text>
        <Text style={s.section}>PREPARED</Text>
        <KV k="Prepared for" v={txt(input.preparedFor?.name)} />
        <KV k="Company" v={txt(input.preparedFor?.company)} />
        <KV k="Presented by" v={txt(input.presentingRep?.name)} />
        <KV k="Date" v={input.generatedAt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} />
        <Text style={s.section}>AT A GLANCE</Text>
        <View style={s.tiles}>
          {[['APN', txt(subject.apn)], ['COUNTY', txt(subject.county)],
            ['BUILDING', sqft(subject.buildingArea)], ['YEAR BUILT', year(subject.yearBuilt)],
            ['COMPARABLES', String(filter.counts.shown)]].map(([l, v], i, a) => (
              <View key={l} style={[s.tile, i === a.length - 1 ? s.tileLast : {}]}>
                <Text style={s.tileLabel}>{l}</Text>
                {/* Long values (county names, APNs) drop a size rather than hyphenate. */}
                <Text style={v.length > 12 ? s.tileValueSm : s.tileValue}>{v}</Text>
              </View>
          ))}
        </View>
      </Shell>

      {/* 2 — property snapshot */}
      <Shell kicker="PROPERTY SNAPSHOT" page={2} total={TOTAL}>
        <Text style={s.section}>CHARACTERISTICS</Text>
        <KV k="Use" v={txt(subject.useDescription)} />
        <KV k="Bedrooms" v={numf(subject.beds)} />
        <KV k="Bathrooms" v={numf(subject.baths)} />
        <KV k="Building area" v={sqft(subject.buildingArea)} />
        {/* SiteX sends "6625 SF" as a label; normalise to the same shape as building area. */}
        <KV k="Lot size" v={sqft(subject.lotSize)} />
        <KV k="Year built" v={year(subject.yearBuilt)} />
        <Text style={s.section}>LAST RECORDED SALE</Text>
        {subject.lastSaleDate || subject.lastSalePrice ? (
          <>
            <KV k="Sale date" v={dt(subject.lastSaleDate)} />
            <KV k="Sale price" v={money(subject.lastSalePrice)} />
          </>
        ) : (
          <Absent
            what="Subject sale history"
            why="SiteX returned no sale or loan record for this parcel. No figure has been substituted from the comparable set."
          />
        )}
      </Shell>

      {/* 3 — ownership, legal, tax */}
      <Shell kicker="OWNERSHIP · LEGAL · TAX" page={3} total={TOTAL}>
        <Text style={s.section}>OWNERSHIP</Text>
        <KV k="Primary owner" v={txt(subject.primaryOwner)} />
        <Text style={s.section}>LEGAL</Text>
        <KV k="APN" v={txt(subject.apn)} />
        <KV k="FIPS" v={txt(subject.fips)} />
        <KV k="Brief description" v={txt(subject.legalDescription)} />
        <Text style={s.section}>ASSESSMENT & TAX</Text>
        <KV k="Tax year" v={year(tax.year)} />
        <KV k="Assessed value" v={money(tax.assessedValue)} />
        <KV k="Land value" v={money(tax.landValue)} />
        <KV k="Improvement value" v={money(tax.improvementValue)} />
        <KV k="Market value" v={money(tax.marketValue)} />
        <KV k="Tax amount" v={money(tax.taxAmount)} />
        <KV k="Status" v={txt(tax.status)} />
      </Shell>

      {/* 4 — transfer timeline */}
      <Shell kicker="TRANSFER HISTORY" page={4} total={TOTAL}>
        <Text style={s.section}>{`RECORDED TRANSACTIONS (${transfers.length})`}</Text>
        {transfers.length === 0 ? (
          <Absent what="Transfer history" why="SiteX returned no recorded transactions for this parcel." />
        ) : (
          <>
            <View style={s.row}>
              {[['RECORDED', 1.2], ['TYPE', 1.4], ['DOCUMENT TYPE', 2], ['DOC NUMBER', 1.4], ['BOOK/PAGE', 1], ['CURRENT', 0.8]].map(([h, f]) => (
                <Text key={String(h)} style={[s.th, { flex: f as number }]}>{h}</Text>
              ))}
            </View>
            {transfers.slice(0, 22).map((t) => (
              <View key={t.sourcePosition} style={s.row}>
                <Text style={[s.td, { flex: 1.2 }]}>{dt(t.recordingDate)}</Text>
                <Text style={[s.td, { flex: 1.4 }]}>{txt(t.transactionType)}</Text>
                <Text style={[s.td, { flex: 2 }]}>{txt(t.documentType)}</Text>
                <Text style={[s.td, { flex: 1.4 }]}>{txt(t.documentNumber)}</Text>
                <Text style={[s.td, { flex: 1 }]}>{t.bookNumber || t.pageNumber ? `${t.bookNumber ?? ''}/${t.pageNumber ?? ''}` : GAP}</Text>
                <Text style={[s.td, { flex: 0.8 }]}>{t.currentOwnerFlag ? 'Yes' : ''}</Text>
              </View>
            ))}
          </>
        )}
      </Shell>

      {/* 5 — market comparison */}
      <Shell kicker="MARKET COMPARISON" page={5} total={TOTAL}>
        <Text style={s.section}>{`BASED ON ${metrics.basedOnComps} SELECTED COMPARABLES`}</Text>
        <View style={s.tiles}>
          {[['MEDIAN SALE', money(metrics.medianSalePrice)],
            ['MEDIAN $/SF', metrics.medianPricePerSqft === null ? GAP : '$' + metrics.medianPricePerSqft.toFixed(0)],
            ['PRICE RANGE', metrics.priceRangeMin === null ? GAP : `${moneyShort(metrics.priceRangeMin)}–${moneyShort(metrics.priceRangeMax)}`],
            ['MEDIAN SF', numf(metrics.medianBuildingArea)],
            ['MEDIAN YEAR', year(metrics.medianYearBuilt)]].map(([l, v], i, a) => (
              <View key={l} style={[s.tile, i === a.length - 1 ? s.tileLast : {}]}>
                <Text style={s.tileLabel}>{l}</Text><Text style={s.tileValue}>{v}</Text>
              </View>
          ))}
        </View>
        <Text style={s.section}>SELECTED COMPARABLE SALE PRICES</Text>
        <PriceChart comps={comps} />
        {metrics.compsMissingPricePerSqft > 0 && (
          <Text style={[s.note, { marginTop: 8 }]}>
            {`${metrics.compsMissingPricePerSqft} of ${metrics.basedOnComps} selected comparables did not carry a price per square foot from the data provider; those are shown as ${GAP} rather than calculated.`}
          </Text>
        )}
      </Shell>

      {/* 6 — comparable detail */}
      <Shell kicker="COMPARABLE DETAIL" page={6} total={TOTAL}>
        <Text style={s.section}>{`${filter.counts.shown} COMPARABLES SHOWN`}</Text>
        {comps.length === 0 ? (
          <Absent
            what="Comparable sales"
            why="No comparable returned for this property satisfied the criteria on the following page. The criteria were not relaxed to produce a result."
          />
        ) : (
          <>
            <View style={s.row}>
              {[['#', 0.4], ['ADDRESS', 2.6], ['SOLD', 1.1], ['PRICE', 1.2], ['$/SF', 0.9], ['SF', 0.9], ['BD', 0.5], ['BA', 0.5], ['BUILT', 0.7], ['MILES', 0.7]].map(([h, f]) => (
                <Text key={String(h)} style={[s.th, { flex: f as number }]}>{h}</Text>
              ))}
            </View>
            {comps.map((c, i) => {
              const ppsf = pricePerSqft(c);
              return (
                <View key={c.sourcePosition} style={s.row}>
                  <Text style={[s.td, { flex: 0.4 }]}>{i + 1}</Text>
                  <Text style={[s.td, { flex: 2.6 }]}>{txt(c.address)}</Text>
                  <Text style={[s.td, { flex: 1.1 }]}>{dt(c.recordingDate)}</Text>
                  <Text style={[s.td, { flex: 1.2 }]}>{money(c.salePrice)}</Text>
                  <Text style={[s.td, { flex: 0.9 }]}>{ppsf === null ? GAP : '$' + ppsf.toFixed(0)}</Text>
                  <Text style={[s.td, { flex: 0.9 }]}>{numf(c.buildingArea)}</Text>
                  <Text style={[s.td, { flex: 0.5 }]}>{numf(c.bedrooms)}</Text>
                  <Text style={[s.td, { flex: 0.5 }]}>{numf(c.baths)}</Text>
                  <Text style={[s.td, { flex: 0.7 }]}>{year(c.yearBuilt)}</Text>
                  <Text style={[s.td, { flex: 0.7 }]}>{c.proximityMiles === null ? GAP : c.proximityMiles.toFixed(2)}</Text>
                </View>
              );
            })}
          </>
        )}
        <Text style={s.section}>COMPARABLE LOCATIONS</Text>
        {input.compMapImage
          // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf <Image> is a PDF primitive, not a DOM <img>; it has no alt prop
          ? <Image src={input.compMapImage} style={{ width: 515, height: 238 }} />
          : <Absent what="Comparable map" why="No map image was captured for this report." />}
      </Shell>

      {/* 7 — plat map */}
      <Shell kicker="PLAT MAP" page={7} total={TOTAL}>
        <Text style={s.section}>ASSESSOR PLAT MAP</Text>
        {input.platMapImage
          // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf <Image> is a PDF primitive, not a DOM <img>; it has no alt prop
          ? <Image src={input.platMapImage} style={{ width: 515, height: 620, objectFit: 'contain' }} />
          : (
            <Absent
              what="Plat map"
              why={input.platMapStatus && input.platMapStatus !== 'Available'
                ? `The data provider reported plat map status "${input.platMapStatus}" for this parcel.`
                : 'No plat map was supplied for this parcel.'}
            />
          )}
      </Shell>

      {/* 8 — methodology + rep footer */}
      <Shell kicker="METHODOLOGY" page={8} total={TOTAL}>
        <Text style={s.section}>CRITERIA OF SEARCH</Text>
        <Text style={[s.note, { marginBottom: 8 }]}>
          These are the criteria that were applied to select the comparables in this report. They are
          recorded at generation, not inferred from the results.
        </Text>
        <KV k="Same use code as subject" v={criteria.sameUseCode ? 'Yes' : 'No'} />
        <KV k="Living area tolerance" v={criteria.livingAreaPct === null ? 'Not applied' : `± ${criteria.livingAreaPct}%`} />
        <KV k="Bedrooms" v={criteria.bedDelta === null ? 'Not applied' : `± ${criteria.bedDelta}`} />
        <KV k="Bathrooms" v={criteria.bathDelta === null ? 'Not applied' : `± ${criteria.bathDelta}`} />
        <KV k="Search radius" v={criteria.radiusMiles === null ? 'Not applied' : miles(criteria.radiusMiles)} />
        <KV k="Sales within" v={criteria.months === null ? 'Not applied' : `${criteria.months} months`} />
        <KV k="Maximum shown" v={String(criteria.maxComps)} />

        <Text style={s.section}>WHAT THE SEARCH RETURNED</Text>
        <KV k="Comparables returned by provider" v={String(filter.counts.returned)} />
        <KV k="Met all criteria" v={String(filter.counts.qualified)} />
        <KV k="Shown in this report" v={String(filter.counts.shown)} />
        {filter.counts.shown < criteria.maxComps && (
          <Text style={[s.note, { marginTop: 8 }]}>
            {`Fewer than ${criteria.maxComps} comparables are shown because only ${filter.counts.qualified} of the ${filter.counts.returned} returned satisfied the criteria above. The criteria were not widened to reach a target count.`}
          </Text>
        )}
        {metrics.furthestSelectedMiles !== null && (
          <Text style={[s.note, { marginTop: 6 }]}>
            {`The furthest selected comparable is ${metrics.furthestSelectedMiles.toFixed(2)} miles from the subject. The search radius applied was ${miles(criteria.radiusMiles)}.`}
          </Text>
        )}

        <Text style={s.section}>PRESENTED BY</Text>
        <KV k="Name" v={txt(input.presentingRep?.name)} />
        <KV k="Title" v={txt(input.presentingRep?.title)} />
        <KV k="Email" v={txt(input.presentingRep?.email)} />
        <KV k="Phone" v={txt(input.presentingRep?.phone)} />
        <Text style={[s.note, { marginTop: 14 }]}>
          Property data supplied by SiteX (Black Knight). This report is provided for informational
          purposes and is not an appraisal or a commitment to insure.
        </Text>
      </Shell>
    </Document>
  );
}
