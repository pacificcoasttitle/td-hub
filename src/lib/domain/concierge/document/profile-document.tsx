import React from 'react';
import {
  Document, Page, Text, View, Image, StyleSheet, Font,
} from '@react-pdf/renderer';
import type { CompFilterResult, CompCriteria } from '../comp-filter';
import type { MarketMetrics } from '../metrics';
import type { NormalizedSubject, NormalizedTax, NormalizedTransfer } from '../normalize';
import {
  acres, compRange, currentVestingDeed, lotCoverage,
  parseLegal, parseOwners, resolveTaxLayer, taxShare, transferCounts,
} from './derive';
import type { NormalizedTaxReport, TaxLayer } from './derive';
import { PCT_LOGO_WHITE } from './brand-assets';

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
// ─── THE ESTIMATED VALUE IS GONE, NOT FLAGGED OFF ────────────────────────────
//
// v2 kept the valuation behind SHOW_ESTIMATED_VALUE = false. Gerard's ruling is
// to delete it: the profile reports details, it does not appraise. A constant
// left at false is a switch somebody flips without re-asking the compliance
// question, so there is no switch. Both sites are gone — page 1's midpoint and
// range, and the page 6 "How the range was built" panel.
//
// What remains is what the comparables did: the per-square-foot range, moved
// to the comparable summary where the rest of the market data lives. That is a
// statement about the market rather than about this house, which is the line
// the deletion is drawn on — not "no numbers", but "no conclusion about this
// property".
//
// The bar chart went with it. The page map has one comparable-summary page
// where v2 had two, and the chart was the half that carried the valuation
// panel; the medians and the per-sf range moved up, the chart did not.
//
// ─── PAGE 4 IS CONDITIONAL, SO PAGE NUMBERS ARE COMPUTED ─────────────────────
//
// With no tax record there is no tax page and the document is SEVEN pages, not
// eight with a blank. That means no page may hard-code its own number: `pageNo`
// below derives them, and TOTAL follows. A fixed `page={5}` would have printed
// "5 of 7" on the sixth sheet the first time a profile had no tax.
export const TEMPLATE_VERSION = 'v3';

/**
 * The Insurance Commissioner disclaimer for page 2.
 *
 * NOT WRITTEN HERE ON PURPOSE. The handoff calls for it by name but supplies
 * no wording, and it appears nowhere in the repo or in the design package.
 * Inventing regulatory language for a title insurance document is not a
 * drafting shortcut — a plausible-sounding disclaimer that is not the one the
 * Commissioner requires is worse than a visible gap, because it reads as
 * compliant.
 *
 * Until compliance supplies the text, page 2 prints a visible placeholder box
 * and `insurance-disclaimer.test.ts` fails. Replace the constant and the test
 * goes green; nothing else has to change.
 */
