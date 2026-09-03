'use client';

import { useEffect, useState } from 'react';

// Reads the effective Update Prelim flag (admin DB flag AND env backstop).
// Defaults to false until loaded so the button stays hidden during the fetch —
// it ships dark and only appears once confirmed ON.
export function useUpdatePrelimEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    fetch('/api/settings/update-prelim', { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((d: { enabled?: boolean }) => setEnabled(d.enabled === true))
      .catch(() => { /* stay hidden on error */ });
    return () => ac.abort();
  }, []);

  return enabled;
}
