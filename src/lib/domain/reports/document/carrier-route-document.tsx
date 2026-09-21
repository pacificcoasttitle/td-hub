import React from 'react';
import { Document, Text, View } from '@react-pdf/renderer';
import { ROUTE_AVERAGE_NOTE, ROUTE_COLUMN_DEFINITIONS, ROUTE_STANDOUT_NOTE } from '../definitions';
import {
  RANK_LABEL, type CarrierRouteFigures, type DataQuality, type RankBy, type Standout,
} from '../compute';
import type { RouteRow } from '../datasets';
import {
  Absent, FarmPage, GAP, NAVY, TileRow, dataQualityLine, f, fmt, printedDate, type RepBlock, type TileSpec,
} from './family';

// ─── 02 · Carrier Route Analysis ────────────────────────────────────────────
//
// One Letter page: six standouts, then the ten routes ranked by the measure
// the preparer chose.
//
// Two decisions the page carries in words, not only in code:
//   - PRICE AND YEARS HELD ARE AVERAGES. The route feed is pre-aggregated and
//     the underlying sales are not in it, so a median cannot be computed. The
//     label comes down to the data (definitions.ts).
//   - EACH STANDOUT IS THE BEST OF THE TEN SHOWN, and each names the route that
//     won ITS OWN measure. Legacy's non-owner tile printed the turnover winner's
//     route beside the non-owner figure.

export const TEMPLATE_VERSION = 'cr-v1';

export interface CarrierRouteDocInput {
  areaName: string;
  rankBy: RankBy;
  figures: CarrierRouteFigures;
  quality: DataQuality;
  rep: RepBlock;
  generatedAt: Date;
}

/**
 * Rates and years at ONE decimal, always. fmt.numf drops a trailing zero, so a
 * column read 8.6%, 8.1%, 7.5%, 7%, 6.4% — the one whole number looking like a
 * different kind of figure.
 */
export const oneDecimal = (v: number | null, suffix = '') =>
  (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(1) + suffix : GAP);
const pct = (v: number | null) => oneDecimal(v, '%');
const yrs = (v: number | null) => oneDecimal(v, ' yrs');

function standoutTile(label: string, s: Standout | null, show: (v: number) => string): TileSpec {
  return s
    ? { label, value: show(s.value), foot: `Route ${s.routeId}` }
    : { label, value: GAP, foot: 'No route shown carries this figure' };
}

/** Column key → how the table prints it, so the ranked column can be marked. */
const COLS: Array<{ key: RankBy | 'route' | 'rank'; head: string; flex: number; cell: (r: RouteRow, i: number) => string }> = [
  { key: 'rank', head: '#', flex: 0.35, cell: (_r, i) => String(i + 1) },
  { key: 'route', head: 'ROUTE', flex: 1.5, cell: (r) => r.routeId },
  { key: 'turnover', head: 'TURNOVER', flex: 1, cell: (r) => pct(r.turnoverRate) },
  { key: 'non_owner', head: 'NON-OWNER', flex: 1, cell: (r) => pct(r.nonOwnerRatio) },
  { key: 'years_held', head: 'AVG YRS HELD', flex: 1.1, cell: (r) => oneDecimal(r.avgYearsOwned) },
  { key: 'units', head: 'UNITS', flex: 0.8, cell: (r) => fmt.numf(r.totalUnits) },
  { key: 'sales', head: 'SALES', flex: 0.8, cell: (r) => fmt.numf(r.totalSales) },
  { key: 'price', head: 'AVG PRICE', flex: 1.3, cell: (r) => fmt.money(r.avgPrice) },
];

export function CarrierRouteDocument(input: CarrierRouteDocInput) {
  const { figures: { routes, totalRoutes, standouts: s }, quality } = input;
  const ranking = RANK_LABEL[input.rankBy];

  return (
    <Document title={`Carrier Route Analysis — ${input.areaName}`} author="Pacific Coast Title Company">
      <FarmPage
        kicker="CARRIER ROUTE ANALYSIS"
        source="Pacific Coast Title Company · Route figures as supplied by the source data"
        templateVersion={TEMPLATE_VERSION}
        rep={input.rep}
        page={1}
        total={1}
      >
        <Text style={f.h1}>{input.areaName}</Text>
        <Text style={f.sub}>
          {`Top ${routes.length} of ${fmt.numf(totalRoutes)} carrier routes · ranked by ${ranking} · Prepared ${printedDate(input.generatedAt)}`}
        </Text>

        {routes.length === 0 ? (
          <Absent
            what="Carrier routes"
            why={`The file held no route that could be read. ${dataQualityLine(quality)}.`}
          />
        ) : (
          <>
            <Text style={f.section}>STANDOUTS AMONG THE ROUTES SHOWN</Text>
            <TileRow tiles={[
              standoutTile('FASTEST TURNOVER', s.turnover, (v) => pct(v)),
              standoutTile('MOST NON-OWNER OCCUPIED', s.nonOwner, (v) => pct(v)),
              standoutTile('LONGEST AVERAGE HOLD', s.yearsHeld, (v) => yrs(v)),
            ]} />
            <TileRow tiles={[
              standoutTile('LARGEST MAIL DROP', s.units, (v) => `${fmt.numf(v)} units`),
              standoutTile('MOST SALES', s.sales, (v) => fmt.numf(v)),
              standoutTile('HIGHEST AVERAGE PRICE', s.price, (v) => fmt.moneyShort(v)),
            ]} />
            <Text style={f.note}>{ROUTE_STANDOUT_NOTE}</Text>

            <Text style={f.section}>{`TOP ${routes.length} ROUTES BY ${ranking.toUpperCase()}`}</Text>
            <View style={f.headRow}>
              {COLS.map((c) => (
                <Text
                  key={c.key}
                  style={[f.th, { flex: c.flex }, c.key === 'route' || c.key === 'rank' ? {} : f.num,
                    // The ranking column is marked in navy, so the order of the
                    // table explains itself. Not with an arrow glyph: ▼ is not
                    // in Helvetica's encoding and would silently vanish.
                    c.key === input.rankBy ? { color: NAVY } : {}]}
                >
                  {c.head}
                </Text>
              ))}
            </View>
            {routes.map((r, i) => (
              <View key={r.routeId} style={f.row}>
                {COLS.map((c) => (
                  <Text
                    key={c.key}
                    style={[c.key === 'route' || c.key === input.rankBy ? f.tdBold : f.td, { flex: c.flex },
                      c.key === 'route' || c.key === 'rank' ? {} : f.num]}
                  >
                    {c.cell(r, i)}
                  </Text>
                ))}
              </View>
            ))}

            <View style={{ marginTop: 10 }}>
              {ROUTE_COLUMN_DEFINITIONS.map((d) => (
                <Text key={d.term} style={f.note}>
                  <Text style={{ fontFamily: 'Helvetica-Bold' }}>{`${d.term}. `}</Text>
                  {d.meaning}
                </Text>
              ))}
              <Text style={[f.note, { marginTop: 4 }]}>{ROUTE_AVERAGE_NOTE}</Text>
              <Text style={f.note}>{dataQualityLine(quality)}</Text>
            </View>
          </>
        )}
      </FarmPage>
    </Document>
  );
}
