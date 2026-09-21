import React from 'react';
import { Document, Text, View } from '@react-pdf/renderer';
import { AREA_MEDIAN_NOTE } from '../definitions';
import { monthLabel, type DataQuality, type SalesActivityFigures } from '../compute';
import {
  Absent, FarmPage, GAP, TileRow, dataQualityLine, f, fmt, printedDate, share, type RepBlock,
} from './family';

// ─── 01 · Sales Activity ────────────────────────────────────────────────────
//
// One Letter page: six headline tiles, then the window month by month, newest
// first. Every price is a TRUE median; $/sq ft is the median of each home's
// own rate. Change is against the previous month in the window, never year
// over year, and the oldest month has none.
//
// TEMPLATE_VERSION is stamped on every generated row; bump it on any layout
// change so an old PDF stays tied to the template that made it.

export const TEMPLATE_VERSION = 'sa-v1';

export interface SalesActivityDocInput {
  areaName: string;
  /** As STATED by whoever prepared it. The sales file has no type column. */
  propertyType: string | null;
  windowMonths: number;
  /** `YYYY-MM` of the last month in the window. */
  windowEndKey: string;
  figures: SalesActivityFigures;
  quality: DataQuality;
  rep: RepBlock;
  generatedAt: Date;
}

/**
 * +3.0% / -1.2% / 0.0%. One decimal; GAP where there is no change to state.
 *
 * THE MINUS IS ASCII. The typographic minus (U+2212) is not in the standard
 * Helvetica encoding, and react-pdf drops a glyph it cannot encode WITHOUT
 * ERROR — the first render printed three monthly declines as "3.2%", "3.9%",
 * "4.8%": a fall shown as an unsigned figure. A test reads the rendered PDF
 * for the sign.
 */
export function changeText(v: number | null): string {
  if (v === null) return GAP;
  const r = Math.round(v * 10) / 10;
  if (r === 0) return '0.0%';
  return `${r > 0 ? '+' : '-'}${Math.abs(r).toFixed(1)}%`;
}

const COLS: Array<[string, number, boolean]> = [
  ['MONTH', 2.2, false], ['SALES', 0.9, true], ['MEDIAN PRICE', 1.5, true],
  ['MEDIAN $ / SQ FT', 1.4, true], ['CHANGE', 1, true],
];

export function SalesActivityDocument(input: SalesActivityDocInput) {
  const { figures: { metrics: m, months }, quality } = input;
  const windowLine = `${input.windowMonths} months to ${monthLabel(input.windowEndKey)}`;
  const firstKey = months[months.length - 1]?.key ?? input.windowEndKey;

  return (
    <Document title={`Sales Activity — ${input.areaName}`} author="Pacific Coast Title Company">
      <FarmPage
        kicker="SALES ACTIVITY"
        source="Pacific Coast Title Company · Sales data as supplied"
        templateVersion={TEMPLATE_VERSION}
        rep={input.rep}
        page={1}
        total={1}
      >
        <Text style={f.h1}>{input.areaName}</Text>
        <Text style={f.sub}>
          {[input.propertyType, windowLine, `Prepared ${printedDate(input.generatedAt)}`].filter(Boolean).join(' · ')}
        </Text>

        {m.homesSold === 0 ? (
          <Absent
            what="Sales in this window"
            why={`The file held ${fmt.numf(quality.used)} usable sales and none were dated between ${monthLabel(firstKey)} and ${monthLabel(input.windowEndKey)}. No figure has been estimated.`}
          />
        ) : (
          <>
            <Text style={f.section}>THE MARKET</Text>
            <TileRow navy tiles={[
              { label: 'HOMES SOLD', value: fmt.numf(m.homesSold) },
              { label: 'MEDIAN SALE PRICE', value: fmt.money(m.medianPrice) },
              { label: 'MEDIAN $ / SQ FT', value: fmt.money(m.medianPricePerSqft) },
            ]} />
            <TileRow tiles={[
              { label: 'TYPICAL BEDROOMS', value: fmt.numf(m.medianBeds) },
              { label: 'TYPICAL BATHROOMS', value: fmt.numf(m.medianBaths) },
              {
                label: 'OWNED BY NON-OCCUPANTS',
                value: share(m.nonOccupantShare),
                // Says what the share is OF when some sales did not record it.
                foot: m.occupancyKnown < m.homesSold
                  ? `of the ${fmt.numf(m.occupancyKnown)} sales that record occupancy`
                  : undefined,
              },
            ]} />

            <Text style={f.section}>MONTH BY MONTH</Text>
            <View style={f.headRow}>
              {COLS.map(([h, flex, right]) => (
                <Text key={h} style={[f.th, { flex }, right ? f.num : {}]}>{h}</Text>
              ))}
            </View>
            {months.map((mo) => (
              <View key={mo.key} style={f.row}>
                <Text style={[f.tdBold, { flex: 2.2 }]}>{monthLabel(mo.key)}</Text>
                <Text style={[f.td, f.num, { flex: 0.9 }]}>{fmt.numf(mo.sales)}</Text>
                <Text style={[f.td, f.num, { flex: 1.5 }]}>{fmt.money(mo.medianPrice)}</Text>
                <Text style={[f.td, f.num, { flex: 1.4 }]}>{fmt.money(mo.medianPricePerSqft)}</Text>
                <Text style={[f.td, f.num, { flex: 1 }]}>{changeText(mo.changePct)}</Text>
              </View>
            ))}
          </>
        )}

        <View style={{ marginTop: 10 }}>
          <Text style={f.note}>{AREA_MEDIAN_NOTE}</Text>
          <Text style={f.note}>
            Change compares each month&apos;s median price per square foot with the month before it, not with the same month a year earlier.
          </Text>
          {input.propertyType ? (
            <Text style={f.note}>
              {`"${input.propertyType}" is as stated when this report was prepared. The sales file carries no property type, so it was not used to filter the sales.`}
            </Text>
          ) : null}
          {m.outsideWindow > 0 ? (
            <Text style={f.note}>
              {`${fmt.numf(m.outsideWindow)} ${m.outsideWindow === 1 ? 'sale' : 'sales'} in the file fell outside this window and ${m.outsideWindow === 1 ? 'is' : 'are'} not counted.`}
            </Text>
          ) : null}
          <Text style={f.note}>{dataQualityLine(quality)}</Text>
        </View>
      </FarmPage>
    </Document>
  );
}
