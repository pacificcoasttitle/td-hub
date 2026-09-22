'use client';

import { RANK_BY, RANK_LABEL, type RankBy } from '@/lib/domain/reports/compute';
import {
  FARMING_COUNTIES, FARMING_WINDOWS, PROPERTY_TYPE_CHOICES, type FarmingWindow,
} from '@/lib/domain/reports/options';

// ─── Step two for the three farming reports ─────────────────────────────────
//
// A file, the handful of choices that shape the report, and the rep whose name
// goes on it. No cost gate: a farming report spends nothing.
//
// Everything this form decides is in pure functions below — what is missing,
// and exactly what gets posted — so both are tested without a browser. The
// server decides again; this only stops an operator waiting on a request that
// was always going to be refused.

export type FarmingType = 'sales_activity' | 'carrier_route' | 'county_sales';

export function isFarming(t: string | null): t is FarmingType {
  return t === 'sales_activity' || t === 'carrier_route' || t === 'county_sales';
}

export interface FarmingDraft {
  file: File | null;
  areaName: string;
  /** '' means none stated. */
  propertyType: string;
  windowMonths: FarmingWindow;
  /** `YYYY-MM`. */
  windowEnd: string;
  rankBy: RankBy;
  county: string;
  /** `YYYY-MM`. */
  month: string;
  repContactId: number | null;
  repName: string;
}

