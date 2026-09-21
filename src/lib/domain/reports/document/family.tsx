import React from 'react';
import { Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer';
// Importing the concierge document also registers its hyphenation callback —
// wanted here: these pages are full of city names, and "LOS ANGE-LES" is what
// react-pdf prints without it.
import {
  NAVY, ORANGE, MUTED, BORDER, TINT, GAP, fmt,
} from '../../concierge/document/profile-document';
import type { DataQuality } from '../compute';

// ─── The farming family: one shell, one footer, one way to say "absent" ─────
//
// The three farming reports are siblings of the concierge property profile and
// take its tokens, its formatters and its rules — so all four are one family
// rather than approximately one.
//
// ONE DELIBERATE DIVERGENCE. The profile is a reference document read at a
// desk, set at 8.5pt with 6pt labels. These are leave-behinds handed across a
// table: body 9.5pt, table cells 8.5pt, labels 7pt, and NOTHING below 7pt —
// the page footer included.
//
// Rules carried over, each because the profile learned it on the page:
//   - no flex `gap` (react-pdf ignores it): marginRight on every tile, plus a
//     last-tile override;
//   - absences are rendered, never filled: GAP for a missing value, <Absent>
//     for a missing section, with a sentence saying why;
//   - the fmt helpers, not new ones.

export { NAVY, ORANGE, MUTED, BORDER, TINT, GAP, fmt };

export const SIZE = { body: 9.5, cell: 8.5, label: 7 } as const;

export const WHITE = '#FFFFFF';

export const CUSTOMER_SERVICE = 'Customer service (866) 724-1050 · cs@pct.com';
export const OPEN_ORDERS = 'Open orders · openorders@pct.com';

export const f = StyleSheet.create({
  // paddingBottom reserves the rep block and the page footer on every page.
  page: { paddingTop: 34, paddingBottom: 124, paddingHorizontal: 40, fontSize: SIZE.body, color: NAVY, fontFamily: 'Helvetica' },
  bar: { backgroundColor: NAVY, marginHorizontal: -40, marginTop: -34, paddingHorizontal: 40, paddingVertical: 13, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  brand: { color: WHITE, fontSize: 12, fontFamily: 'Helvetica-Bold', letterSpacing: 0.6 },
  kicker: { color: ORANGE, fontSize: 7.5, letterSpacing: 1.3, fontFamily: 'Helvetica-Bold' },
  h1: { fontSize: 20, fontFamily: 'Helvetica-Bold', marginTop: 16 },
  sub: { fontSize: SIZE.body, color: MUTED, marginTop: 3 },
  section: { fontSize: 7.5, letterSpacing: 1.2, color: ORANGE, fontFamily: 'Helvetica-Bold', marginTop: 16, marginBottom: 6 },

  tiles: { flexDirection: 'row', marginBottom: 6 },
  tile: { flex: 1, borderWidth: 1, borderColor: BORDER, borderRadius: 5, padding: 9, backgroundColor: TINT, marginRight: 6 },
  tileNavy: { backgroundColor: NAVY, borderColor: NAVY },
  tileLast: { marginRight: 0 },
  tileLabel: { fontSize: SIZE.label, color: MUTED, letterSpacing: 0.6, fontFamily: 'Helvetica-Bold' },
  tileLabelOnNavy: { color: '#C9D1DE' },
  tileValue: { fontSize: 15, fontFamily: 'Helvetica-Bold', marginTop: 4 },
  tileValueOnNavy: { color: WHITE },
  tileFoot: { fontSize: SIZE.label, color: MUTED, marginTop: 3 },

  row: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: BORDER, paddingVertical: 4 },
  headRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: NAVY, paddingBottom: 4 },
  th: { fontSize: SIZE.label, color: MUTED, fontFamily: 'Helvetica-Bold', letterSpacing: 0.5 },
  td: { fontSize: SIZE.cell },
  tdBold: { fontSize: SIZE.cell, fontFamily: 'Helvetica-Bold' },
  num: { textAlign: 'right' },

  note: { fontSize: SIZE.label + 0.5, color: MUTED, lineHeight: 1.45 },
  gapBox: { borderWidth: 1, borderColor: BORDER, borderRadius: 5, padding: 12, backgroundColor: TINT, marginTop: 4 },

  rep: { position: 'absolute', bottom: 44, left: 40, right: 40, flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: NAVY, paddingTop: 9 },
  repPhoto: { width: 40, height: 40, borderRadius: 20, marginRight: 10, objectFit: 'cover' },
  repName: { fontSize: 11, fontFamily: 'Helvetica-Bold' },
  repLine: { fontSize: SIZE.label + 1, color: MUTED, marginTop: 2 },
  repRight: { marginLeft: 'auto', alignItems: 'flex-end' },

  foot: { position: 'absolute', bottom: 20, left: 40, right: 40, flexDirection: 'row', justifyContent: 'space-between', paddingTop: 5, borderTopWidth: 1, borderTopColor: BORDER },
  footText: { fontSize: SIZE.label, color: MUTED },
});

