import React from 'react';
import { Image, StyleSheet, Text, View } from '@react-pdf/renderer';
import { BODY, HEADING } from './fonts';

// ─── The six v6 parts ────────────────────────────────────────────────────────
//
// Every number here is a v6 pixel × 0.75. v6 is 816 px wide; a letter PDF is
// 612 pt. The previous build used the pixel values directly, which is why
// everything came out a third too big and the comp map at 250 pt (it should be
// 187.5) pushed page 6's criteria onto page 8.
//
// THESE REPLACE v3's PARTS ENTIRELY. Head, KV, Tile, Absent, the navy footer
// bar and the grey-filled row pattern are gone — v6 has none of them. A section
// bar carries the structure that a title-plus-lede used to.

export const NAVY = '#1B2A4A';
export const ORANGE = '#F26B2B';
export const MUTED = '#526174';
export const BORDER = '#D7DDE5';
/** Body ink. From the corrections PDF, which is the authority over the .md. */
export const INK = '#1A1F2B';
/** A missing value. Never blank, never zero, never inferred. */
export const GAP = '—';
export const GAP_INK = '#8A94A3';

/** Kept for the three farming documents, which share this palette. */
export const TINT = '#F8F9FA';

export const SECTION_BG = '#EDF0F4';
export const ROW_LINE = '#E6E9EE';
export const BOX_BG = '#F6F7F9';
export const MEDIAN_FILL = '#EEF2F8';
export const FORECLOSURE_BG = '#FEF3EC';
export const PLAT_BG = '#F3F5F8';
// COVER_PANEL IS GONE (2026-10-06). It was #222A48 for the prepared-for panel
// while the address block above it used NAVY #1B2A4A — slightly lighter and a
// touch more purple, which reads on the proof as two blocks that do not match.
//
// Both are NAVY now, and the constant is DELETED rather than redefined to the
// same value: two names for one colour is how they drift apart again, and the
// next spec round would have had something to re-split. cover-is-one-navy in
// profile-document.test.ts holds it.
export const COVER_FALLBACK = '#2A3A5C';
/**
 * PREPARED FOR / PRESENTED BY. ORANGE, like the eyebrow above them.
 *
 * This was #046744 — a green — from 2026-09-30 to 2026-10-05, transcribed off a
 * rendered image of the corrections PDF and wrong. There is no green anywhere
 * in the palette, and these are the same kind of label as the CONCIERGE
 * PROPERTY PROFILE eyebrow, so they are the same colour as it.
 *
 * Kept as its own token rather than folded into ORANGE because the two are the
 * same value for a reason, not by coincidence, and a future change to one of
 * them should have to say which it means.
 */
export const PREPARED_LABEL = ORANGE;

/** Recorded-document type colours. Orange means foreclosure and nothing else. */
export const TYPE_COLOUR = {
  deed: NAVY,
  mortgage: '#4A6FA5',
  release: '#8A94A3',
  foreclosure: ORANGE,
} as const;
export type TypeKey = keyof typeof TYPE_COLOUR;

/** 42 pt on every page. The v3 build used 40. */
export const SIDE = 42;
export const BAND_H = 93;
export const BODY_TOP = 19.5;
export const SECTION_GAP = 15;
export const LABEL_W = 112.5;

