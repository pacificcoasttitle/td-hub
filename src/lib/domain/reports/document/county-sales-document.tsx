import React from 'react';
import { Document, Text, View } from '@react-pdf/renderer';
import { COUNTY_MEDIAN_NOTE } from '../definitions';
import {
  CITIES_PER_PAGE, monthLabel,
  type CountyCity, type CountySalesFigures, type DataQuality, type KindFigures,
} from '../compute';
import type { PropertyKind } from '../datasets';
import {
  Absent, FarmPage, GAP, NAVY, ORANGE, WHITE, dataQualityLine, f, fmt, printedDate, type RepBlock,
} from './family';

// ─── 03 · County Sales ──────────────────────────────────────────────────────
//
// Multi-page: 22 cities a page, alphabetical as a reader means it, houses and
// condominiums side by side, and a county total on the last page.
//
// THE DEFECT FIXED, NOT PORTED. Legacy's column said Median and computed the
// mean. The label was right, so the maths changed — and the county total is a
// median of every sale in the county, never a median of the city figures.
//
// A city with no condominium sales prints an em dash, not a zero: an absence
// rendered, not filled.

export const TEMPLATE_VERSION = 'cs-v1';

export interface CountySalesDocInput {
  /** "Orange" — printed as "Orange County". */
  county: string;
  /** `YYYY-MM` of the month the file covers. */
  monthKey: string;
  figures: CountySalesFigures;
  quality: DataQuality;
  rep: RepBlock;
  generatedAt: Date;
}

const KIND_WORD: Record<PropertyKind, string> = {
  single_family: 'houses', condominium: 'condominiums', multi_family: 'multi-family', land: 'land', other: 'other',
};

// City column, then two groups of (sold, median price). Flex values are shared
// by the group header and the rows so the two cannot drift apart.
const CITY = 2.4;
const SOLD = 0.8;
const PRICE = 1.4;
const GROUP = SOLD + PRICE;

const soldText = (k: KindFigures) => (k.sold > 0 ? fmt.numf(k.sold) : GAP);
const priceText = (k: KindFigures) => (k.sold > 0 ? fmt.money(k.medianPrice) : GAP);

function GroupHeader() {
  const band = (label: string, color: string, last: boolean) => (
    <View style={{ flex: GROUP, backgroundColor: color, paddingVertical: 4, paddingHorizontal: 6, marginRight: last ? 0 : 4, borderRadius: 3 }}>
      <Text style={{ fontSize: 7.5, color: WHITE, fontFamily: 'Helvetica-Bold', letterSpacing: 1 }}>{label}</Text>
    </View>
  );
  return (
    <View style={{ flexDirection: 'row', marginBottom: 4 }}>
      <View style={{ flex: CITY }} />
      {band('HOUSES', NAVY, false)}
      {band('CONDOMINIUMS', ORANGE, true)}
    </View>
  );
}

function ColumnHeader() {
  return (
    <View style={f.headRow}>
      <Text style={[f.th, { flex: CITY }]}>CITY</Text>
      <Text style={[f.th, f.num, { flex: SOLD }]}>SOLD</Text>
      <Text style={[f.th, f.num, { flex: PRICE, paddingRight: 6 }]}>MEDIAN PRICE</Text>
      <Text style={[f.th, f.num, { flex: SOLD }]}>SOLD</Text>
      <Text style={[f.th, f.num, { flex: PRICE }]}>MEDIAN PRICE</Text>
    </View>
  );
}

function CityRow({ c, total = false }: { c: CountyCity; total?: boolean }) {
  const cell = total ? f.tdBold : f.td;
  return (
    <View style={[f.row, total ? { borderBottomColor: NAVY, borderTopWidth: 1, borderTopColor: NAVY, backgroundColor: '#F8F9FA' } : {}]}>
      <Text style={[total ? f.tdBold : f.tdBold, { flex: CITY }]}>{c.city}</Text>
      <Text style={[cell, f.num, { flex: SOLD }]}>{soldText(c.houses)}</Text>
      <Text style={[cell, f.num, { flex: PRICE, paddingRight: 6 }]}>{priceText(c.houses)}</Text>
      <Text style={[cell, f.num, { flex: SOLD }]}>{soldText(c.condos)}</Text>
      <Text style={[cell, f.num, { flex: PRICE }]}>{priceText(c.condos)}</Text>
    </View>
  );
}

/** "14 sales of other property types — multi-family 9, land 5 — ..." or null. */
export function otherKindsLine(other: CountySalesFigures['otherKinds']): string | null {
  const entries = Object.entries(other).filter(([, n]) => (n ?? 0) > 0) as Array<[PropertyKind, number]>;
  if (entries.length === 0) return null;
  const n = entries.reduce((a, [, c]) => a + c, 0);
  const parts = entries.sort((a, b) => b[1] - a[1]).map(([k, c]) => `${KIND_WORD[k]} ${fmt.numf(c)}`).join(', ');
  return `${fmt.numf(n)} ${n === 1 ? 'sale' : 'sales'} of other property types (${parts}) ${n === 1 ? 'is' : 'are'} in the file but have no column on this report, so ${n === 1 ? 'it is' : 'they are'} not in the figures above.`;
}

export function CountySalesDocument(input: CountySalesDocInput) {
  const { figures: { cities, totals, otherKinds }, quality } = input;
  const title = `${input.county} County`;
  const sub = `Home sales · ${monthLabel(input.monthKey)} · ${fmt.numf(cities.length)} ${cities.length === 1 ? 'city' : 'cities'} · Prepared ${printedDate(input.generatedAt)}`;

  const pages: CountyCity[][] = [];
  for (let i = 0; i < cities.length; i += CITIES_PER_PAGE) pages.push(cities.slice(i, i + CITIES_PER_PAGE));
  const total = Math.max(1, pages.length);
  const other = otherKindsLine(otherKinds);

  const shell = (page: number, children: React.ReactNode) => (
    <FarmPage
      key={page}
      kicker="COUNTY SALES"
      source="Pacific Coast Title Company · Sales data as supplied"
      templateVersion={TEMPLATE_VERSION}
      rep={input.rep}
      page={page}
      total={total}
    >
      <Text style={f.h1}>{title}</Text>
      <Text style={f.sub}>{sub}</Text>
      {children}
    </FarmPage>
  );

  return (
    <Document title={`County Sales — ${title}, ${monthLabel(input.monthKey)}`} author="Pacific Coast Title Company">
      {pages.length === 0
        ? shell(1, (
          <Absent
            what="City sales"
            why={`No house or condominium sale in the file could be read. ${dataQualityLine(quality)}.`}
          />
        ))
        : pages.map((chunk, i) => shell(i + 1, (
          <>
            <View style={{ marginTop: 16 }}>
              <GroupHeader />
              <ColumnHeader />
              {chunk.map((c) => <CityRow key={c.city} c={c} />)}
              {i === pages.length - 1 ? (
                <CityRow total c={{ city: `${input.county} County total`, houses: totals.houses, condos: totals.condos }} />
              ) : null}
            </View>

            {i === pages.length - 1 ? (
              <View style={{ marginTop: 10 }}>
                <Text style={f.note}>{COUNTY_MEDIAN_NOTE}</Text>
                <Text style={f.note}>
                  The county total is the median of every sale in the county, not of the city figures above.
                </Text>
                {other ? <Text style={f.note}>{other}</Text> : null}
                <Text style={f.note}>{dataQualityLine(quality)}</Text>
              </View>
            ) : (
              <Text style={[f.note, { marginTop: 8 }]}>Continued on the next page.</Text>
            )}
          </>
        )))}
    </Document>
  );
}
