'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Mail, Pencil, X } from 'lucide-react';
import { buildMailto } from './mailto';

// Drafts are chosen BEFORE Outlook opens — there is no way to inject text into
// an already-open Outlook window, so the flow is: generate here, pick, edit,
// then hand the finished text to Outlook via mailto.
//
// Nothing auto-sends. The rep reviews in Outlook and presses send themselves.

interface Draft {
  intent: string;
  label: string;
  subject: string;
  body: string;
}

interface Props {
  clientId: number;
  clientName: string;
  clientEmail: string | null;
  onClose: () => void;
}

export function EmailDraftModal({ clientId, clientName, clientEmail, onClose }: Props) {
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [selected, setSelected] = useState(0);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  const generate = useCallback(() => {
    setLoading(true);
    setNotice(null);
    fetch(`/api/sales/clients/${clientId}/email-drafts`, { method: 'POST' })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) {
          // 429 and 403 arrive here — surface the server's wording, which
          // already explains the limit.
          setNotice(d.error ?? 'Could not generate drafts.');
          setDrafts([]);
          return;
        }
        const list: Draft[] = Array.isArray(d.drafts) ? d.drafts : [];
        setDrafts(list);
        if (d.error) setNotice(d.error);
        if (list.length > 0) {
          setSelected(0);
          setSubject(list[0]!.subject);
          setBody(list[0]!.body);
        }
      })
      .catch(() => {
        setNotice('Could not generate drafts.');
        setDrafts([]);
      })
      .finally(() => setLoading(false));
  }, [clientId]);

  useEffect(() => { generate(); }, [generate]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  function pick(i: number) {
    const d = drafts?.[i];
    if (!d) return;
    setSelected(i);
    setSubject(d.subject);
    setBody(d.body);
  }

  const mailto = buildMailto({ to: clientEmail, subject, body });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-2xl max-h-[90vh] bg-white rounded-lg shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-100">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-gray-900">Email {clientName}</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {clientEmail
                ? <>Drafts are suggestions — edit anything, then open in Outlook to review and send.</>
                : <>No email on record. You can still open Outlook and add the address there.</>}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close"
            className="p-1.5 text-gray-400 hover:text-gray-700 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="py-12 text-center">
              <Loader2 className="h-5 w-5 animate-spin text-[#F26B2B] mx-auto" />
              <p className="text-sm text-gray-500 mt-2.5">Writing a few options…</p>
            </div>
          ) : (
            <>
              {notice && (
                <div className="mb-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
                  <p className="text-sm text-amber-900">{notice}</p>
                  {(drafts?.length ?? 0) === 0 && (
                    <p className="text-xs text-amber-800 mt-0.5">
                      You can still write the email yourself below.
                    </p>
                  )}
                </div>
              )}

              {(drafts?.length ?? 0) > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap mb-3">
                  {drafts!.map((d, i) => (
                    <button key={d.intent} onClick={() => pick(i)}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                        i === selected
                          ? 'border-[#F26B2B] bg-[#F26B2B]/5 text-[#F26B2B] font-medium'
                          : 'border-gray-200 text-gray-600 hover:border-[#F26B2B]/50'
                      }`}>
                      {d.label}
                    </button>
                  ))}
                </div>
              )}

              <label className="block text-xs font-medium text-gray-500 mb-1">Subject</label>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Subject"
                className="w-full h-9 px-3 mb-3 border border-gray-200 rounded-lg text-sm
                           focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 focus:border-[#1B2A4A]"
              />

              <label className="block text-xs font-medium text-gray-500 mb-1">
                <span className="inline-flex items-center gap-1">
                  <Pencil className="h-3 w-3" /> Message — edit freely
                </span>
              </label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={12}
                placeholder="Write your message…"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm resize-y
                           focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 focus:border-[#1B2A4A]"
              />

              {mailto.truncated && (
                <p className="text-xs text-amber-700 mt-1.5">
                  This message is long enough that Outlook may cut it short — consider trimming it.
                </p>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-gray-100 flex-wrap">
          <p className="text-xs text-gray-400">
            Opens Outlook — nothing is sent until you send it.
          </p>
          <div className="flex items-center gap-2">
            {!loading && (
              <button onClick={generate}
                className="h-9 px-3 rounded-lg border border-gray-200 text-sm text-gray-700 hover:border-[#F26B2B]/50 hover:text-[#F26B2B] transition-colors">
                Try again
              </button>
            )}
            <a
              href={mailto.href}
              onClick={onClose}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-[#F26B2B] text-white text-sm font-medium hover:bg-[#E05A1A] transition-colors"
            >
              <Mail className="h-4 w-4" /> Open in Outlook
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
