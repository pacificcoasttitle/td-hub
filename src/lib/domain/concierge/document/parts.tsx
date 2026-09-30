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
export const COVER_PANEL = '#222A48';
export const COVER_FALLBACK = '#2A3A5C';
export const PREPARED_LABEL = '#046744';

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
export function Band({ address, sub, logo }: { address: string; sub: string; logo: string | null }) {
  return (
    <View style={s.band}>
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

/** White, ruled, at the foot of pages 2–8. NOT a navy bar, and no template id. */
export function Footer({ page, total }: { page: number; total: number }) {
  return (
    <View style={s.footer} fixed>
      <Text style={s.footerText}>
        Data deemed reliable, but not guaranteed. Pacific Coast Title Company. All rights reserved.
      </Text>
      <Text style={s.footerText}>{`${page} of ${total}`}</Text>
    </View>
  );
}

/** One line per page, and only one. Replaces every explainer box v3 used. */
export function Footnote({ children }: { children: string }) {
  return <Text style={s.footnote}>{children}</Text>;
}

export const DASH_NOTE = '— means the item was not included in the county record we received.';
