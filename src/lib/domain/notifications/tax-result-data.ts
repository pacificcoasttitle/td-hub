import type { ConfirmationTaxData, TaxInstallment } from './confirmation-template';

/**
 * Parse TitlePoint tax GetResultByID3 payload (stored at
 * title_point_data.metadata.resultData during OC-1 pre-init / fetchResult).
 * Independent of the tax PDF — used for the confirmation email body.
 */
export function parseTaxResultData(resultData: unknown): ConfirmationTaxData | null {
  if (!resultData || typeof resultData !== 'object' || Array.isArray(resultData)) {
    return null;
  }

  const rd = resultData as Record<string, unknown>;
  const report = asObject(rd, 'TaxReport', 'taxReport') ?? rd;

  const data: ConfirmationTaxData = {
    taxRateArea: asString(report, 'TaxRateArea', 'taxRateArea'),
    useCode: asString(report, 'UseCode', 'useCode'),
    regionCode: asString(report, 'RegionCode', 'regionCode'),
    floodZone: asString(report, 'FloodZone', 'floodZone'),
    zoningCode: asString(report, 'ZoningCode', 'zoningCode'),
    taxRate: asString(report, 'TaxRate', 'taxRate'),
    issueDate: asString(report, 'IssueDate', 'issueDate'),
    landValue: asString(report, 'LandValue', 'landValue', 'LandValuation', 'landValuation'),
    improvementsValue: asString(
      report,
      'ImprovementsValue',
      'improvementsValue',
      'ImprovementsValuation',
      'improvementsValuation',
    ),
    firstInstallment: normalizeInstallment(
      pickInstallment(report, '1st') ?? asObject(report, 'FirstInstallment', 'firstInstallment'),
    ),
    secondInstallment: normalizeInstallment(
      pickInstallment(report, '2nd') ?? asObject(report, 'SecondInstallment', 'secondInstallment'),
    ),
  };

  if (!hasAnyTaxField(data)) return null;
  return data;
}

export function hasAnyTaxField(data: ConfirmationTaxData): boolean {
  return Boolean(
    data.taxRateArea
    || data.useCode
    || data.regionCode
    || data.floodZone
    || data.zoningCode
    || data.taxRate
    || data.issueDate
    || data.landValue
    || data.improvementsValue
    || data.firstInstallment
    || data.secondInstallment,
  );
}

function normalizeInstallment(raw: Record<string, unknown> | null): TaxInstallment | null {
  if (!raw) return null;
  const amount = asString(raw, 'amount', 'Amount');
  const balance = asString(raw, 'balance', 'Balance');
  const dueDate = asString(raw, 'dueDate', 'DueDate', 'due_date');
  const status = asString(raw, 'status', 'Status');
  if (!amount && !balance && !dueDate && !status) return null;
  return { amount, balance, dueDate, status };
}

function pickInstallment(
  taxReport: Record<string, unknown>,
  ordinal: '1st' | '2nd',
): Record<string, unknown> | null {
  const installments = asObject(taxReport, 'Installments', 'installments');
  if (!installments) return null;

  const rawItems = installments.Item ?? installments.items;
  const items = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];
  const match = items.find((item) => {
    if (!item || typeof item !== 'object') return false;
    const number = asString(item as Record<string, unknown>, 'Number', 'number');
    return number === ordinal;
  });

  return match && typeof match === 'object' && !Array.isArray(match)
    ? (match as Record<string, unknown>)
    : null;
}

function asString(obj: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return null;
}

function asObject(o: Record<string, unknown>, ...keys: string[]): Record<string, unknown> | null {
  for (const k of keys) {
    const v = o[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  }
  return null;
}