export const s = StyleSheet.create({
  page: { fontSize: 9.75, color: INK, fontFamily: BODY, fontWeight: 500, flexDirection: 'column' },
  body: { paddingHorizontal: SIDE, paddingTop: BODY_TOP, flexGrow: 1 },

  /**
   * The body when the band above it is `fixed`, and therefore out of flow.
   *
   * BAND_H + BODY_TOP, not BODY_TOP: with the band in flow the padding was just
   * the gap beneath it, and the band's own 93pt was taken by the band. Fixed, it
   * occupies no flow space at all, so the body has to reserve it — otherwise
   * every sheet renders its first line underneath the navy, silently and with no
   * error.
   */
  bodyUnderFixedBand: { paddingHorizontal: SIDE, paddingTop: BAND_H + BODY_TOP, flexGrow: 1 },

  band: { height: BAND_H, backgroundColor: NAVY, paddingHorizontal: SIDE, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  bandEyebrow: { fontFamily: HEADING, fontWeight: 700, fontSize: 7.5, color: ORANGE, letterSpacing: 1.2 },
  bandAddress: { fontFamily: HEADING, fontWeight: 800, fontSize: 18, color: '#FFFFFF', marginTop: 7 },
  bandSub: { fontFamily: BODY, fontWeight: 500, fontSize: 9.4, color: '#FFFFFF', opacity: 0.8, marginTop: 3 },

  sectionBar: { backgroundColor: SECTION_BG, borderLeftWidth: 2.25, borderLeftColor: ORANGE, padding: 9 },
  sectionText: { fontFamily: HEADING, fontWeight: 700, fontSize: 9.75, color: NAVY, letterSpacing: 0.8 },

  row: { flexDirection: 'row', borderBottomWidth: 0.75, borderBottomColor: ROW_LINE, paddingVertical: 3.75, paddingHorizontal: 7.5, alignItems: 'center' },
  rowLabel: { fontFamily: BODY, fontWeight: 700, fontSize: 9.75, color: ORANGE, width: LABEL_W },
  rowLabel2: { fontFamily: BODY, fontWeight: 500, fontSize: 9.75, color: MUTED, width: LABEL_W },
  rowValue: { fontFamily: BODY, fontWeight: 500, fontSize: 9.75, color: INK, flex: 1 },
  rowGap: { fontFamily: BODY, fontWeight: 500, fontSize: 9.75, color: GAP_INK, flex: 1 },

  strip: { backgroundColor: NAVY, flexDirection: 'row', paddingVertical: 9 },
  stripCell: { flex: 1, paddingHorizontal: 12, borderLeftWidth: 0.75, borderLeftColor: 'rgba(255,255,255,0.18)' },
  stripLabel: { fontFamily: HEADING, fontWeight: 700, fontSize: 7.5, color: ORANGE, letterSpacing: 1 },
  stripValue: { fontFamily: HEADING, fontWeight: 800, fontSize: 14.25, color: '#FFFFFF', marginTop: 4 },

  // marginRight, never flex `gap` — react-pdf ignores gap.
  statBox: { flex: 1, backgroundColor: BOX_BG, borderTopWidth: 2.25, paddingVertical: 9, paddingHorizontal: 10.5, marginRight: 7.5 },
  statNumber: { fontFamily: HEADING, fontWeight: 800, fontSize: 18, color: NAVY },
  statLabel: { fontFamily: BODY, fontWeight: 500, fontSize: 8.6, color: MUTED },

  footer: { borderTopWidth: 0.75, borderTopColor: BORDER, paddingVertical: 10.5, paddingHorizontal: SIDE, flexDirection: 'row', justifyContent: 'space-between' },
  footerText: { fontFamily: BODY, fontWeight: 500, fontSize: 7.9, color: MUTED },

  footnote: { fontFamily: BODY, fontWeight: 500, fontSize: 8.25, color: MUTED, marginTop: 9 },

  th: { fontFamily: BODY, fontWeight: 700, fontSize: 8.25, color: ORANGE },
});

/** The shared band on pages 2–8. The cover has its own and no footer. */
export function Band({ address, sub, logo, fixed }: {
  address: string; sub: string; logo: string | null;
  /** Repeat on every sheet this Page generates — see Sheet. */
  fixed?: boolean;
}) {
  return (
    <View style={s.band} fixed={fixed}>
      <View style={{ flex: 1, paddingRight: 16 }}>
        <Text style={s.bandEyebrow}>CONCIERGE PROPERTY PROFILE</Text>
        <Text style={s.bandAddress}>{address}</Text>
        <Text style={s.bandSub}>{sub}</Text>
      </View>
      {logo
        // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf <Image> is a PDF primitive
        ? <Image src={logo} style={{ height: 23, objectFit: 'contain' }} />
        : null}
    </View>
  );
}

/** Every section heading. Replaces both v3's Head and its letterspaced eyebrow. */
export function SectionBar({ children, marginTop }: { children: string; marginTop?: number }) {
  return (
    <View style={marginTop ? [s.sectionBar, { marginTop }] : s.sectionBar}>
      <Text style={s.sectionText}>{children}</Text>
    </View>
  );
}

/** A two-column row. White, ruled, no fill. */
export function Row({ label, value }: { label: string; value: string | null | undefined }) {
  const missing = !value || value === GAP;
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={missing ? s.rowGap : s.rowValue}>{missing ? GAP : value}</Text>
    </View>
  );
}

