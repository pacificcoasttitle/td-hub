'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

export interface ContactResult {
  id: number;
  fullName?: string;
  companyName?: string;
  email?: string;
  phone?: string;
  contactType?: string;
}

export function useContactSearch(spType?: string, maxResults = 10) {
  const [results, setResults] = useState<ContactResult[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const debRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function click(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener('mousedown', click);
    return () => document.removeEventListener('mousedown', click);
  }, []);

  const search = useCallback((query: string) => {
    clearTimeout(debRef.current);
    if (query.length < 2) { setResults([]); setOpen(false); return; }
    debRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const localRes = await fetch(`/api/contacts/search?q=${encodeURIComponent(query)}`);
        const localData = localRes.ok ? await localRes.json() : { results: [] };
        let merged: ContactResult[] = localData.results ?? localData.contacts ?? [];

        if (merged.length < 3 && spType) {
          try {
            const spRes = await fetch(`/api/softpro/lookup?userType=${spType}&q=${encodeURIComponent(query)}`);
            const spData = spRes.ok ? await spRes.json() : { results: [] };
            const existing = new Set(merged.map(m => m.email?.toLowerCase()).filter(Boolean));
            const extras = ((spData.results ?? []) as ContactResult[])
              .filter(r => !existing.has(r.email?.toLowerCase() ?? ''));
            merged = [...merged, ...extras].slice(0, maxResults);
          } catch { /* SoftPro fallback is best-effort */ }
        }

        setResults(merged);
        setOpen(true);
      } catch { /* noop */ }
      finally { setSearching(false); }
    }, 250);
  }, [spType, maxResults]);

  const close = useCallback(() => setOpen(false), []);

  return { results, open, searching, search, close, ref };
}
