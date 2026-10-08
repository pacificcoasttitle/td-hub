import React from 'react';
import { Document, Font, Image, Page, Text, View } from '@react-pdf/renderer';
import type { CompFilterResult, CompCriteria } from '../comp-filter';
import type { MarketMetrics } from '../metrics';
import type { NormalizedSubject, NormalizedTax, NormalizedTransfer } from '../normalize';
import {
  acres, currentVestingDeed, melloRoosDisclosure, parseLegal, parseOwners, resolveTaxLayer, transferCounts,
} from './derive';
import type { MelloRoosDisclosure, NormalizedTaxReport, TaxLayer } from './derive';
import { PCT_COVER_PHOTO, PCT_LOGO_WHITE } from './brand-assets';
import { BODY, HEADING, registerDocumentFonts } from './fonts';
import {
  Band, DASH_NOTE, Footer, Footnote, InstallmentBox, NavyStrip, Row, Row4, SectionBar, StatBox, Swatch,
  BORDER, BOX_BG, COVER_FALLBACK, FORECLOSURE_BG, GAP, INK, MEDIAN_FILL,
  LABEL_W, MUTED, NAVY, ORANGE, PLAT_BG, PREPARED_LABEL, SIDE, TYPE_COLOUR, s, type TypeKey,
} from './parts';

// ─── The Concierge Property Profile ──────────────────────────────────────────
//
// design: Concierge v6 (docs/ui-proofs/v6/Concierge-v6-BUILD-CORRECTIONS.pdf,
// 29 Sep 2026). Eight pages, letter, page 4 conditional.
//
// REBUILT FROM v6, NOT RESTYLED FROM v3. The previous build kept v3's parts —
// Head title + lede sentence, grey-filled KV rows, Tile grids, Absent boxes and
// a navy footer bar — and gave them v6's fonts. v6 has none of those parts; the
// six in parts.tsx replace them entirely.
//
// EVERY v6 NUMBER IS × 0.75. v6 is 816 px wide and a letter PDF is 612 pt.
// Using the pixel values directly is why the last build came out a third too
// big, and why the comp map at 250 pt — it should be 187.5 — overflowed page 6
// and pushed the criteria onto page 8.
//
// THE DATA LOGIC IS UNCHANGED: derive.ts, resolveTaxLayer, pagesFor/pageNo, the
// status masking and the homeowner's-only exemption. This was a layout fault.
//
// RULES THE LAYOUT ENFORCES:
//
//   1. ONE SCOPE. The table, the strip and the map all iterate
//      `filter.selected`.
//   2. GAPS ARE RENDERED, NEVER FILLED. An absent value prints an em dash in
//      #8A94A3, and one footnote per page says what that means.
//   3. ONE FOOTNOTE PER PAGE — not explainer boxes. v3 had four of them.
//   4. ORANGE MEANS FORECLOSURE, plus the row labels. Navy marks vesting.
//
// PAYMENT STATUS NEVER RENDERS, on either tax layer. Not "delinquent", not
// "paid", not "current", and there is no "late after" column — v6 itself showed
// PAID badges on the instalments and they were removed from v6 as well as here.
// A courtesy profile can be requested by an agent about a property whose owner
// never asked for it.

registerDocumentFonts();

/**
 * The family's palette, re-exported.
 *
 * The three farming documents import these FROM HERE (reports/document/family.tsx),
 * which is what makes the four artefacts one family rather than approximately
 * one. The tokens live in parts.tsx now; this keeps that import path working.
 */
export { NAVY, ORANGE, MUTED, BORDER, TINT, GAP } from './parts';

/**
 * Disable hyphenation document-wide. react-pdf hyphenates by default, which
 * turned "LOS ANGELES" into "LOS ANGE-LES". The values here are proper nouns,
 * addresses and identifiers.
 */
Font.registerHyphenationCallback((word) => [word]);

// Defined in template-version.ts, which imports nothing, so a client
// component can read it without pulling this module — and @react-pdf,
// node:fs and 670 KB of inlined base64 — into the browser bundle.
export { TEMPLATE_VERSION } from './template-version';

/**
 * The Insurance Commissioner disclaimer, from Pacific Coast Title's own legacy
 * property profile (1358 5th St, page 2) — the wording v6 reproduces.
 *
 * IT WAS NEVER MISSING. The previous build printed "Insurance Commissioner
 * disclaimer pending / not for external distribution" on customer PDFs while
 * this text sat on the legacy document all along.
 *
 * Two paragraphs, verbatim. Do not paraphrase: the first states conformance
 * with the Commissioner's rules and the second limits what the report asserts,
 * and together they are why the document can go to a customer at all.
 */
export const INSURANCE_DISCLAIMER: readonly string[] = [
  'This title information has been furnished by Pacific Coast Title Company in conformance with the rules established by the California Insurance Commissioner.',
  'This information is provided as an accommodation only. The information contained herein is not a complete statement or representation of the status of title to the property in question and no assurances are made or liability assumed as to the accuracy thereof.',
];

/** The thank-you paragraph that precedes the disclaimer on page 2. */
export const THANK_YOU_OPENING =
  'We know you have many choices when it comes to title companies, and we thank you for choosing Pacific Coast Title Company.';

const SECTION_GAP_PT = 15;
const BODY_TOP_PT = 19.5;

// ─── Page order ─────────────────────────────────────────────────────────────

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

// ─── Formatting ─────────────────────────────────────────────────────────────

// Exported as a group so the rules are unit-testable, and because
// carrier-route-document reads moneyShort from here.
export const fmt = {
  money: (n: number | null | undefined) => money(n),
  year: (n: number | null | undefined) => year(n),
  sqft: (n: number | null | undefined) => sqft(n),
  rate: (n: number | null | undefined) => rate(n),
  numf: (n: number | null | undefined, sfx?: string) => numf(n, sfx),
  miles: (n: number | null | undefined) => miles(n),
  moneyShort: (n: number | null | undefined) => moneyShort(n),
};

const money = (n: number | null | undefined) => (typeof n === 'number' && n > 0 ? '$' + Math.round(n).toLocaleString('en-US') : GAP);
const numf = (n: number | null | undefined, suffix = '') => (typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('en-US') + suffix : GAP);
/** Years are labels, not quantities — 1948, never "1,948". */
const year = (n: number | null | undefined) => (typeof n === 'number' && Number.isFinite(n) ? String(Math.round(n)) : GAP);
const sqft = (n: number | null | undefined) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') + ' sf' : GAP);
/** A rate, always whole dollars. */
const rate = (n: number | null | undefined) => (typeof n === 'number' && n > 0 ? '$' + Math.round(n) : GAP);
const miles = (n: number | null | undefined) => {
  if (typeof n !== 'number' || !Number.isFinite(n)) return GAP;
  return `${n} ${n === 1 ? 'mile' : 'miles'}`;
};
/** Compact money for tight cells: $835k rather than $835,000. */
const moneyShort = (n: number | null | undefined) => {
  if (typeof n !== 'number' || n <= 0) return GAP;
  if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1) + 'M';
  if (n >= 1_000) return '$' + Math.round(n / 1000) + 'k';
  return '$' + Math.round(n);
};
const txt = (v: string | null | undefined) => (v && v.trim() ? v.trim() : GAP);
const dt = (iso: string | null | undefined) => {
  if (!iso) return GAP;
  const d = new Date(iso + 'T00:00:00Z');
  return Number.isNaN(d.getTime()) ? GAP
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
};
const dtLong = (d: Date) => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/**
 * PRICE PER SQUARE FOOT = sale price ÷ living area.
 *
 * v6 asks for it calculated, for the subject and for every comparable, and it
 * is Gerard's document. `concierge_comps.price_per_sqft` carried the opposite
 * instruction; that annotation is corrected at the column rather than left to
 * contradict this.
 *
 * LIVING AREA MEANS `buildingArea`, AND NAMING THE CHOICE IS THE POINT. The
 * payload carries two: PropertyCharacteristics.BuildingArea (786 on profile 4)
 * and Neighborhood[].BuildingArea (793). The first is the assessor's record for
 * THIS parcel; the second belongs to a neighbourhood summary and is not about
 * this house. Everything else on the page — the square-feet row, the comp
 * table — already prints PropertyCharacteristics, so dividing by anything else
 * would make the rate disagree with the area beside it.
 */
