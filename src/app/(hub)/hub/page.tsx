'use client';

import { useEffect, useState } from 'react';
import { HubTableView } from '@/components/hub/hub-table-view';
import { OrdersSplitView } from '@/components/hub/split/orders-split-view';

// ─── /hub — layout mode switch ───────────────────────────────────────────────
//
// Split view is a mode, not a replacement. The full-width table stays, reads
// the same data and fires the same actions; the choice is remembered against
// the signed-in user rather than the browser, so two people sharing a machine
// do not inherit each other's layout.

type Layout = 'split' | 'table';

const DEFAULT_LAYOUT: Layout = 'split';

export default function HubPage() {
  const [userKey, setUserKey] = useState<string | null>(null);
  // Both conditions come from the SERVER. The UI hides what the server would
  // refuse rather than deciding for itself — a client-side role check is
  // decoration, and a client-side feature flag is worse.
  const [conciergeAccess, setConciergeAccess] = useState({ canGenerate: false, featureOn: false });
  const [layout, setLayout] = useState<Layout | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/session')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { id?: string; email?: string } | null) => {
        if (cancelled) return;
        const key = d?.id ?? d?.email ?? 'anon';
        setUserKey(key);
        const saved = window.localStorage.getItem(layoutKey(key));
        setLayout(saved === 'split' || saved === 'table' ? saved : DEFAULT_LAYOUT);
      })
      .catch(() => {
        if (!cancelled) { setUserKey('anon'); setLayout(DEFAULT_LAYOUT); }
      });
    fetch('/api/concierge/access')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { canGenerate: boolean; featureOn: boolean } | null) => {
        if (!cancelled && d) setConciergeAccess(d);
      })
      .catch(() => {});

    return () => { cancelled = true; };
  }, []);

  function choose(next: Layout) {
    if (userKey) window.localStorage.setItem(layoutKey(userKey), next);
    setLayout(next);
  }

  // Render nothing rather than the wrong layout for a frame: the split view
  // mounts a 100-row fetch, and flashing it at someone who chose the table is
  // both jarring and wasteful.
  if (layout === null || userKey === null) return <div className="h-full bg-white" />;

  return layout === 'split'
    ? <OrdersSplitView userKey={userKey} onSwitchToTable={() => choose('table')} conciergeAccess={conciergeAccess} />
    : <HubTableView onSwitchToSplit={() => choose('split')} />;
}

function layoutKey(userKey: string): string {
  return `pct.hub.layout.${userKey}`;
}
