'use client';

import { useEffect, useState } from 'react';

interface Props {
  slug: string;
  displayName: string;
  onClose: () => void;
}

export function TemplatePreviewModal({ slug, displayName, onClose }: Props) {
  const [html, setHtml] = useState<string | null>(null);
  const [subject, setSubject] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/admin/notifications/types/${encodeURIComponent(slug)}/preview`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d) { setHtml(d.html ?? null); setSubject(d.subject ?? null); }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [slug]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl mx-4 max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between shrink-0 bg-[#1B2A4A] rounded-t-xl">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-white truncate">Template Preview — {displayName}</h2>
            {subject && <p className="text-xs text-gray-300 mt-0.5 truncate">Subject: {subject}</p>}
          </div>
          <button onClick={onClose} className="text-gray-300 hover:text-white shrink-0 ml-4">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="h-8 w-8 border-2 border-[#F26B2B] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : html ? (
            <div className="border border-gray-200 rounded-lg shadow-sm overflow-hidden bg-white">
              <iframe
                srcDoc={html}
                title="Email template preview"
                sandbox=""
                className="w-full border-0"
                style={{ minHeight: 500 }}
                onLoad={e => {
                  const frame = e.currentTarget;
                  const doc = frame.contentDocument;
                  if (doc?.body) {
                    frame.style.height = `${doc.body.scrollHeight + 40}px`;
                  }
                }}
              />
            </div>
          ) : (
            <div className="py-20 text-center text-[#6B7280]">
              <p className="font-medium">No template available for this notification type.</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-200 shrink-0">
          <p className="text-xs text-[#9CA3AF] italic">
            This is a preview with sample data. Actual emails use real order data.
          </p>
        </div>
      </div>
    </div>
  );
}