export function pricePerSqft(price: number | null | undefined, livingArea: number | null | undefined): number | null {
  if (typeof price !== 'number' || typeof livingArea !== 'number') return null;
  if (price <= 0 || livingArea <= 0) return null;
  return price / livingArea;
}

/** Which colour a recorded document takes. Orange is foreclosure only. */
export function typeOf(t: { documentType: string | null; transactionType: string | null; isForeclosure: boolean | null }): TypeKey {
  if (t.isForeclosure === true) return 'foreclosure';
  const v = `${t.documentType ?? ''} ${t.transactionType ?? ''}`.toLowerCase();
  if (/release|reconvey|assign|satisf/.test(v)) return 'release';
  if (/mortgage|deed of trust|loan|lien/.test(v)) return 'mortgage';
  return 'deed';
}

export interface ProfileDocumentInput {
  subject: NormalizedSubject;
  tax: NormalizedTax;
  taxReport?: NormalizedTaxReport | null;
  transfers: NormalizedTransfer[];
  filter: CompFilterResult;
  metrics: MarketMetrics;
  criteria: CompCriteria;
  compMapImage: string | null;
  platMapImage: string | null;
  platMapStatus: string | null;
  /** The cover photograph, identical on every profile. Never the comp map. */
  brandPhoto?: string | null;
  brandLogo?: string | null;
  preparedFor: { name: string | null; company: string | null } | null;
  presentingRep: { name: string | null; email: string | null; phone: string | null; title: string | null } | null;
  generatedAt: Date;
  capturedAt?: Date | null;
  sitexSearchId?: number | null;
}

type Sel = ProfileDocumentInput['filter']['selected'][number]
  & Partial<{ address: string | null; city: string | null; state: string | null; zip: string | null }>;

interface BandProps { address: string; sub: string; logo: string | null }

/**
 * Band, body, footer. Pages 3, 5 and 7 are exactly this.
 *
 * DECLARED AT MODULE SCOPE. A component created inside render is a new type on
 * every render, which resets state and which the linter rejects outright.
 */
/**
 * ─── THE BAND REPEATS ON EVERY SHEET ────────────────────────────────────────
 *
 * A section that overflows used to continue onto a bare sheet: no navy band, no
 * address, no section title. Gemma's comps 10–12 were three rows alone on a
 * page, and Amethyst's 32 transfers ran off the bottom into nothing. Anyone
 * flipping to that sheet had no way to tell which property or which section
 * they were looking at.
 *
 * Round one specified this for transfers — "let the table break to a
 * continuation page with the band repeated" — and it was never applied. It
 * belongs on every section that can break, which is why it lives in Sheet
 * rather than in any one of them.
 *
 * `fixed` is the whole change: react-pdf re-renders a fixed element on each
 * sheet a Page generates, and it still occupies its space on each — so the body
 * needs no extra padding to stay clear of it, and adding some put 93pt of air
 * under every header. Measured at both commits on profile 15; see parts.tsx for
 * the arithmetic and for how the first measurement managed to miss it.
 *
 * AND IT IS ALSO WHAT UNSTRANDED THE FOOTNOTE. Gemma's tax footnote sat alone
 * on p5. The first fix attributed that to a `minPresenceAhead` on Footnote and
 * that attribution was wrong: removing the property changes nothing, while
 * reverting this one word brings p5 back — measured both ways, in the test and
 * against the real profile. Changing how the band occupies the sheet changed
 * where the break falls.
 *
 * So this word is load-bearing for two defects, and two tests fail without it:
 * one finds the sheets with no band, the other finds body text drawn in the
 * band's strip.
 */
