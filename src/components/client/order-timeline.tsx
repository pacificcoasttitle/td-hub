'use client';

import { useEffect, useState } from 'react';

interface Milestone {
  name: string;
  status: 'complete' | 'in_progress' | 'pending';
  date: string | null;
  documentId: number | null;
}

export function OrderTimeline({ orderId }: { orderId: number }) {
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    fetch(`/api/client/orders/${orderId}/timeline`, { signal: ac.signal })
      .then((r) => r.ok ? r.json() : Promise.reject('Failed to load timeline'))
      .then((d) => setMilestones(d.milestones ?? []))
      .catch((err) => {
        if (err?.name !== 'AbortError') setError(typeof err === 'string' ? err : 'Could not load timeline');
      })
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, [orderId]);

  if (loading) return <TimelineSkeleton />;

  if (error) {
    return (
      <div className="p-8 text-center">
        <p className="text-sm text-red-600 font-medium">{error}</p>
      </div>
    );
  }

  if (milestones.length === 0) {
    return (
      <div className="p-8 text-center">
        <p className="text-sm text-[#6B7280]">No milestone data available yet.</p>
      </div>
    );
  }

  return (
    <div className="px-4 py-6 sm:px-6 sm:py-8">
      <ol className="relative">
        {milestones.map((m, i) => {
          const isLast = i === milestones.length - 1;
          return (
            <li key={m.name} className="relative flex gap-4 sm:gap-5 pb-8 last:pb-0">
              {/* Connector line */}
              {!isLast && (
                <span
                  className={`absolute left-[11px] sm:left-[13px] top-6 w-0.5 ${
                    m.status === 'complete' ? 'bg-[#1B2A4A]' : 'bg-gray-200'
                  }`}
                  style={{ height: 'calc(100% - 12px)' }}
                />
              )}

              {/* Node */}
              <div className="relative flex-shrink-0 mt-0.5">
                {m.status === 'complete' ? (
                  <span className="flex h-6 w-6 sm:h-7 sm:w-7 items-center justify-center rounded-full bg-[#1B2A4A]">
                    <svg className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  </span>
                ) : m.status === 'in_progress' ? (
                  <span className="flex h-6 w-6 sm:h-7 sm:w-7 items-center justify-center rounded-full border-2 border-amber-400 bg-amber-50">
                    <span className="h-2 w-2 sm:h-2.5 sm:w-2.5 rounded-full bg-amber-400 animate-pulse" />
                  </span>
                ) : (
                  <span className="flex h-6 w-6 sm:h-7 sm:w-7 items-center justify-center rounded-full border-2 border-gray-200 bg-white">
                    <span className="h-2 w-2 sm:h-2.5 sm:w-2.5 rounded-full bg-gray-200" />
                  </span>
                )}
              </div>

              {/* Content */}
              <div className="min-w-0 flex-1 pt-0.5">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-3">
                  <p className={`text-sm font-medium ${
                    m.status === 'complete' ? 'text-[#1A1A2E]'
                    : m.status === 'in_progress' ? 'text-amber-700'
                    : 'text-[#9CA3AF]'
                  }`}>
                    {m.name}
                  </p>
                  <div className="flex items-center gap-3">
                    {m.date && (
                      <time className="text-xs text-[#6B7280] whitespace-nowrap">{formatDate(m.date)}</time>
                    )}
                    {m.documentId && m.status === 'complete' && (
                      <a
                        href={`/api/documents/${m.documentId}/download`}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-[#1B2A4A] bg-[#1B2A4A]/5 rounded-lg hover:bg-[#1B2A4A]/10 transition-colors min-h-[36px] sm:min-h-0"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                        View
                      </a>
                    )}
                  </div>
                </div>
                {m.status === 'in_progress' && (
                  <p className="text-xs text-amber-600 mt-0.5">In progress</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function TimelineSkeleton() {
  return (
    <div className="px-4 py-6 sm:px-6 sm:py-8">
      <div className="space-y-6">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="flex gap-4">
            <div className="h-6 w-6 rounded-full bg-gray-100 animate-pulse flex-shrink-0" />
            <div className="flex-1 space-y-1.5 pt-0.5">
              <div className="h-4 bg-gray-100 rounded animate-pulse" style={{ width: `${30 + Math.random() * 40}%` }} />
              <div className="h-3 bg-gray-100 rounded animate-pulse w-20" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatDate(d: string): string {
  try {
    return new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  } catch {
    return d;
  }
}
