'use client';

import { useEffect, useState } from 'react';
import { EmptyState } from './empty-state';

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
    return <EmptyState type="no-documents" />;
  }

  return (
    <div className="p-6 sm:p-8">
      <div className="space-y-0">
        {milestones.map((m, i) => {
          const isLast = i === milestones.length - 1;
          return (
            <div key={m.name} className="relative flex gap-6">
              {/* Connector line */}
              {!isLast && (
                <div
                  className={`absolute left-[19px] top-12 w-0.5 h-[calc(100%-24px)] ${
                    m.status === 'complete' ? 'bg-[#1B2A4A]' : 'bg-[#E5E7EB]'
                  }`}
                />
              )}

              {/* Node — 40px circles */}
              <div className="relative flex-shrink-0 z-10">
                {m.status === 'complete' ? (
                  <div className="w-10 h-10 rounded-full bg-[#1B2A4A] flex items-center justify-center">
                    <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                ) : m.status === 'in_progress' ? (
                  <div className="w-10 h-10 rounded-full border-4 border-[#F26B2B] bg-white flex items-center justify-center animate-pulse">
                    <div className="w-3 h-3 rounded-full bg-[#F26B2B]" />
                  </div>
                ) : (
                  <div className="w-10 h-10 rounded-full border-2 border-dashed border-[#D1D5DB] bg-white" />
                )}
              </div>

              {/* Content */}
              <div className="flex-1 pb-10">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h4 className={`font-medium ${
                      m.status === 'pending' ? 'text-[#9CA3AF]' : 'text-[#1B2A4A]'
                    }`}>
                      {m.name}
                    </h4>
                    {m.status === 'in_progress' && (
                      <p className="text-sm text-[#F26B2B] mt-0.5">In progress</p>
                    )}
                    {m.documentId && m.status === 'complete' && (
                      <a
                        href={`/api/documents/${m.documentId}/download`}
                        className="inline-flex items-center text-sm text-[#F26B2B] hover:text-[#E05A1A] font-medium mt-2"
                      >
                        View Document
                      </a>
                    )}
                  </div>
                  {m.date && (
                    <span className="text-sm text-[#6B7280] flex-shrink-0 whitespace-nowrap">{formatDate(m.date)}</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TimelineSkeleton() {
  return (
    <div className="p-6 sm:p-8">
      <div className="space-y-8">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="flex gap-6">
            <div className="h-10 w-10 rounded-full bg-gray-100 animate-pulse flex-shrink-0" />
            <div className="flex-1 space-y-2 pt-2">
              <div className="h-4 bg-gray-100 rounded animate-pulse" style={{ width: `${30 + Math.random() * 40}%` }} />
              <div className="h-3 bg-gray-100 rounded animate-pulse w-24" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatDate(d: string): string {
  try {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return d;
  }
}
