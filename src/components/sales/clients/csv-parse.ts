// Small hand-rolled CSV parser for the My Clients import (spec §6, §10.10 — no
// dependency for a 4-column file). Handles quoted fields, embedded commas,
// escaped quotes (""), and CRLF/LF line endings.

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

export function parseCsv(text: string): ParsedCsv {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell); cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      rows.push(row); row = [];
    } else {
      cell += ch;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  // Drop fully-empty trailing lines (common in exported files).
  const filled = rows.filter(r => r.some(c => c.trim() !== ''));
  const [headers = [], ...body] = filled;
  return { headers: headers.map(h => h.trim()), rows: body };
}

export interface ImportRow {
  name: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
}

/** Case-insensitive header mapping; extra columns ignored (spec §6). */
export function mapCsvToImportRows(parsed: ParsedCsv): { rows: ImportRow[]; missingNameHeader: boolean } {
  const idx: Record<string, number> = {};
  parsed.headers.forEach((h, i) => { idx[h.toLowerCase()] = i; });
  const missingNameHeader = !('name' in idx);

  const pick = (row: string[], key: string): string | null => {
    const i = idx[key];
    if (i === undefined) return null;
    const v = (row[i] ?? '').trim();
    return v === '' ? null : v;
  };

  return {
    missingNameHeader,
    rows: parsed.rows.map(row => ({
      name: pick(row, 'name'),
      company: pick(row, 'company'),
      email: pick(row, 'email'),
      phone: pick(row, 'phone'),
    })),
  };
}

// Mirrors the server's triage (domain module) so the preview matches what
// commit will do. The server result remains authoritative.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type PreviewStatus = 'added' | 'skipped_duplicate' | 'error';

export interface PreviewRow {
  row: number; // 1-based, matching the server's row numbering
  status: PreviewStatus;
  message?: string;
  data: ImportRow;
}

export function previewImportRows(rows: ImportRow[], existingEmailsLower: Set<string>): PreviewRow[] {
  const seen = new Set(existingEmailsLower);
  return rows.map((data, i) => {
    const rowNum = i + 1;
    if (!data.name?.trim()) return { row: rowNum, status: 'error' as const, message: 'Missing name', data };
    const email = data.email?.trim().toLowerCase() ?? null;
    if (email && !EMAIL_RE.test(email)) {
      return { row: rowNum, status: 'error' as const, message: 'Invalid email', data };
    }
    if (email && seen.has(email)) {
      return { row: rowNum, status: 'skipped_duplicate' as const, message: 'Already in your list', data };
    }
    if (email) seen.add(email);
    return { row: rowNum, status: 'added' as const, data };
  });
}