/** The last COMPLETE month: a report run on 21 September covers August. */
export function lastCompleteMonth(now: Date = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function emptyFarmingDraft(now: Date = new Date()): FarmingDraft {
  const m = lastCompleteMonth(now);
  return {
    file: null, areaName: '', propertyType: '', windowMonths: 6, windowEnd: m,
    rankBy: 'turnover', county: '', month: m, repContactId: null, repName: '',
  };
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** What is still missing, in the words the operator needs. Null means ready. */
export function farmingProblem(type: FarmingType, d: FarmingDraft): string | null {
  if (!d.file) return 'Choose the CSV file to build the report from.';
  if (!/\.csv$/i.test(d.file.name)) return 'The file must be a CSV. Save the spreadsheet as CSV and upload that.';
  if ((type === 'sales_activity' || type === 'carrier_route') && !d.areaName.trim()) return 'Enter the area name.';
  if (type === 'sales_activity' && !MONTH.test(d.windowEnd)) return 'Choose the last month of the window.';
  if (type === 'county_sales' && !(FARMING_COUNTIES as readonly string[]).includes(d.county)) return 'Choose the county.';
  if (type === 'county_sales' && !MONTH.test(d.month)) return 'Choose the month the file covers.';
  if (!d.repContactId) return 'Choose the sales representative whose name goes on the report.';
  return null;
}

/**
 * Exactly what is posted. Only the fields the report type uses — a county on a
 * route report is not ignored by accident later, it is never sent.
 */
export function farmingFormData(type: FarmingType, d: FarmingDraft): FormData {
  const f = new FormData();
  f.set('type', type);
  if (d.file) f.set('file', d.file);
  f.set('brandedToContactId', String(d.repContactId ?? ''));
  if (type === 'sales_activity') {
    f.set('areaName', d.areaName.trim());
    if (d.propertyType) f.set('propertyType', d.propertyType);
    f.set('windowMonths', String(d.windowMonths));
    f.set('windowEnd', d.windowEnd);
  } else if (type === 'carrier_route') {
    f.set('areaName', d.areaName.trim());
    f.set('rankBy', d.rankBy);
  } else {
    f.set('county', d.county);
    f.set('month', d.month);
  }
  return f;
}

/** Which columns the file needs, said up front — Appendix A of the guide. */
export const EXPECTED_COLUMNS: Record<FarmingType, string> = {
  sales_activity: 'Purchase Price and Purchase Date, plus Bedrooms, Baths, Building Size and Owner Occupied if present',
  carrier_route: 'carrier_route and sa_site_zip, plus the route measures: turnover_rate, NOO_ratio, avg_yr_owned, total_units, total_sales, avg_price',
  county_sales: 'Site City, Purchase Price and Property Type',
};

const input = 'w-full h-8 px-[9px] border border-[#E5E5E5] rounded-md text-[12px] outline-none focus:ring-1 focus:ring-brand-orange/30 focus:border-brand-orange bg-white';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[9.5px] font-semibold uppercase tracking-[0.09em] text-[#9AA0AA] mb-1">{label}</label>
      {children}
    </div>
  );
}

export function FarmingStep({ type, draft, problem, onField, onFile, repPicker }: {
  type: FarmingType;
  draft: FarmingDraft;
  problem: string | null;
  onField: <K extends keyof FarmingDraft>(k: K, v: FarmingDraft[K]) => void;
  onFile: (f: File | null) => void;
  repPicker: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <Field label="Source">
        <div className="space-y-1 text-[12px] text-[#171717]">
          <label className="flex items-center gap-2">
            <input type="radio" checked readOnly name="source" /> Upload a CSV
          </label>
          <label className="flex items-center gap-2 text-[#9AA0AA]">
            <input type="radio" disabled name="source" /> Pull from SiteX Farms — not connected yet
          </label>
        </div>
      </Field>

      <Field label="CSV file">
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => onFile(e.target.files?.[0] ?? null)}
          className="block w-full text-[12px] text-[#3C4557] file:mr-3 file:h-8 file:px-3 file:rounded-md file:border file:border-[#E5E5E5] file:bg-white file:text-[11.5px] file:font-semibold"
        />
        <p className="mt-1 text-[10.5px] text-[#9AA0AA]">Needs columns for {EXPECTED_COLUMNS[type]}.</p>
      </Field>

      {type !== 'county_sales' ? (
        <Field label="Area name">
          <input value={draft.areaName} onChange={(e) => onField('areaName', e.target.value)} placeholder="Santa Monica" className={input} />
        </Field>
      ) : null}

      {type === 'sales_activity' ? (
        <div className="grid grid-cols-3 gap-2">
          <Field label="Property type">
            <select value={draft.propertyType} onChange={(e) => onField('propertyType', e.target.value)} className={input}>
              <option value="">Not stated</option>
              {PROPERTY_TYPE_CHOICES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
          <Field label="Window">
            <select
              value={draft.windowMonths}
              onChange={(e) => onField('windowMonths', Number(e.target.value) as FarmingWindow)}
              className={input}
            >
              {FARMING_WINDOWS.map((w) => <option key={w} value={w}>{w} months</option>)}
            </select>
          </Field>
          <Field label="Ending">
            <input type="month" value={draft.windowEnd} onChange={(e) => onField('windowEnd', e.target.value)} className={input} />
          </Field>
        </div>
      ) : null}

      {type === 'carrier_route' ? (
        <Field label="Rank routes by">
          <select value={draft.rankBy} onChange={(e) => onField('rankBy', e.target.value as RankBy)} className={input}>
            {RANK_BY.map((r) => <option key={r} value={r}>{RANK_LABEL[r][0]!.toUpperCase() + RANK_LABEL[r].slice(1)}</option>)}
          </select>
        </Field>
      ) : null}

      {type === 'county_sales' ? (
        <div className="grid grid-cols-2 gap-2">
          <Field label="County">
            <select value={draft.county} onChange={(e) => onField('county', e.target.value)} className={input}>
              <option value="">Choose…</option>
              {FARMING_COUNTIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Month the file covers">
            <input type="month" value={draft.month} onChange={(e) => onField('month', e.target.value)} className={input} />
          </Field>
        </div>
      ) : null}

      <Field label="Sales representative">
        {repPicker}
        <p className="mt-1 text-[10.5px] text-[#9AA0AA]">Their name, phone and email go on every page of the report.</p>
      </Field>

      {problem ? <p className="text-[11.5px] text-[#B4620B]">{problem}</p> : null}
    </div>
  );
}