function Sheet({ band, children }: { band: BandProps; children: React.ReactNode }) {
  return (
    <Page size="LETTER" style={s.page}>
      <Band address={band.address} sub={band.sub} logo={band.logo} fixed />
      <View style={s.body}>{children}</View>
      <Footer />
    </Page>
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
  const ac = acres(subject.lotSize);
  const state = (subject.siteCityState ?? '').match(/,\s*([A-Z]{2})\b/)?.[1] ?? null;
  const captured = input.capturedAt ?? null;

  const taxLayer = resolveTaxLayer(tax, state, input.taxReport ?? null);
  const hasTax = taxLayer !== null;
  // pagesFor()/pageNo() no longer number the footer — react-pdf does, from the
  // real sheets. They are kept as the statement of WHICH SECTIONS this document
  // has, which is a different question and still a true one: hasTax decides
  // whether page 4 exists at all. What they can no longer do is claim to know
  // how many sheets that becomes.

  // Both brand assets default here rather than at a caller, because no caller
  // passes either — render.ts and generate.ts build the input and never
  // mention them. `undefined` means "use the brand asset"; an explicit `null`
  // means "render without it", which is what the cover-fallback test needs.
  const logo = input.brandLogo === undefined ? PCT_LOGO_WHITE : input.brandLogo;
  const coverPhoto = input.brandPhoto === undefined ? PCT_COVER_PHOTO : input.brandPhoto;
  const band: BandProps = {
    address: txt(subject.siteAddress),
    sub: `${txt(subject.siteCityState)} · APN ${txt(subject.apn)}`,
    logo,
  };

  const subjectRate = pricePerSqft(subject.lastSalePrice, subject.buildingArea);

  /** Every recorded document, newest first. Page 5 prints all of them. */
  const sorted = [...transfers].sort((a, b) => (b.recordingDate ?? '').localeCompare(a.recordingDate ?? ''));

  /**
   * The transfer page 3 describes — and ALL FOUR of its fields must be one
   * event.
   *
   * Taking `sorted[0]` gave profile 4 a February 2024 MORTGAGE's document
   * number and type beside a December 2015 sale date and price, which reads as
   * one transaction and is two. The row is headed "most recent transfer" and
   * carries a sale amount, so it wants the most recent transfer OF OWNERSHIP:
   * the document the subject's last sale was recorded under.
   *
   * Matched on the recording date, then the current-vesting deed, then nothing
   * — the number and type print a gap rather than borrowing from another row.
   */
  const saleDoc = (subject.lastSaleDate
    ? sorted.find((t) => t.recordingDate === subject.lastSaleDate && typeOf(t) === 'deed')
      ?? sorted.find((t) => t.recordingDate === subject.lastSaleDate)
    : undefined) ?? vesting ?? null;

  return (
    <Document>
      {/* ── 1 · Cover ────────────────────────────────────────────────────── */}
      <Page size="LETTER" style={s.page}>
        <View style={{ height: 471, backgroundColor: COVER_FALLBACK, position: 'relative' }}>
          {/* NEVER the comp map. A map of other people's sales is not this
              property, and v6 asks for a brand photograph or nothing. */}
          {coverPhoto
            // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf <Image> is a PDF primitive
            ? <Image src={coverPhoto} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : null}
          {/* THE PHOTO IS FADED, NOT THE LOGO SWAPPED.
              The white mark disappeared against bright sky, and the 29 Sep fix
              was to use the dark wordmark. v6 solves it the other way: darken
              the top of the photograph so the white mark reads, which keeps one
              logo everywhere. That call was made without this on the table.
              react-pdf has no CSS gradient on a View, so it is an <Svg> with a
              <LinearGradient>, absolutely positioned over the photo. */}
          {/* No runtime fade element: the navy-to-transparent gradient over the
              top 90 pt is composited into PCT_COVER_PHOTO by
              scripts/build/embed-brand-assets.ts. react-pdf cannot draw it —
              its gradient stops carry no alpha, and a stack of opacity Views
              seams into visible stripes. Both were measured off the rendered
              page before this was chosen. */}
          {logo
            // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf <Image> is a PDF primitive
            ? <Image src={logo} style={{ position: 'absolute', top: 22.5, right: SIDE, height: 23, objectFit: 'contain' }} />
            : null}
        </View>

        {/* The navy block overlaps the photo by 72. */}
        {/* CENTRED VERTICALLY, not top-padded. The build pinned the three
            lines to a 29 pt top pad inside a 241.5 pt block, which left the
            lower two-thirds empty. v6 centres them. */}
        {/* FULL BLEED. The spec said 560pt and the page is 612, which left
            52 points of photograph showing down the right edge of both navy
            blocks — read on the proof as the block "stopping short". The
            blocks are meant to run off the edge, so they run off the edge.
            SIDE padding keeps the text where it was. */}
        <View style={{ marginTop: -72, width: '100%', height: 241.5, backgroundColor: NAVY, justifyContent: 'center', paddingHorizontal: SIDE }}>
          <Text style={{ fontFamily: HEADING, fontWeight: 700, fontSize: 11.25, color: ORANGE, letterSpacing: 2 }}>
            CONCIERGE PROPERTY PROFILE
          </Text>
          <Text style={{ fontFamily: HEADING, fontWeight: 900, fontSize: 30, color: '#FFFFFF', marginTop: 12, letterSpacing: -0.45, lineHeight: 1.08 }}>
            {txt(subject.siteAddress)}
          </Text>
          <Text style={{ fontFamily: HEADING, fontWeight: 600, fontSize: 18.75, color: '#FFFFFF', opacity: 0.82, marginTop: 7.5 }}>
            {txt(subject.siteCityState)}
          </Text>
        </View>

        {/* ONE LINE under each name, at full white. The build stacked email
            and phone as separate lines at 75% opacity; v6 joins them with
            " · " and keeps them white. Columns centre vertically in whatever
            height is left, with a 30 pt gap — marginRight, never flex gap. */}
        {/* NAVY, the same fill as the address block above — one cover, one
            colour. This was COVER_PANEL (#222A48), lighter and slightly more
            purple, and the seam showed. */}
        <View style={{ width: '100%', flexGrow: 1, backgroundColor: NAVY, paddingHorizontal: SIDE, flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1, marginRight: 30 }}>
            <Text style={{ fontFamily: BODY, fontWeight: 700, fontSize: 8.25, color: PREPARED_LABEL, letterSpacing: 1 }}>PREPARED FOR</Text>
            <Text style={{ fontFamily: BODY, fontWeight: 700, fontSize: 14.25, color: '#FFFFFF', marginTop: 7 }}>
              {txt(input.preparedFor?.name)}
            </Text>
            {input.preparedFor?.company
              ? <Text style={{ fontFamily: BODY, fontWeight: 500, fontSize: 10.5, color: '#FFFFFF', marginTop: 4 }}>{input.preparedFor.company}</Text>
              : null}
            <Text style={{ fontFamily: BODY, fontWeight: 500, fontSize: 10.5, color: '#FFFFFF', marginTop: 4 }}>
              {dtLong(input.generatedAt)}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: BODY, fontWeight: 700, fontSize: 8.25, color: PREPARED_LABEL, letterSpacing: 1 }}>PRESENTED BY</Text>
            <Text style={{ fontFamily: BODY, fontWeight: 700, fontSize: 14.25, color: '#FFFFFF', marginTop: 7 }}>
              {txt(input.presentingRep?.name)}
            </Text>
            <Text style={{ fontFamily: BODY, fontWeight: 500, fontSize: 10.5, color: '#FFFFFF', marginTop: 4 }}>
              {[input.presentingRep?.email, input.presentingRep?.phone].filter(Boolean).join(' · ') || GAP}
            </Text>
          </View>
        </View>
      </Page>

      {/* ── 2 · Thank you ────────────────────────────────────────────────── */}
      <Page size="LETTER" style={s.page}>
        <Band address={band.address} sub={band.sub} logo={band.logo} />
        <View style={{ paddingHorizontal: SIDE, paddingTop: 67.5, flexGrow: 1 }}>
          <View style={{ maxWidth: 420 }}>
            <Text style={{ fontFamily: HEADING, fontWeight: 800, fontSize: 22.5, color: NAVY }}>Thank you</Text>
            <View style={{ width: 36, height: 2.25, backgroundColor: ORANGE, marginTop: 13.5, marginBottom: 22.5 }} />

            <Text style={{ fontFamily: BODY, fontWeight: 500, fontSize: 11.25, lineHeight: 1.7, color: INK }}>
              {THANK_YOU_OPENING}
            </Text>
            {INSURANCE_DISCLAIMER.map((para) => (
              <Text key={para.slice(0, 24)} style={{ fontFamily: BODY, fontWeight: 500, fontSize: 11.25, lineHeight: 1.7, color: INK, marginTop: 13.5 }}>
                {para}
              </Text>
            ))}

            <Text style={{ fontFamily: BODY, fontWeight: 500, fontSize: 11.25, color: MUTED, marginTop: 27 }}>
              On behalf of Pacific Coast Title Company,
            </Text>
            <Text style={{ fontFamily: BODY, fontWeight: 700, fontSize: 13.5, color: NAVY, marginTop: 10.5 }}>
              {txt(input.presentingRep?.name)}
            </Text>
            {input.presentingRep?.email
              ? <Text style={{ fontFamily: BODY, fontWeight: 500, fontSize: 10.5, color: MUTED, marginTop: 4 }}>{input.presentingRep.email}</Text>
              : null}
            {input.presentingRep?.phone
              ? <Text style={{ fontFamily: BODY, fontWeight: 500, fontSize: 10.5, color: MUTED, marginTop: 3 }}>{input.presentingRep.phone}</Text>
              : null}
          </View>
        </View>
        <Footer />
      </Page>

      {/* ── 3 · Details ──────────────────────────────────────────────────── */}
      <Sheet band={band}>
        <SectionBar>OWNER, ADDRESS &amp; LEGAL DESCRIPTION</SectionBar>
        <Row label="Primary owner" value={owners[0]?.display ?? null} />
        <Row label="Secondary owner" value={owners[1]?.display ?? null} />
        <Row label="Site address" value={[subject.siteAddress, subject.siteCityState].filter(Boolean).join(', ')} />
        <Row label="Mailing address" value={subject.mailAddressFull} />
        <Row4 label="APN" value={subject.apn} label2="County" value2={subject.county} />
        <Row4 label="Tract" value={subject.tractNumber ?? legal?.tract ?? null} label2="Lot" value2={subject.lotNumber ?? legal?.lot ?? null} />
        {/* Feed 100001 has no page-grid field; that one is a gap by design. */}
        <Row4 label="Census tract" value={subject.censusTract} label2="Page grid" value2={null} />
        <Row label="Brief legal" value={subject.legalDescription} />

        <SectionBar marginTop={SECTION_GAP_PT}>BEDS, BATHS &amp; SQUARE FOOTAGE</SectionBar>
        <Row4 label="Beds" value={numf(subject.beds)} label2="Year built" value2={year(subject.yearBuilt)} />
        <Row4 label="Baths" value={numf(subject.baths)} label2="Square feet" value2={sqft(subject.buildingArea)} />
        <Row4 label="Garage" value={subject.garage} label2="Lot size" value2={ac ? `${sqft(subject.lotSize)} · ${ac.toFixed(2)} ac` : sqft(subject.lotSize)} />
        <Row4 label="Pool" value={subject.pool} label2="Zoning" value2={subject.zoning} />
        <Row label="Property type" value={subject.useDescription} />

        <SectionBar marginTop={SECTION_GAP_PT}>MOST RECENT TRANSFER</SectionBar>
        <Row4 label="Recording date" value={dt(subject.lastSaleDate ?? saleDoc?.recordingDate ?? null)} label2="Document #" value2={saleDoc?.documentNumber ?? null} />
        {/* TWO ROWS, not three. The build added Price per sq ft / Living area,
            which is not in v6 and repeated the square footage printed in the
            section directly above. The rate rides on the sale amount instead —
            "$369,000 · $469/sq ft" — where it describes the thing it is
            derived from. */}
        <Row4
          label="Sale amount"
          value={subjectRate !== null && subject.lastSalePrice !== null
            ? `${money(subject.lastSalePrice)} · ${rate(subjectRate)}/sq ft`
            : money(subject.lastSalePrice)}
          label2="Document type"
          value2={saleDoc?.documentType ?? saleDoc?.transactionType ?? null}
        />

        <Footnote>{`${DASH_NOTE} Price per sq ft is the sale price divided by living area.`}</Footnote>
      </Sheet>

      {/* ── 4 · Property tax ─────────────────────────────────────────────── */}
      {taxLayer ? (
        <Sheet band={band}>
          <TaxPage layer={taxLayer} subject={subject} captured={captured} />
        </Sheet>
      ) : null}

      {/* ── 5 · Transfer history ─────────────────────────────────────────── */}
      <Sheet band={band}>
        <SectionBar>TRANSFER HISTORY</SectionBar>

        {vesting ? (
          <View style={{ backgroundColor: NAVY, padding: 13.5, marginTop: 9, flexDirection: 'row', justifyContent: 'space-between' }}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={{ fontFamily: BODY, fontWeight: 700, fontSize: 8.25, color: ORANGE, letterSpacing: 1 }}>CURRENT VESTING</Text>
              <Text style={{ fontFamily: HEADING, fontWeight: 700, fontSize: 12.75, color: '#FFFFFF', marginTop: 6 }}>
                {owners.map((o) => o.display).join(' & ') || GAP}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ fontFamily: BODY, fontWeight: 700, fontSize: 11.25, color: '#FFFFFF' }}>
                {`${txt(vesting.documentType ?? vesting.transactionType)} · ${dt(vesting.recordingDate)}`}
              </Text>
              <Text style={{ fontFamily: BODY, fontWeight: 500, fontSize: 9, color: '#FFFFFF', opacity: 0.75, marginTop: 4 }}>
                {`Document # ${vesting.documentNumber ?? GAP}${heldYears(vesting.recordingDate, input.generatedAt)}`}
              </Text>
            </View>
          </View>
        ) : null}

        <View style={{ flexDirection: 'row', marginTop: 12 }}>
          <StatBox number={String(counts.deeds)} label="Deeds" tone={TYPE_COLOUR.deed} />
          <StatBox number={String(counts.mortgages)} label="Mortgages" tone={TYPE_COLOUR.mortgage} />
          <StatBox number={String(counts.releasesAndAssignments)} label="Releases & assignments" tone={TYPE_COLOUR.release} />
          <StatBox number={String(counts.foreclosure)} label="Foreclosure-related" tone={TYPE_COLOUR.foreclosure} last />
        </View>

        <View style={{ flexDirection: 'row', borderBottomWidth: 1.5, borderBottomColor: NAVY, paddingBottom: 4.5, marginTop: 13.5 }}>
          <Text style={[s.th, { flex: 1.4 }]}>RECORDED</Text>
          <Text style={[s.th, { flex: 1.5 }]}>DOCUMENT #</Text>
          <Text style={[s.th, { flex: 2.2 }]}>TYPE</Text>
          {/* NOT "PRICE". The column holds a sale price on a deed and a loan on
              a mortgage, and they are not the same quantity — a heading that
              implied they were would make a $583,942 loan read as a sale. Each
              figure says which it is on the row itself. */}
          <Text style={[s.th, { flex: 1.3, textAlign: 'right' }]}>AMOUNT</Text>
          <Text style={[s.th, { flex: 1.1 }]}> </Text>
        </View>
        {sorted.map((t) => {
          const kind = typeOf(t);
          const isVesting = vesting !== null && t.sourcePosition === vesting.sourcePosition;
          const bg = kind === 'foreclosure' ? FORECLOSURE_BG : isVesting ? MEDIAN_FILL : undefined;
          // The parties, when the record names any. A deed's buyer and seller,
          // a mortgage's borrower and lender — labelled per row rather than in
          // the header, because the header cannot be right for both.
          const toLabel = kind === 'deed' ? 'Buyer' : 'Borrower';
          const fromLabel = kind === 'deed' ? 'Seller' : 'Lender';
          const parties = [
            t.partyTo ? `${toLabel}: ${t.partyTo}` : null,
            t.partyFrom ? `${fromLabel}: ${t.partyFrom}` : null,
          ].filter(Boolean).join('   ');

          return (
            // wrap={false} so a transfer is never read across a fold: its date
            // and document number on one sheet and its parties on the next
            // would be two half-records rather than one.
            <View key={t.sourcePosition} wrap={false} style={{ paddingVertical: 3.75, backgroundColor: bg, borderBottomWidth: 0.75, borderBottomColor: '#E6E9EE' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ flex: 1.4, fontFamily: BODY, fontWeight: 700, fontSize: 9, color: INK }}>{dt(t.recordingDate)}</Text>
                <Text style={{ flex: 1.5, fontFamily: BODY, fontWeight: 500, fontSize: 9, color: INK }}>{t.documentNumber ?? GAP}</Text>
                <View style={{ flex: 2.2, flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: TYPE_COLOUR[kind], marginRight: 6 }} />
                  <Text style={{ fontFamily: BODY, fontWeight: 500, fontSize: 9, color: INK }}>
                    {txt(t.documentType ?? t.transactionType)}
                  </Text>
                </View>
                {/* The figure carries its own word, so a loan cannot be read as
                    a sale. An em dash where the record holds neither. */}
                <Text style={{ flex: 1.3, textAlign: 'right', fontFamily: BODY, fontWeight: 700, fontSize: 9, color: INK }}>
                  {t.amount === null ? GAP : money(t.amount)}
                </Text>
                <View style={{ flex: 1.1, alignItems: 'flex-end' }}>
                  {kind === 'foreclosure'
                    ? <Text style={{ fontFamily: BODY, fontWeight: 700, fontSize: 7.5, color: ORANGE }}>SEE NOTE</Text>
                    : isVesting
                      ? <Text style={{ fontFamily: BODY, fontWeight: 700, fontSize: 7.5, color: '#FFFFFF', backgroundColor: NAVY, paddingVertical: 1.5, paddingHorizontal: 4.5 }}>CURRENT OWNERS</Text>
                      : null}
                </View>
              </View>
              {/* Second line, muted, and ABSENT rather than blank when the
                  record names nobody — an empty line under every release would
                  cost a sheet to say nothing. */}
              {parties ? (
                <Text style={{ fontFamily: BODY, fontWeight: 500, fontSize: 7.9, color: MUTED, marginTop: 2.25 }}>
                  {t.amountKind === 'sale' ? `Sale · ${parties}` : t.amountKind === 'loan' ? `Loan · ${parties}` : parties}
                </Text>
              ) : null}
            </View>
          );
        })}

        {counts.foreclosure > 0 ? (
          <View style={{ backgroundColor: BOX_BG, borderLeftWidth: 2.25, borderLeftColor: NAVY, padding: 9, marginTop: 12 }}>
            <Text style={{ fontFamily: BODY, fontWeight: 500, fontSize: 9, color: INK, lineHeight: 1.5 }}>
              {`${counts.foreclosure} foreclosure-related ${counts.foreclosure === 1 ? 'document appears' : 'documents appear'} in this history. Recorded documents are county public record; their presence does not mean a proceeding is active today. Confirm current status through title review.`}
            </Text>
          </View>
        ) : null}
        <Footnote>{DASH_NOTE}</Footnote>
      </Sheet>

      {/* ── 6 · Comparable summary ───────────────────────────────────────── */}
      <Page size="LETTER" style={s.page}>
        <Band address={band.address} sub={band.sub} logo={band.logo} />
        <View style={{ paddingHorizontal: SIDE, paddingTop: 12, flexGrow: 1 }}>
          <SectionBar>COMPARABLE SALES MAP</SectionBar>
          {/* 187.5 — the v6 pixel value 250 × 0.75.
              HELD BY THE SPEC, NOT BY A TEST, and that is worth saying. The
              overflow guard does NOT go red at 250 in this layout: v6's page 6
              dropped the per-comp list that made v3's version tall, so the
              extra 62.5 pt now fits. It does go red at 430 (mutation-checked),
              so the guard has real sensitivity — just not at the value that
              caused the original fault. Do not "correct" this to 250 on the
              grounds that the tests still pass. */}
          {input.compMapImage
            // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf <Image> is a PDF primitive
            ? <Image src={input.compMapImage} style={{ width: '100%', height: 187.5, objectFit: 'cover', marginTop: 7.5 }} />
            : <View style={{ height: 187.5, backgroundColor: PLAT_BG, marginTop: 7.5 }} />}

          <SectionBar marginTop={12}>COMPARABLE SALES SUMMARY</SectionBar>
          <View style={{ marginTop: 7.5 }}>
            <NavyStrip
              tight
              cells={[
                { label: 'SALES', value: String(n) },
                { label: 'MEDIAN SALE', value: money(metrics.medianSalePrice) },
                { label: 'MEDIAN $/SQ FT', value: rate(metrics.medianPricePerSqft) },
                { label: 'SOLD', value: soldSpan(comps) },
              ]}
            />
          </View>

          <View style={{ flexDirection: 'row', borderBottomWidth: 1.5, borderBottomColor: NAVY, paddingBottom: 4.5, marginTop: 12 }}>
            <Text style={[s.th, { flex: 2 }]}> </Text>
            <Text style={[s.th, { flex: 1, textAlign: 'right' }]}>LOW</Text>
            <Text style={[s.th, { flex: 1, textAlign: 'right' }]}>MEDIAN</Text>
            <Text style={[s.th, { flex: 1, textAlign: 'right' }]}>HIGH</Text>
          </View>
          {statRows(comps).map((r) => (
            <View key={r.label} style={{ flexDirection: 'row', borderBottomWidth: 0.75, borderBottomColor: '#E6E9EE', paddingVertical: 3.75 }}>
              <Text style={{ flex: 2, fontFamily: BODY, fontWeight: 700, fontSize: 9, color: ORANGE }}>{r.label}</Text>
              <Text style={{ flex: 1, textAlign: 'right', fontFamily: BODY, fontWeight: 500, fontSize: 9, color: INK }}>{r.low}</Text>
              <Text style={{ flex: 1, textAlign: 'right', fontFamily: BODY, fontWeight: 700, fontSize: 9, color: INK, backgroundColor: MEDIAN_FILL }}>{r.mid}</Text>
              <Text style={{ flex: 1, textAlign: 'right', fontFamily: BODY, fontWeight: 500, fontSize: 9, color: INK }}>{r.high}</Text>
            </View>
          ))}

          <SectionBar marginTop={12}>CRITERIA OF SEARCH</SectionBar>
          <View style={{ flexDirection: 'row', marginTop: 7.5 }}>
            <StatBox small number={criteria.radiusMiles !== null ? `${criteria.radiusMiles} mi` : GAP} label="Radius" tone={NAVY} />
            <StatBox small number={criteria.months !== null ? `${criteria.months} mo` : GAP} label="Sold within" tone={NAVY} />
            <StatBox small number={criteria.livingAreaPct !== null ? `±${criteria.livingAreaPct}%` : GAP} label="Size" tone={NAVY} />
            <StatBox small number={criteria.bedDelta !== null ? `±${criteria.bedDelta}` : GAP} label="Beds" tone={NAVY} />
            <StatBox small number={criteria.bathDelta !== null ? `±${criteria.bathDelta}` : GAP} label="Baths" tone={NAVY} last />
          </View>
          <Footnote>
            {`${filter.counts.returned} returned → ${filter.counts.qualified} met → ${n} shown · Criteria were not loosened to show more.`}
          </Footnote>
        </View>
        <Footer />
      </Page>

      {/* ── 7 · Comparable sales ───────────────────────────────────────────
          OMITTED ENTIRELY WHEN THERE ARE NONE. 9270 Amethyst qualified zero
          comparables and still produced this sheet: a section bar, a footnote
          and nothing between them. The summary page above already says "0
          sales" and carries the criteria, so the reader is told — a second
          sheet saying it with no table is a blank page with a heading.

          Not the same as the tax page's layer-3 rule, but the same principle:
          a section with nothing in it is not a thin section, it is an absent
          one. */}
      {n === 0 ? null : (
      <Sheet band={band}>
        <SectionBar>COMPARABLE SALES</SectionBar>
        {comps.map((c, i) => {
          const r = pricePerSqft(c.salePrice, c.buildingArea);
          return (
            // ─── A CARD NEVER SPLITS ACROSS SHEETS ──────────────────────
            //
            // Without this a card breaks wherever the sheet runs out: its
            // header row on one page and the figures on the next, or the
            // address line orphaned under a border that started above it.
            // A comparable read across a fold is not a comparable.
            //
            // AND IT IS WHY NO ARITHMETIC IS NEEDED HERE. The intended fix was
            // to measure a card, divide into the page and lay out that many —
            // but `wrap={false}` already makes react-pdf do exactly that sum,
            // per card, against the space actually left. Computing a count
            // ourselves would fix one card height as a constant, and these are
            // not constant: an address that wraps to two lines makes its card
            // taller than its neighbours.
            <View key={i} wrap={false} style={{ borderWidth: 0.75, borderColor: BORDER, marginTop: 10.5 }}>
              <View style={{ flexDirection: 'row', backgroundColor: BOX_BG, paddingVertical: 4.5, paddingHorizontal: 7.5 }}>
                {['No.', 'Date sold', 'Sale price', 'Sq ft', '$/sq ft', 'Beds', 'Baths', 'Yr built', 'Distance'].map((h, j) => (
                  <Text key={h} style={{ flex: j === 0 ? 0.5 : 1, fontFamily: BODY, fontWeight: 700, fontSize: 8.6, color: ORANGE }}>{h}</Text>
                ))}
              </View>
              <View style={{ flexDirection: 'row', paddingVertical: 5.25, paddingHorizontal: 7.5 }}>
                <Text style={{ flex: 0.5, fontFamily: BODY, fontWeight: 500, fontSize: 9.4, color: INK }}>{String(i + 1)}</Text>
                <Text style={{ flex: 1, fontFamily: BODY, fontWeight: 500, fontSize: 9.4, color: INK }}>{dt(c.recordingDate)}</Text>
                <Text style={{ flex: 1, fontFamily: BODY, fontWeight: 700, fontSize: 9.4, color: INK }}>{money(c.salePrice)}</Text>
                <Text style={{ flex: 1, fontFamily: BODY, fontWeight: 500, fontSize: 9.4, color: INK }}>{sqft(c.buildingArea)}</Text>
                <Text style={{ flex: 1, fontFamily: BODY, fontWeight: 500, fontSize: 9.4, color: INK }}>{rate(r)}</Text>
                <Text style={{ flex: 1, fontFamily: BODY, fontWeight: 500, fontSize: 9.4, color: INK }}>{numf(c.bedrooms)}</Text>
                <Text style={{ flex: 1, fontFamily: BODY, fontWeight: 500, fontSize: 9.4, color: INK }}>{numf(c.baths)}</Text>
                <Text style={{ flex: 1, fontFamily: BODY, fontWeight: 500, fontSize: 9.4, color: INK }}>{year(c.yearBuilt)}</Text>
                <Text style={{ flex: 1, fontFamily: BODY, fontWeight: 500, fontSize: 9.4, color: INK }}>
                  {typeof c.proximityMiles === 'number' ? `${c.proximityMiles.toFixed(2)} mi` : GAP}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingBottom: 5.25, paddingHorizontal: 7.5 }}>
                <Text style={{ fontFamily: BODY, fontWeight: 700, fontSize: 9.4, color: INK }}>{txt(c.address)}</Text>
                <Text style={{ fontFamily: BODY, fontWeight: 500, fontSize: 9.4, color: MUTED }}>{txt(c.useCodeDescription)}</Text>
              </View>
            </View>
          );
        })}
        <Footnote>{`${DASH_NOTE} Price per sq ft is the sale price divided by living area.`}</Footnote>
      </Sheet>
      )}

      {/* ── 8 · Plat map ─────────────────────────────────────────────────── */}
      <Page size="LETTER" style={s.page}>
        <Band address={band.address} sub={band.sub} logo={band.logo} />
        <View style={{ paddingHorizontal: SIDE, paddingTop: BODY_TOP_PT, flexGrow: 1 }}>
          <SectionBar>{`PLAT MAP · APN ${txt(subject.apn)}`}</SectionBar>
          {/* An explicit height, not flexGrow. react-pdf refuses an IMAGE it
              cannot wrap — "can't wrap between pages and it's bigger than
              available page height" — and a percentage height inside a growing
              box gives it nothing to measure against, which put the plat map
              on a ninth sheet. 792 − 93 band − 29 footer − 19.5 top − 30 bar
              − 9 gap leaves 611; 560 keeps a margin. */}
          <View style={{ height: 560, backgroundColor: PLAT_BG, marginTop: 9 }}>
            {input.platMapImage
              // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf <Image> is a PDF primitive
              ? <Image src={input.platMapImage} style={{ width: '100%', height: 560, objectFit: 'contain' }} />
              : null}
          </View>
          {!input.platMapImage ? (
            <Footnote>
              {input.platMapStatus
                ? `No plat map is shown: ${input.platMapStatus}.`
                : 'The county supplied no plat map for this parcel.'}
            </Footnote>
          ) : null}
        </View>
        <Footer />
      </Page>
    </Document>
  );
}

