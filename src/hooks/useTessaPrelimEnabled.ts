'use client';

import { useEffect, useState } from 'react';

// Reads the EFFECTIVE AI Prelim feature flag (admin DB flag AND env master-kill).
// Defaults to false until loaded so entry points stay hidden during the fetch —
// the feature ships dark and only appears once confirmed ON.
export function useTessaPrelimEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    fetch('/api/settings/tessa-prelim', { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((d: { enabled?: boolean }) => setEnabled(d.enabled === true))
      .catch(() => { /* stay hidden on error */ });
    return () => ac.abort();
  }, []);

  return enabled;
}