export const INSURANCE_DISCLAIMER: string | null = null;

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

  // The shared band on pages 2–8: address, city/APN, white mark. 124px tall,
  // which is the height the handoff specifies and the height the cover's own
  // band matches so the two read as one device.
  addressBand: { backgroundColor: NAVY, height: 124, paddingHorizontal: PAGE_H, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  bandAddress: { color: '#FFFFFF', fontSize: 16, fontFamily: 'Helvetica-Bold', letterSpacing: -0.3 },
  bandSub: { color: '#FFFFFF', fontSize: 9, marginTop: 5, opacity: 0.8 },

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
  /**
   * TitlePoint's tax report — page 4's first layer, when one has landed.
   *
   * Optional and absent today: the search is fired in the background after the
   * profile is delivered, and the profile re-renders free when it arrives. A
   * profile rendered before it lands shows layer 2 and says so.
   */
  taxReport?: NormalizedTaxReport | null;
  transfers: NormalizedTransfer[];
  filter: CompFilterResult;
  metrics: MarketMetrics;
  criteria: CompCriteria;
  /** Data URI for the comps map, if we snapshotted one. */
  compMapImage: string | null;
  /** Data URI for the plat map, already converted to PNG. */
  platMapImage: string | null;
  platMapStatus: string | null;
  /**
   * Data URI for the white PCT mark on the navy bands, and for the cover.
   *
   * Passed in rather than read from disk here, for the same reason the maps
   * are: a path resolved at render time behaves differently under `next dev`,
   * a Vercel function and vitest, and an <Image> whose src does not resolve
   * renders nothing instead of failing. The caller reads the file once where
   * the failure is visible.
   */
  brandLogo?: string | null;
  /** Cover photograph, identical on every profile. Band alone when absent. */
  brandPhoto?: string | null;
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

/**
 * The page order, fixed. `tax` is dropped when there is no tax layer.
 *
 * Named rather than numbered so a page cannot be renumbered by editing one
 * call site and forgetting another — `pageNo('transfers')` moves on its own
 * when the tax page appears or disappears.
 */
const PAGE_ORDER = ['cover', 'thanks', 'details', 'tax', 'transfers', 'compSummary', 'compDetail', 'plat'] as const;
export type PageKey = typeof PAGE_ORDER[number];

/** The pages this document will actually have, in order. */
export function pagesFor(hasTax: boolean): PageKey[] {
  return PAGE_ORDER.filter((p) => p !== 'tax' || hasTax);
}

/** 1-based number of a page, or null when it is not in this document. */
export function pageNo(key: PageKey, hasTax: boolean): number | null {
  const i = pagesFor(hasTax).indexOf(key);
  return i < 0 ? null : i + 1;
}

interface ShellProps {
  children: React.ReactNode;
  page: number;
  total: number;
  /** Pages 2–8 carry the address band. The cover does not — it has its own. */
  band?: { address: string; sub: string; logo: string | null } | null;
}

function Shell({ children, page, total, band }: ShellProps) {
  return (
    <Page size="LETTER" style={s.page}>
      {band ? (
        <View style={s.addressBand}>
          <View style={{ flex: 1, paddingRight: 16 }}>
            <Text style={s.bandAddress}>{band.address}</Text>
            <Text style={s.bandSub}>{band.sub}</Text>
          </View>
          {band.logo
            // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf <Image> is a PDF primitive
            ? <Image src={band.logo} style={{ width: 104, objectFit: 'contain' }} />
            /* No mark rather than a broken one. <Image> with an unresolvable
               src renders EMPTY rather than throwing, so a path that works
               locally and not on Vercel would ship a blank band nobody
               noticed — the brand text is the honest fallback. */
            : <Text style={s.brand}>PACIFIC COAST TITLE</Text>}
        </View>
      ) : (
        <View style={s.bar}>
          <Text style={s.brand}>PACIFIC COAST TITLE</Text>
          <Text style={s.barRight}>Property Profile</Text>
        </View>
      )}
      {children}
      <View style={s.footBar} fixed>
        <Text style={s.footText}>Pacific Coast Title Company · SiteX Title Profile_144 · Template {TEMPLATE_VERSION}</Text>
        <Text style={s.footText}>{`${page} of ${total}`}</Text>
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
 * Page 4. Only ever rendered when a layer exists — there is no empty state
 * here, because the empty state is the page not existing.
 *
 * PAYMENT STATUS IS NEVER PRINTED, on either layer. Not "delinquent", not
 * "paid", not "current". The field is read and stored; it does not render.
 * A courtesy profile can be requested by an agent about a property whose owner
 * never asked for it, and printing that person's tax delinquency discloses
 * financial hardship about a third party. Same reasoning excludes every
 * protected-characteristic exemption — only the homeowner's exemption may
 * appear, and never a category name.
 */
function TaxPage({ layer, subject, share, captured }: {
  layer: NonNullable<TaxLayer>;
  subject: NormalizedSubject;
  share: number | null;
  captured: Date | null;
}) {
  const county = subject.county ? `${subject.county} County` : null;

  if (layer.source === 'sitex') {
    const { tax, installments } = layer;
    return (
      <View style={s.body}>
        <Head
          title="Property tax"
          lede={`Assessment and annual tax for ${year(tax.year)}${county ? `, as recorded by ${county}` : ''}.`}
        />

        {/* THE MIDDLE LAYER SAYS SO. Without this a reader cannot tell why one
            profile shows instalments and bonds and another shows three
            figures — they would read the thinner page as a thinner property. */}
        <View style={[s.gapBox, { marginTop: 0, marginBottom: 16 }]}>
          <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold' }}>Assessment data only</Text>
          <Text style={{ fontSize: 8.5, color: MUTED, marginTop: 4, lineHeight: 1.5 }}>
            {`This page is built from the assessor's summary record${captured ? `, as of ${dtLong(captured)}` : ''}. The detailed tax report — instalment amounts, exemptions, special assessments and bonds — was not available for this parcel, so those sections are absent rather than estimated.`}
          </Text>
        </View>

        <Text style={s.eyebrow}>{`ASSESSMENT · ${year(tax.year)}`}</Text>
        <View style={s.tiles}>
          <Tile label="Total assessed" value={money(tax.assessedValue)} tone="navy" />
          <Tile label="Land" value={money(tax.landValue)} />
          <Tile label="Improvements" value={money(tax.improvementValue)} last />
        </View>

        <Text style={[s.eyebrow, { marginTop: 22 }]}>ANNUAL TAX</Text>
        {installments ? (
          <>
            <View style={{ flexDirection: 'row' }}>
              <Text style={[s.th, { flex: 1.1 }]}>Instalment</Text>
              <Text style={[s.th, { flex: 1, textAlign: 'right' }]}>Amount</Text>
              <Text style={[s.th, { flex: 1.4 }]}>Due</Text>
              {/* "Late after", not the county's own "Delinquent after".
                  The date is statutory and says nothing about this owner —
                  it is the same on every parcel in California — but the rule
                  against printing "delinquent" is absolute, and a reader
                  skimming a tax page does not parse a column header before
                  reading a word. The cost of the plainer label is nil. */}
              <Text style={[s.th, { flex: 1.6 }]}>Late after</Text>
            </View>
            {installments.map((it, i) => (
              <View key={it.label} style={i % 2 === 1 ? { flexDirection: 'row', backgroundColor: FILL } : { flexDirection: 'row' }}>
                <Text style={[s.tdB, { flex: 1.1 }]}>{it.label}</Text>
                <Text style={[s.tdB, { flex: 1, textAlign: 'right' }]}>{money(it.amount)}</Text>
                <Text style={[s.td, { flex: 1.4 }]}>{it.due}</Text>
                <Text style={[s.td, { flex: 1.6 }]}>{it.lateAfter}</Text>
              </View>
            ))}
            <View style={{ flexDirection: 'row', backgroundColor: '#E8EBEF' }}>
              <Text style={[s.tdB, { flex: 1.1 }]}>Annual total</Text>
              <Text style={[s.tdB, { flex: 1, textAlign: 'right' }]}>{money(tax.taxAmount)}</Text>
              <Text style={[s.td, { flex: 3, color: MUTED }]}>{`Tax year ${year(tax.year)}${county ? ` · ${county}` : ''}`}</Text>
            </View>
            <Text style={s.caveat}>
              The assessor&rsquo;s summary carries only an annual total, so each instalment shows half of it against
              California&rsquo;s statutory dates. The county&rsquo;s own instalment amounts may differ.
            </Text>
          </>
        ) : (
          <>
            <KV k="Annual tax" v={money(tax.taxAmount)} fill />
            {county ? <KV k="County" v={county} /> : null}
            <Text style={s.caveat}>
              Instalment dates are set by statute and differ by state, so only the annual amount is shown.
            </Text>
          </>
        )}

        <View style={[s.tiles, { marginTop: 18 }]}>
          <Tile label="Tax as share of assessed value" value={pct(share, 2)} />
          <Tile label="Assessed year" value={year(tax.year)} last />
        </View>
      </View>
    );
  }

  const r = layer.report;
  const exemption = typeof r.homeOwnerExemption === 'number' && r.homeOwnerExemption > 0 ? r.homeOwnerExemption : null;
  return (
    <View style={s.body}>
      <Head
        title="Property tax"
        lede={`${r.annualAmount ? `${money(r.annualAmount)} for ${year(r.taxYear)}` : `Tax year ${year(r.taxYear)}`}${county ? `, ${county}` : ''}${r.asOf ? ` · report run ${dt(r.asOf)}` : ''}.`}
      />

      <Text style={s.eyebrow}>{`ASSESSMENT · ${year(r.taxYear)}`}</Text>
      <View style={s.tiles}>
        <Tile label="Total assessed" value={money(r.assessedValue)} tone="navy" />
        <Tile label="Land" value={money(r.landValue)} />
        <Tile label="Improvements" value={money(r.improvementValue)} />
        <Tile label="Tax rate area" value={txt(r.taxRateArea)} last />
      </View>

      <Text style={[s.eyebrow, { marginTop: 22 }]}>INSTALMENTS</Text>
      {r.installments.length > 0 ? (
        <>
          <View style={{ flexDirection: 'row' }}>
            <Text style={[s.th, { flex: 1.1 }]}>Instalment</Text>
            <Text style={[s.th, { flex: 1, textAlign: 'right' }]}>Amount</Text>
            <Text style={[s.th, { flex: 2 }]}>Due</Text>
          </View>
          {r.installments.map((it, i) => (
            <View key={it.number} style={i % 2 === 1 ? { flexDirection: 'row', backgroundColor: FILL } : { flexDirection: 'row' }}>
              <Text style={[s.tdB, { flex: 1.1 }]}>{it.number}</Text>
              <Text style={[s.tdB, { flex: 1, textAlign: 'right' }]}>{money(it.amount)}</Text>
              <Text style={[s.td, { flex: 2 }]}>{dt(it.dueDate)}</Text>
              {/* it.status deliberately not rendered. See the note above.
                  Mutation-checked: adding <Text>{txt(it.status)}</Text> here
                  turns "is absent on the TitlePoint layer" red. */}
            </View>
          ))}
          <View style={{ flexDirection: 'row', backgroundColor: '#E8EBEF' }}>
            <Text style={[s.tdB, { flex: 1.1 }]}>Annual total</Text>
            <Text style={[s.tdB, { flex: 1, textAlign: 'right' }]}>{money(r.annualAmount)}</Text>
            <Text style={[s.td, { flex: 2, color: MUTED }]}>{`Tax year ${year(r.taxYear)}`}</Text>
          </View>
        </>
      ) : (
        <KV k="Annual tax" v={money(r.annualAmount)} fill />
      )}

      {exemption ? (
        <>
          <Text style={[s.eyebrow, { marginTop: 22 }]}>EXEMPTION</Text>
          {/* Homeowner's only, and never a category name. Every other exemption
              type discloses age, disability, veteran status or bereavement. */}
          <KV k="Homeowner's exemption" v={money(exemption)} fill />
        </>
      ) : null}

      <LineItems title="SPECIAL ASSESSMENTS" items={r.specialAssessments} />
      <LineItems title="BONDS" items={r.bonds} />
      <LineItems title="SUPPLEMENTAL BILLS" items={r.supplementals} />

      <View style={[s.tiles, { marginTop: 18 }]}>
        <Tile label="Tax as share of assessed value" value={pct(share, 2)} />
        <Tile label="Tax rate" value={r.taxRate !== null ? `${r.taxRate}%` : GAP} last />
      </View>

      <Text style={s.caveat}>
        {`Tax figures are the county's own, as reported${r.asOf ? ` on ${dt(r.asOf)}` : ''}. Amounts and due dates change; confirm current balances with the tax collector before relying on them.`}
      </Text>
    </View>
  );
}

/** A tax line-item block. Renders nothing at all when there is nothing. */
function LineItems({ title, items }: { title: string; items: { description: string | null; amount: number | null; maturityDate: string | null }[] }) {
  if (items.length === 0) return null;
  return (
    <>
      <Text style={[s.eyebrow, { marginTop: 22 }]}>{title}</Text>
      {items.map((it, i) => (
        <View key={i} style={i % 2 === 1 ? [s.kv, s.kvFill] : s.kv}>
          <Text style={s.kvKey}>
            {`${txt(it.description)}${it.maturityDate ? ` · matures ${dt(it.maturityDate)}` : ''}`}
          </Text>
          <Text style={s.kvVal}>{money(it.amount)}</Text>
        </View>
      ))}
    </>
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
  const captured = input.capturedAt ?? null;

  // Page 4 exists only if a layer does. Everything after it renumbers.
  const taxLayer = resolveTaxLayer(tax, state, input.taxReport ?? null);
  const hasTax = taxLayer !== null;
  const TOTAL = pagesFor(hasTax).length;
  const no = (k: PageKey) => pageNo(k, hasTax) ?? 0;

  const band = {
    address: txt(subject.siteAddress),
    sub: `${txt(subject.siteCityState)} · APN ${txt(subject.apn)}`,
    // Defaults to the inlined mark. A caller may override (a test passes null
    // to render the wordmark path), but nobody has to remember to supply it.
    logo: input.brandLogo === undefined ? PCT_LOGO_WHITE : input.brandLogo,
  };

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
      <Shell page={no('cover')} total={TOTAL}>
        {/* A FIXED height, not flexGrow. v2 grew this to fill the space left
            by the valuation block; with a real photograph in it the grow is
            unbounded and the cover spilled onto a second sheet — which the
            overflow guard only saw once the fixture carried a real image. */}
        <View style={{ height: 320, backgroundColor: '#EDE9E1', position: 'relative' }}>
          {/* The brand photograph, the same on every profile. Falls back to the
              comparables map, then to the navy band alone — which is why the
              band is drawn separately rather than being part of the image. */}
          {input.brandPhoto ?? input.compMapImage
            // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf <Image> is a PDF primitive, not a DOM <img>
            ? <Image src={(input.brandPhoto ?? input.compMapImage)!} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : null}
          {/* The address sits on a navy band over the map — or on the band
              alone when there is no map, which is why the band is not part of
              the image. */}
          <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: NAVY, opacity: (input.brandPhoto ?? input.compMapImage) ? 0.93 : 1, paddingHorizontal: PAGE_H, paddingVertical: 16 }}>
            <Text style={{ color: '#FFFFFF', fontSize: 25, fontFamily: 'Helvetica-Bold', letterSpacing: -0.5 }}>
              {txt(subject.siteAddress)}
            </Text>
            <Text style={{ color: '#FFFFFF', fontSize: 10.5, marginTop: 6, opacity: 0.85 }}>
              {`${txt(subject.siteCityState)} · APN ${txt(subject.apn)}`}
            </Text>
          </View>
        </View>

        {/* The cover states what the document is and who it is for. It makes
            no claim about the property — the valuation that used to sit here
            is deleted, not flagged off. */}
        <View style={[s.body, { paddingTop: 26 }]}>
          <Text style={{ fontSize: 8, letterSpacing: 1.4, color: MUTED }}>PACIFIC COAST TITLE</Text>
          <Text style={{ fontSize: 27, fontFamily: 'Helvetica-Bold', color: NAVY, letterSpacing: -0.5, marginTop: 8 }}>
            Concierge Property Profile
          </Text>
          <View style={{ height: 3, width: 54, backgroundColor: ORANGE, marginTop: 12 }} />
        </View>

        <View style={[s.body, { flexDirection: 'row', justifyContent: 'space-between', marginTop: 28, marginBottom: 6 }]}>
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

      {/* ── 2 · Thank you ────────────────────────────────────────────────── */}
      <Shell page={no('thanks')} total={TOTAL} band={band}>
        <View style={[s.body, { paddingTop: 30 }]}>
          <Text style={s.h1}>Thank you</Text>
          <Text style={[s.lede, { marginTop: 12 }]}>
            {`Thank you for the opportunity to prepare this profile${input.preparedFor?.name ? ` for ${input.preparedFor.name}` : ''}. `}
            It brings together the public record for this parcel — ownership, legal description, assessment,
            recorded documents and recent comparable sales in the surrounding area — in one place.
          </Text>
          <Text style={[s.lede, { marginTop: 12 }]}>
            Every figure here comes from the county record as supplied by our data providers, and is reproduced
            without adjustment. Where the record is silent the report says so rather than estimating. Nothing in
            it is an appraisal, a title commitment, or advice on value.
          </Text>
          <Text style={[s.lede, { marginTop: 12 }]}>
            If anything here raises a question, the best next step is to speak with the contact on the cover —
            a question about a specific document or a specific figure is usually answered quickly.
          </Text>

          <Text style={[s.eyebrow, { marginTop: 30 }]}>DISCLAIMER</Text>
          {INSURANCE_DISCLAIMER ? (
            <View style={{ backgroundColor: FILL, padding: 14 }}>
              <Text style={{ fontSize: 8.5, color: '#3C3A36', lineHeight: 1.6 }}>{INSURANCE_DISCLAIMER}</Text>
            </View>
          ) : (
            /* Visible on the page rather than silent. A missing disclaimer that
               shows up only in a test is a disclaimer that ships missing. */
            <View style={[s.gapBox, { borderColor: ORANGE }]}>
              <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#B4620B' }}>
                Insurance Commissioner disclaimer pending
              </Text>
              <Text style={{ fontSize: 8.5, color: MUTED, marginTop: 4, lineHeight: 1.5 }}>
                The required wording has not been supplied. This profile is not for external distribution until
                it is.
              </Text>
            </View>
          )}

          <View style={{ marginTop: 34, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <View>
              <View style={{ height: 1, width: 190, backgroundColor: BORDER }} />
              <Text style={{ fontSize: 10.5, fontFamily: 'Helvetica-Bold', marginTop: 7 }}>{txt(input.presentingRep?.name)}</Text>
              <Text style={{ fontSize: 9, color: MUTED, marginTop: 3 }}>{txt(input.presentingRep?.title)}</Text>
              <Text style={{ fontSize: 9, color: MUTED, marginTop: 3 }}>
                {[input.presentingRep?.email, input.presentingRep?.phone].filter(Boolean).join(' · ') || GAP}
              </Text>
            </View>
            <Text style={{ fontSize: 8.5, color: MUTED }}>{dtLong(input.generatedAt)}</Text>
          </View>
        </View>
      </Shell>

      {/* ── 3 · Property details ─────────────────────────────────────────── */}
      <Shell page={no('details')} total={TOTAL} band={band}>
        <View style={s.body}>
          <Head
            title="Property details"
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

          <Text style={[s.eyebrow, { marginTop: 22 }]}>VESTED OWNERS</Text>
          {owners.length > 0 ? (
            <View style={{ flexDirection: 'row' }}>
              {owners.slice(0, 3).map((o, i) => (
                <View key={i} style={[s.tile, ...(i === Math.min(owners.length, 3) - 1 ? [s.tileLast] : [])]}>
                  <Text style={{ fontSize: 12, fontFamily: 'Helvetica-Bold', letterSpacing: -0.2 }}>{o.display}</Text>
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

          {subject.lastSalePrice === null ? (
            <View style={s.callout}>
              <Text style={s.calloutTitle}>No subject sale on record</Text>
              <Text style={s.calloutBody}>
                {`SiteX supplied no sale price for this parcel, and nothing has been substituted in its place. The comparable sales are on pages ${no('compSummary')} to ${no('compDetail')}; the ownership record is on page ${no('transfers')}.`}
              </Text>
            </View>
          ) : (
            <>
              <Text style={[s.eyebrow, { marginTop: 22 }]}>LAST RECORDED SALE</Text>
              <View style={s.tiles}>
                <Tile label="Sale price" value={money(subject.lastSalePrice)} tone="navy" />
                <Tile label="Sale date" value={dt(subject.lastSaleDate)} />
                {/* SiteX's own rate. NOT price / building area — the payload
                    carries two building areas and the comps table already
                    records that recomputing this was the legacy bug. */}
                <Tile label="Price per sf" value={rate(subject.lastSalePricePerSqft)} last />
              </View>
              {subject.lastSalePricePerSqft === null ? (
                <Text style={s.caveat}>
                  The data provider supplied no rate per square foot for this sale. It is not calculated here,
                  because the payload carries more than one building area and the answer would depend on which
                  was used.
                </Text>
              ) : null}
            </>
          )}
        </View>
      </Shell>

      {/* ── 4 · Property tax ─────────────────────────────────────────────── */}
      {taxLayer ? (
        <Shell page={no('tax')} total={TOTAL} band={band}>
          <TaxPage layer={taxLayer} subject={subject} share={share} captured={captured} />
        </Shell>
      ) : null}

      {/* ── 5 · Transfer history ─────────────────────────────────────────── */}
      <Shell page={no('transfers')} total={TOTAL} band={band}>
        <View style={s.body}>
          <Head
            title="Transfer history"
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

      {/* ── 6 · Comparable summary ───────────────────────────────────────── */}
      <Shell page={no('compSummary')} total={TOTAL} band={band}>
        <View style={s.body}>
          <Head
            title="Comparable sales"
            lede={`${spell(n).charAt(0).toUpperCase() + spell(n).slice(1)} ${n === 1 ? 'sale' : 'sales'}${metrics.furthestSelectedMiles !== null ? `, all within ${metrics.furthestSelectedMiles} ${metrics.furthestSelectedMiles === 1 ? 'mile' : 'miles'}` : ''}. These are the same ${n === 1 ? 'sale' : 'sales'} detailed on page ${no('compDetail')}.`}
          />

          {/* The navy summary strip. One scope — these medians describe the
              selected sales below and nothing else. */}
          <View style={s.tiles}>
            <Tile label="Median sale" value={money(metrics.medianSalePrice)} tone="navy" />
            {/* The comparables' own per-sf range. This is a statement about
                the market, not about this house — which is why it survives
                the valuation deletion while the midpoint does not. */}
            <Tile label="Per sf range" value={range ? `${rate(range.minPerSqft)} – ${rate(range.maxPerSqft)}` : GAP} />
            <Tile label="Median per sf" value={rate(metrics.medianPricePerSqft)} />
            <Tile label="Median size" value={sqft(metrics.medianBuildingArea)} />
            <Tile label="Sold between" value={soldSpan} last />
          </View>

          <View style={{ marginTop: 14 }}>
            {input.compMapImage
              // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf <Image> is a PDF primitive, not a DOM <img>
              /* 250, and mutation-checked at 420: the overflow guard goes to
                 10 sheets against 8. Do not grow this without re-measuring. */
              ? <Image src={input.compMapImage} style={{ width: '100%', height: 250, objectFit: 'cover' }} />
              : <Absent what="Comparable map" why="No map image was captured for this profile." />}
          </View>

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
                no map claimed a provenance for something absent.
                And the rate is the VENDOR'S, not ours — saying we divide price
                by area describes a calculation this report does not perform,
                and one the comps table is annotated against. */}
            {`${captured && input.compMapImage ? `Map captured ${dtLong(captured)}. ` : ''}Price per sf is the data provider's own figure for each sale, not a calculation made here.${metrics.compsMissingPricePerSqft > 0 ? ` ${plural(metrics.compsMissingPricePerSqft, 'sale')} carried no rate from the vendor.` : ''}`}
          </Text>
        </View>
      </Shell>

      {/* ── 7 · Comparable sales, in detail ──────────────────────────────── */}
      <Shell page={no('compDetail')} total={TOTAL} band={band}>
        <View style={s.body}>
          <Head
            title={`The ${spell(n)} ${n === 1 ? 'sale' : 'sales'} in detail`}
            lede={`The same ${n === 1 ? 'sale' : 'sales'} as page ${no('compSummary')}, with each one's own figures.`}
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
      <Shell page={no('plat')} total={TOTAL} band={band}>
        <View style={s.body}>
          <Head title="Parcel map and sources" lede="Where every figure in this report came from." />
          {input.platMapImage
            // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf <Image> is a PDF primitive, not a DOM <img>
            ? <Image src={input.platMapImage} style={{ width: '100%', height: 300, objectFit: 'contain' }} />
            : <Absent what="Parcel map" why={input.platMapStatus ? `The county plat map could not be attached: ${input.platMapStatus}.` : 'No plat map was available for this parcel.'} />}

          {/* The criteria boxes live here rather than on the summary page.
              They were on the summary page first and it rendered NINE sheets
              on the real payload: navy strip + 250px map + a four-row table +
              criteria + caveat does not fit under a 124px band. The summary
              page has to hold a table whose length is not fixed, so the
              fixed-size blocks belong on the page that has room. */}
          <Text style={[s.eyebrow, { marginTop: 20 }]}>COMPARABLE CRITERIA, AS APPLIED</Text>
          <View style={s.tiles}>
            <Tile label="Radius" value={metrics.appliedRadiusMiles !== null ? miles(metrics.appliedRadiusMiles) : GAP} />
            <Tile label="Sold within" value={criteria.months !== null ? plural(criteria.months, 'month') : GAP} />
            <Tile label="Size tolerance" value={criteria.livingAreaPct !== null ? `±${criteria.livingAreaPct}%` : GAP} />
            <Tile label="Shown of qualifying" value={`${n} of ${filter.counts.qualified}`} last />
          </View>
          <Text style={s.caveat}>
            {`${filter.counts.returned} candidate ${filter.counts.returned === 1 ? 'sale was' : 'sales were'} returned; ${filter.counts.qualified} passed every rule and ${n} ${n === 1 ? 'is' : 'are'} shown on page ${no('compSummary')}. The maximum is a ceiling, not a quota — a profile with fewer qualifying sales shows fewer, and none are added to reach a count.`}
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