/** "· held 9 years" — only when the date parses. */
function heldYears(recordingDate: string | null, asOf: Date): string {
  if (!recordingDate) return '';
  const d = new Date(recordingDate + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return '';
  const years = Math.floor((asOf.getTime() - d.getTime()) / (365.25 * 24 * 3600 * 1000));
  return years >= 1 ? ` · held ${years} ${years === 1 ? 'year' : 'years'}` : '';
}

function soldSpan(comps: Sel[]): string {
  const ds = comps.map((c) => c.recordingDate).filter((d): d is string => typeof d === 'string' && d.length > 0).sort();
  if (!ds.length) return GAP;
  const f = (iso: string) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  return ds[0] === ds[ds.length - 1] ? f(ds[0]!) : `${f(ds[0]!)} – ${f(ds[ds.length - 1]!)}`;
}

/**
 * Low / median / high across the SELECTED comparables — one scope, always.
 *
 * The median is computed here from the same set the table prints, rather than
 * read from `metrics`, so the three columns of a row can never come from
 * different populations.
 */
export function statRows(comps: Sel[]) {
  const stat = (vals: (number | null)[], fmtOne: (n: number) => string) => {
    const v = vals.filter((x): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0).sort((a, b) => a - b);
    if (!v.length) return { low: GAP, mid: GAP, high: GAP };
    const mid = v.length % 2 === 1 ? v[(v.length - 1) / 2]! : (v[v.length / 2 - 1]! + v[v.length / 2]!) / 2;
    return { low: fmtOne(v[0]!), mid: fmtOne(mid), high: fmtOne(v[v.length - 1]!) };
  };
  const plain = (n: number) => String(Math.round(n * 10) / 10);
  return [
    { label: 'Sale price', ...stat(comps.map((c) => c.salePrice ?? null), money) },
    { label: '$/sq ft', ...stat(comps.map((c) => pricePerSqft(c.salePrice, c.buildingArea)), rate) },
    { label: 'Living area', ...stat(comps.map((c) => c.buildingArea ?? null), sqft) },
    { label: 'Beds', ...stat(comps.map((c) => c.bedrooms ?? null), plain) },
    { label: 'Baths', ...stat(comps.map((c) => c.baths ?? null), plain) },
    { label: 'Year built', ...stat(comps.map((c) => c.yearBuilt ?? null), year) },
    { label: 'Lot size', ...stat(comps.map((c) => c.lotSize ?? null), sqft) },
  ];
}

/**
 * Page 4. Only rendered when a layer exists — the empty state is the page not
 * existing, which is why there is no "not available" box anywhere here.
 *
 * On the SiteX layer the same parts render, sections with no data are left out,
 * and the reason goes in the FOOTNOTE rather than a grey box.
 */
function TaxPage({ layer, subject, captured }: {
  layer: NonNullable<TaxLayer>;
  subject: NormalizedSubject;
  captured: Date | null;
}) {
  const county = subject.county ? `${subject.county} County` : null;

  if (layer.source === 'sitex') {
    const { tax, installments } = layer;
    return (
      <>
        <SectionBar>{`PROPERTY TAX · ${fiscalYear(tax.year)}`}</SectionBar>
        <View style={{ marginTop: 7.5 }}>
          {/* CELLS WITH NO DATA ARE DROPPED, not printed as dashes. Half a
              navy strip of em dashes is the empty-shell rule hit from inside:
              the page renders a section it has nothing to put in. TAX RATE and
              TRA exist only in TitlePoint's report, so on this layer the strip
              is two cells. */}
          <NavyStrip cells={taxStripCells({ annual: money(tax.taxAmount), taxYear: fiscalYear(tax.year), rate: null, rateArea: null })} />
        </View>

        {installments ? (
          <>
            <SectionBar marginTop={SECTION_GAP_PT}>INSTALLMENTS</SectionBar>
            <View style={{ flexDirection: 'row', marginTop: 7.5 }}>
              {installments.map((it, i) => (
                <InstallmentBox
                  key={it.label}
                  label={`${it.label.toUpperCase()} INSTALLMENT`}
                  amount={money(it.amount)}
                  due={`Due ${numericDate(it.due)}`}
                  last={i === installments.length - 1}
                />
              ))}
            </View>
          </>
        ) : null}

        <SectionBar marginTop={SECTION_GAP_PT}>ASSESSED VALUE</SectionBar>
        <AssessedBar land={tax.landValue} improvements={tax.improvementValue} />
        <SwatchRow label="Land" colour={NAVY} value={money(tax.landValue)} />
        <SwatchRow label="Improvements" colour={TYPE_COLOUR.mortgage} value={money(tax.improvementValue)} />
        <TotalAssessedRow value={money(tax.assessedValue)} />

        <Footnote>
          {/* The old footnote said instalment amounts "were not available"
              while printing two installment boxes above it. They ARE shown —
              derived from the annual total by statute, which is a different
              claim and the one the page can support. */}
          {`Installments are the annual amount split per California statute. Exemptions, special assessments and bonds were not in the record we received${captured ? `, as of ${dtLong(captured)}` : ''}${county ? ` · ${county}` : ''}. ${DASH_NOTE}`}
        </Footnote>
      </>
    );
  }

  const r = layer.report;
  const exemption = typeof r.homeOwnerExemption === 'number' && r.homeOwnerExemption > 0 ? r.homeOwnerExemption : null;
  // eslint-disable-next-line @typescript-eslint/no-use-before-define -- MelloRoosNote is declared below, with the other page-4 parts.
  return (
    <>
      <SectionBar>{`PROPERTY TAX · ${fiscalYear(r.taxYear)}`}</SectionBar>
      <View style={{ marginTop: 7.5 }}>
        <NavyStrip cells={taxStripCells({
          annual: money(r.annualAmount),
          taxYear: fiscalYear(r.taxYear),
          rate: r.taxRate !== null ? `${r.taxRate}%` : null,
          rateArea: r.taxRateArea,
        })} />
      </View>

      {r.installments.length > 0 ? (
        <>
          <SectionBar marginTop={SECTION_GAP_PT}>INSTALLMENTS</SectionBar>
          <View style={{ flexDirection: 'row', marginTop: 7.5 }}>
            {r.installments.map((it, i) => (
              // it.status is deliberately not rendered.
              <InstallmentBox
                key={it.number}
                label={`${it.number.toUpperCase()} INSTALLMENT`}
                amount={money(it.amount)}
                due={`Due ${numericDate(dt(it.dueDate))}`}
                last={i === r.installments.length - 1}
              />
            ))}
          </View>
        </>
      ) : null}

      <SectionBar marginTop={SECTION_GAP_PT}>ASSESSED VALUE</SectionBar>
      <AssessedBar land={r.landValue} improvements={r.improvementValue} />
      <SwatchRow label="Land" colour={NAVY} value={money(r.landValue)} />
      <SwatchRow label="Improvements" colour={TYPE_COLOUR.mortgage} value={money(r.improvementValue)} />
      <TotalAssessedRow value={money(r.assessedValue)} />
      {/* Homeowner's only, and never a category name. Every other exemption
          type discloses age, disability, veteran status or bereavement. */}
      {exemption ? <Row label="Homeowner's exemption" value={money(exemption)} /> : null}

      {r.specialAssessments.length + r.bonds.length > 0 ? (
        <>
          <SectionBar marginTop={SECTION_GAP_PT}>SPECIAL ASSESSMENTS &amp; BONDS</SectionBar>
          <View style={{ flexDirection: 'row', borderBottomWidth: 1.5, borderBottomColor: NAVY, paddingBottom: 4.5, marginTop: 7.5 }}>
            <Text style={[s.th, { flex: 2.4 }]}>ISSUED FOR</Text>
            <Text style={[s.th, { flex: 1.4, textAlign: 'right' }]}>PAYABLE TO</Text>
            <Text style={[s.th, { flex: 1.4, textAlign: 'right' }]}>MATURES</Text>
          </View>
          {[...r.specialAssessments, ...r.bonds].map((it, i) => (
            <View key={i} style={{ flexDirection: 'row', borderBottomWidth: 0.75, borderBottomColor: '#E6E9EE', paddingVertical: 3.75 }}>
              <Text style={{ flex: 2.4, fontFamily: BODY, fontWeight: 500, fontSize: 9, color: INK }}>{txt(it.description)}</Text>
              <Text style={{ flex: 1.4, textAlign: 'right', fontFamily: BODY, fontWeight: 500, fontSize: 9, color: INK }}>{money(it.amount)}</Text>
              <Text style={{ flex: 1.4, textAlign: 'right', fontFamily: BODY, fontWeight: 500, fontSize: 9, color: INK }}>{dt(it.maturityDate)}</Text>
            </View>
          ))}
        </>
      ) : null}

      {/* A DISCLOSURE, not a data row — see MelloRoosNote. */}
      <MelloRoosNote disclosure={melloRoosDisclosure(r.melloRoos, money)} />

      {r.supplementals.length > 0 ? (
        <View style={{ backgroundColor: BOX_BG, borderLeftWidth: 2.25, borderLeftColor: NAVY, padding: 9, marginTop: 12 }}>
          <Text style={{ fontFamily: BODY, fontWeight: 500, fontSize: 9, color: INK, lineHeight: 1.5 }}>
            {`${r.supplementals.length} supplemental ${r.supplementals.length === 1 ? 'bill has' : 'bills have'} been issued on this parcel following a change in ownership or new construction.`}
          </Text>
        </View>
      ) : null}

      <Footnote>
        {`Tax figures are the county's own${r.asOf ? `, as reported on ${dt(r.asOf)}` : ''}. Amounts and due dates change; confirm current balances with the tax collector. ${DASH_NOTE}`}
      </Footnote>
    </>
  );
}

/**
 * "2025–2026". California property tax runs on a fiscal year, and printing the
 * assessment year alone reads as a calendar year to anyone who does not know
 * that. En dash, not a hyphen — it is a range.
 */
export function fiscalYear(y: number | null | undefined): string {
  if (typeof y !== 'number' || !Number.isFinite(y)) return GAP;
  const n = Math.round(y);
  return `${n}–${n + 1}`;
}

/** "Nov 1, 2025" -> "11/01/2025". The due line is a date, not prose. */
export function numericDate(v: string): string {
  const d = new Date(`${v} UTC`);
  if (Number.isNaN(d.getTime())) return v;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())}/${d.getUTCFullYear()}`;
}

/**
 * The strip cells that actually have a value.
 *
 * A cell printing an em dash is the empty-shell rule from inside: the page
 * renders a heading it has nothing to put under. On the SiteX layer TAX RATE
 * and TAX RATE AREA do not exist at all, so the strip is two cells wide rather
 * than four with half of them blank.
 */
export function taxStripCells(v: {
  annual: string; taxYear: string; rate: string | null; rateArea: string | null;
}): { label: string; value: string }[] {
  const cells = [
    { label: 'ANNUAL TAX', value: v.annual },
    { label: 'TAX YEAR', value: v.taxYear },
    { label: 'TAX RATE', value: v.rate },
    // TAX RATE AREA, not TRA. The abbreviation is trade shorthand and this is
    // a document for a homeowner.
    { label: 'TAX RATE AREA', value: v.rateArea },
  ];
  return cells
    .filter((c): c is { label: string; value: string } => !!c.value && c.value !== GAP)
    .map((c) => ({ label: c.label, value: c.value }));
}

/** A row whose label carries the colour it has in the bar above it. */
function SwatchRow({ label, colour, value }: { label: string; colour: string; value: string }) {
  const missing = !value || value === GAP;
  return (
    <View style={s.row}>
      <View style={{ width: LABEL_W, flexDirection: 'row', alignItems: 'center' }}>
        <Swatch colour={colour} />
        <Text style={{ fontFamily: BODY, fontWeight: 700, fontSize: 9.75, color: ORANGE }}>{label}</Text>
      </View>
      <Text style={missing ? s.rowGap : s.rowValue}>{missing ? GAP : value}</Text>
    </View>
  );
}

/** "Total assessed value" — bold navy on BOTH layers, not just TitlePoint's. */
function TotalAssessedRow({ value }: { value: string }) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>Total assessed value</Text>
      <Text style={{ flex: 1, fontFamily: BODY, fontWeight: 700, fontSize: 9.75, color: NAVY }}>{value}</Text>
    </View>
  );
}

/** A 9 pt bar split land / improvements. Renders nothing without both. */
function AssessedBar({ land, improvements }: { land: number | null; improvements: number | null }) {
  if (typeof land !== 'number' || typeof improvements !== 'number') return null;
  const total = land + improvements;
  if (total <= 0) return null;
  const landPct = Math.round((land / total) * 100);
  return (
    // Inset 9 each side, so the bar sits inside the rows beneath it rather
    // than running the full body width and reading as a rule.
    <View style={{ flexDirection: 'row', height: 9, marginTop: 9, marginBottom: 3, marginHorizontal: 9 }}>
      <View style={{ width: `${landPct}%`, backgroundColor: NAVY }} />
      <View style={{ width: `${100 - landPct}%`, backgroundColor: TYPE_COLOUR.mortgage }} />
    </View>
  );
}

/**
 * The Mello-Roos disclosure block.
 *
 * A DISCLOSURE, not a data row, which is why it is a paragraph under its own
 * heading rather than a line in the assessments table. Those same charges DO
 * appear in that table as direct assessments; this says what they are.
 *
 * Wording is Jerry's and is assembled in melloRoosDisclosure() — see the note
 * there for why it says "included in" rather than "in addition to", and why it
 * does not predict when the term ends.
 *
 * ─── THE NAMES ARE STYLED, NEVER EDITED ─────────────────────────────────────
 *
 * They are the county's strings verbatim, so they arrive in capitals:
 * "FC CFD 2021-1 IA-2 HEMET USD MELLO ROOS". Shortening them makes a district
 * un-lookupable and title-casing turns that into "Fc Cfd 2021-1 Ia-2 Hemet Usd".
 * So the characters stand and the loudness is answered here, with a smaller
 * size and the muted ink — which is also how a reader sees at a glance that the
 * names are quoted material rather than our prose.
 */
function MelloRoosNote({ disclosure }: { disclosure: MelloRoosDisclosure | null }) {
  if (!disclosure) return null;
  const { lead, names, body } = disclosure;
  return (
    <View style={{ backgroundColor: BOX_BG, borderLeftWidth: 2.25, borderLeftColor: ORANGE, padding: 9, marginTop: 12 }}>
      <Text style={{ fontFamily: HEADING, fontWeight: 700, fontSize: 8.25, letterSpacing: 0.6, color: NAVY, marginBottom: 3.75 }}>
        COMMUNITY FACILITIES DISTRICT (MELLO-ROOS)
      </Text>
      <Text style={{ fontFamily: BODY, fontWeight: 500, fontSize: 9, color: INK, lineHeight: 1.5 }}>
        {lead}
        {names.length > 0 ? (
          <>
            {' '}
            <Text style={{ fontSize: 8.25, color: MUTED }}>{joinDistricts(names)}</Text>
            {'. '}
          </>
        ) : ' '}
        {body}
      </Text>
    </View>
  );
}

/**
 * "A and B" / "A, B, and C". The serial comma is punctuation BETWEEN names, so
 * it belongs to the sentence and not to any name — which is why this joins here
 * rather than the names arriving pre-joined and unstylable.
 */
function joinDistricts(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}
