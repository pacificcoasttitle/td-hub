// Round-tripping the My Clients list state through the profile page.
//
// Clicking a row used to open a drawer, so the list never went anywhere. Now it
// navigates, and losing the rep's search, filters, page and scroll on every
// click would make triage worse, not better — the whole point of the row
// signals is to work a list top to bottom.
//
// Filters live in the query string (so Back, refresh and a pasted link all
// rebuild the same list) and scroll lives in sessionStorage (a pixel offset is
// not meaningful in a URL, and should not survive being shared).

export interface ListState {
  search: string;
  type: string;
  quietOnly: boolean;
  page: number;
  repId: number | null;
}

export const EMPTY_LIST_STATE: ListState = {
  search: '',
  type: '',
  quietOnly: false,
  page: 1,
  repId: null,
};

/** Only non-default values are written, so a clean list has a clean URL. */
export function encodeListState(state: ListState): string {
  const p = new URLSearchParams();
  if (state.search) p.set('q', state.search);
  if (state.type) p.set('type', state.type);
  if (state.quietOnly) p.set('quiet', '1');
  if (state.page > 1) p.set('page', String(state.page));
  if (state.repId !== null) p.set('rep', String(state.repId));
  return p.toString();
}

export function decodeListState(query: string): ListState {
  const p = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query);
  const page = Number(p.get('page'));
  const rep = p.get('rep');
  const repId = rep !== null && Number.isInteger(Number(rep)) ? Number(rep) : null;
  return {
    search: p.get('q') ?? '',
    type: p.get('type') ?? '',
    quietOnly: p.get('quiet') === '1',
    page: Number.isInteger(page) && page > 1 ? page : 1,
    repId,
  };
}

const SCROLL_KEY = 'crm:clients:scroll';

export function rememberScroll(y: number): void {
  try { sessionStorage.setItem(SCROLL_KEY, String(Math.round(y))); } catch { /* private mode */ }
}

/** Reads and clears — a restored scroll should not apply again on a later visit. */
export function takeRememberedScroll(): number | null {
  try {
    const raw = sessionStorage.getItem(SCROLL_KEY);
    if (raw === null) return null;
    sessionStorage.removeItem(SCROLL_KEY);
    const y = Number(raw);
    return Number.isFinite(y) && y >= 0 ? y : null;
  } catch {
    return null;
  }
}

/** The href a row links to, carrying the list state for the Back link. */
export function profileHref(clientId: number, state: ListState): string {
  const back = encodeListState(state);
  const p = new URLSearchParams();
  if (back) p.set('back', back);
  if (state.repId !== null) p.set('repId', String(state.repId));
  const qs = p.toString();
  return `/sales/clients/${clientId}${qs ? `?${qs}` : ''}`;
}