/** The four-column variant: label / value / muted label / value. */
export function Row4({ label, value, label2, value2 }: {
  label: string; value: string | null | undefined;
  label2: string; value2: string | null | undefined;
}) {
  const miss = (v: string | null | undefined) => !v || v === GAP;
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={miss(value) ? s.rowGap : s.rowValue}>{miss(value) ? GAP : value}</Text>
      <Text style={s.rowLabel2}>{label2}</Text>
      <Text style={miss(value2) ? s.rowGap : s.rowValue}>{miss(value2) ? GAP : value2}</Text>
    </View>
  );
}

export function NavyStrip({ cells, tight }: { cells: { label: string; value: string }[]; tight?: boolean }) {
  return (
    <View style={tight ? [s.strip, { paddingVertical: 7 }] : s.strip}>
      {cells.map((c, i) => (
        <View key={c.label} style={i === 0 ? [s.stripCell, { borderLeftWidth: 0 }] : s.stripCell}>
          <Text style={s.stripLabel}>{c.label}</Text>
          <Text style={s.stripValue}>{c.value}</Text>
        </View>
      ))}
    </View>
  );
}

export function StatBox({ number, label, tone, last, small }: {
  number: string; label: string; tone: string; last?: boolean; small?: boolean;
}) {
  return (
    <View style={[s.statBox, { borderTopColor: tone }, ...(last ? [{ marginRight: 0 }] : [])]}>
      <Text style={small ? [s.statNumber, { fontSize: 11.25 }] : s.statNumber}>{number}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

/**
 * The cover fade: navy at 70% along the top edge, transparent by `height`.
 *
 * NOT AN SVG GRADIENT, and not for want of trying. v6 asks for
 * rgba(27,42,74,.7) → transparent and react-pdf offers <LinearGradient>, but
 * its stops carry no alpha. Measured down the left edge of the rendered page:
 *
 *   stopOpacity={0.7} / {0}   solid 27,42,74 for the whole 90 pt, then a hard
 *                             edge — the fade simply does not happen
 *   stopOpacity="0.7" / "0"   identical; string or number makes no difference
 *   stopColor="rgba(...)"     interpolates, but mis-parsed: rgb(255,74,177),
 *                             magenta, with the alpha landing in the blue
 *                             channel
 *
 * View opacity IS honoured, so the fade is a stack of bands. 60 of them across
 * 90 pt is 1.5 pt each and ~0.012 opacity per step; at 30 the steps were
 * visible as rings when the page was magnified. Raising the height without
 * raising the step count brings them back.
 */
const FADE_STEPS = 60;

export function CoverFade({ width, height, colour = NAVY, from = 0.7 }: {
  width: number; height: number; colour?: string; from?: number;
}) {
  const band = height / FADE_STEPS;
  return (
    <View style={{ position: 'absolute', top: 0, left: 0, width, height }}>
      {Array.from({ length: FADE_STEPS }, (_, i) => (
        // ABSOLUTE AND OVERLAPPING, not stacked in flow. Bands laid out in
        // normal flow at 1.5 pt each land on half-points, and the seam between
        // two adjacent fills anti-aliases into a visible hairline — the fade
        // came out striped. Positioning each one and giving it a full band of
        // overlap removes the seams; the extra height on the last band is
        // clipped by the parent.
        <View
          key={i}
          style={{
            position: 'absolute',
            top: i * band,
            left: 0,
            right: 0,
            height: band * 2,
            backgroundColor: colour,
            opacity: from * (1 - i / (FADE_STEPS - 1)) / 2,
          }}
        />
      ))}
    </View>
  );
}

/**
 * A tax installment. ITS OWN PART, not a StatBox.
 *
 * A StatBox leads with the number and captions it underneath, which is right
 * for "3 Deeds" and wrong here — the build rendered "$2,697 / First · due Nov
 * 1, 2025" and the reader meets an amount before knowing which installment it
 * belongs to. v6 inverts it: which installment, then how much, then when.
 *
 * NO STATUS. Not "paid", not "delinquent", no "late after" column. v6 itself
 * showed PAID badges here and they were removed from v6 as well as from this.
 */
export function InstallmentBox({ label, amount, due, last }: {
  label: string; amount: string; due: string; last?: boolean;
}) {
  return (
    <View style={[
      { flex: 1, backgroundColor: BOX_BG, borderTopWidth: 2.25, borderTopColor: NAVY, paddingVertical: 10.5, paddingHorizontal: 12 },
      ...(last ? [] : [{ marginRight: 7.5 }]),
    ]}>
      <Text style={{ fontFamily: BODY, fontWeight: 700, fontSize: 8.25, color: ORANGE, letterSpacing: 0.5 }}>{label}</Text>
      <Text style={{ fontFamily: HEADING, fontWeight: 800, fontSize: 16.5, color: NAVY, marginTop: 4.5 }}>{amount}</Text>
      <Text style={{ fontFamily: BODY, fontWeight: 500, fontSize: 9.4, color: MUTED, marginTop: 3 }}>{due}</Text>
    </View>
  );
}

/** A 6 pt square in a type colour, 5 pt before its label. */
export function Swatch({ colour }: { colour: string }) {
  return <View style={{ width: 6, height: 6, backgroundColor: colour, marginRight: 5 }} />;
}

/** White, ruled, at the foot of pages 2–8. NOT a navy bar, and no template id. */
/**
 * ─── THE NUMBER IS THE SHEET, NOT THE SECTION ───────────────────────────────
 *
 * This took `page` and `total` computed from pagesFor()/pageNo() — a list of
 * LOGICAL sections. A section that overflows produces two sheets, and both
 * printed the same number, so "7 of 8" appeared twice on a document that was
 * actually ten sheets long. 2111 Gemma Ct is ten and 9270 Amethyst Street is
 * nine; both said "of 8".
 *
 * react-pdf knows the real answer and will tell you: `render` on a fixed Text
 * is called once per generated sheet with that sheet's number and the document
 * total. Nothing here has to predict how the content will break, which is the
 * whole reason the old version was wrong — it was a model of the layout rather
 * than the layout.
 *
 * `fixed` is required on the Text as well as the View: without it react-pdf
 * evaluates the render once and repeats the result.
 */
export function Footer() {
  return (
    <View style={s.footer} fixed>
      <Text style={s.footerText}>
        Data deemed reliable, but not guaranteed. Pacific Coast Title Company. All rights reserved.
      </Text>
      <Text
        style={s.footerText}
        fixed
        render={({ pageNumber, totalPages }) => `${pageNumber} of ${totalPages}`}
      />
    </View>
  );
}

/**
 * One line per page, and only one.
 *
 * ─── IT MUST NOT LAND ALONE ON THE NEXT SHEET ───────────────────────────────
 *
 * On 2111 Gemma Ct the tax content filled page 4 and this one sentence flowed
 * onto a sheet of its own — a blank page carrying a footnote and a footer, and
 * two of that document's extra sheets.
 *
 * `minPresenceAhead` is react-pdf's answer: it asks for that many points of
 * room below this element, and breaks EARLIER if there is not enough. So the
 * break lands before the block this annotates rather than between the block and
 * its note, which is the only arrangement where the sentence still means
 * something — a footnote separated from what it footnotes is just a sentence.
 *
 * `wrap={false}` on top of it, so a two-line note cannot split down the middle.
 */
export function Footnote({ children }: { children: string }) {
  return <Text style={s.footnote} wrap={false} minPresenceAhead={FOOTNOTE_KEEP_PT}>{children}</Text>;
}

/**
 * Room a footnote asks for below itself before it will sit on a sheet.
 *
 * Its own two lines plus the footer, so "there is space for the note" cannot be
 * true on a sheet where only the note would fit.
 */
export const FOOTNOTE_KEEP_PT = 54;

export const DASH_NOTE = '— means the item was not included in the county record we received.';