/** Who the leave-behind is from. The same block on every page of every report. */
export interface RepBlock {
  name: string;
  title: string | null;
  phone: string | null;
  email: string | null;
  /** A data URI loaded from OUR storage, or null — never a placeholder. */
  photo: string | null;
}

/**
 * The branded rep, identical on every page of all three reports.
 *
 * A rep with no photo gets the block without one — never a silhouette. The
 * customer service and open orders lines are the same on all three; legacy
 * varied them per report for no reason.
 */
export function RepFooter({ rep }: { rep: RepBlock }) {
  const contact = [rep.phone, rep.email].filter((v): v is string => !!v && v.trim() !== '').join(' · ');
  return (
    <View style={f.rep} fixed>
      {rep.photo
        // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf <Image> is a PDF primitive, not a DOM <img>; it has no alt prop
        ? <Image src={rep.photo} style={f.repPhoto} />
        : null}
      <View>
        <Text style={f.repName}>{rep.name}</Text>
        {rep.title ? <Text style={f.repLine}>{rep.title}</Text> : null}
        {contact ? <Text style={f.repLine}>{contact}</Text> : null}
      </View>
      <View style={f.repRight}>
        <Text style={f.repLine}>Pacific Coast Title Company</Text>
        <Text style={f.repLine}>{CUSTOMER_SERVICE}</Text>
        <Text style={f.repLine}>{OPEN_ORDERS}</Text>
      </View>
    </View>
  );
}

/**
 * One page of a farming report: the navy masthead, the content, the rep block
 * and the page footer. Page numbers are passed in, as in the profile, so a
 * multi-page report states its own length.
 */
export function FarmPage({ kicker, source, templateVersion, rep, page, total, children }: {
  kicker: string;
  /** What the figures came from — printed in the footer of every page. */
  source: string;
  templateVersion: string;
  rep: RepBlock;
  page: number;
  total: number;
  children: React.ReactNode;
}) {
  return (
    <Page size="LETTER" style={f.page}>
      <View style={f.bar}>
        <Text style={f.brand}>PACIFIC COAST TITLE</Text>
        <Text style={f.kicker}>{kicker}</Text>
      </View>
      {children}
      <RepFooter rep={rep} />
      <View style={f.foot} fixed>
        <Text style={f.footText}>{`${source} · Template ${templateVersion}`}</Text>
        <Text style={f.footText}>{`Page ${page} of ${total}`}</Text>
      </View>
    </Page>
  );
}

/** A rendered absence, with the reason. Never an empty space, never a zero. */
export function Absent({ what, why }: { what: string; why: string }) {
  return (
    <View style={f.gapBox}>
      <Text style={{ fontSize: SIZE.body, fontFamily: 'Helvetica-Bold' }}>{what} not available</Text>
      <Text style={[f.note, { marginTop: 3 }]}>{why}</Text>
    </View>
  );
}

export interface TileSpec { label: string; value: string; foot?: string }

/** A row of tiles. `navy` fills them; otherwise they are tinted. */
export function TileRow({ tiles, navy = false }: { tiles: TileSpec[]; navy?: boolean }) {
  return (
    <View style={f.tiles}>
      {tiles.map((t, i) => (
        <View key={t.label} style={[f.tile, navy ? f.tileNavy : {}, i === tiles.length - 1 ? f.tileLast : {}]}>
          <Text style={[f.tileLabel, navy ? f.tileLabelOnNavy : {}]}>{t.label}</Text>
          <Text style={[f.tileValue, navy ? f.tileValueOnNavy : {}]}>{t.value}</Text>
          {t.foot ? <Text style={[f.tileFoot, navy ? f.tileLabelOnNavy : {}]}>{t.foot}</Text> : null}
        </View>
      ))}
    </View>
  );
}

/**
 * What the file gave us, in one line — so a thin report explains itself and a
 * dropped row is a number on the page rather than a silence.
 */
export function dataQualityLine(q: DataQuality): string {
  const read = `${fmt.numf(q.rowsRead)} rows read · ${fmt.numf(q.used)} used`;
  if (q.rejected === 0) return read;
  const why = Object.entries(q.rejectedTypes)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([k, n]) => `${k} (${fmt.numf(n)})`)
    .join(', ');
  return `${read} · ${fmt.numf(q.rejected)} could not be used: ${why}`;
}

/** 0.4123 → "41%". A share, not a count; GAP when unknown. */
export function share(v: number | null): string {
  return v === null ? GAP : fmt.numf(Math.round(v * 100), '%');
}

/** A generation date the way the page prints it: "21 September 2026". */
export function printedDate(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}
