'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { TemplatePreviewModal } from './template-preview-modal';

interface NotificationType {
  id: number;
  slug: string;
  displayName: string;
  description: string | null;
  channels: string[];
  isEnabled: boolean;
  recipientRoles: string[] | null;
  internalCc: string[] | null;
  templateId: string | null;
}

const ROLE_OPTIONS = [
  'escrow_officer', 'listing_agent', 'buyer_agent', 'lender',
  'sales_rep', 'title_officer', 'internal',
] as const;

function fmtRole(r: string) {
  return r.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function ConfigTab() {
  const [types, setTypes] = useState<NotificationType[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<NotificationType | null>(null);
  const [previewing, setPreviewing] = useState<NotificationType | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const fetchTypes = useCallback(() => {
    setLoading(true);
    fetch('/api/admin/notifications/types')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setTypes(d.types ?? []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchTypes(); }, [fetchTypes]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  async function quickToggle(slug: string, enabled: boolean) {
    setTypes(prev => prev.map(t => t.slug === slug ? { ...t, isEnabled: enabled } : t));
    try {
      const res = await fetch(`/api/admin/notifications/types/${slug}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isEnabled: enabled }),
      });
      if (!res.ok) {
        setTypes(prev => prev.map(t => t.slug === slug ? { ...t, isEnabled: !enabled } : t));
        showToast('Failed to update — reverted');
      } else {
        showToast(enabled ? 'Notification enabled' : 'Notification disabled');
      }
    } catch {
      setTypes(prev => prev.map(t => t.slug === slug ? { ...t, isEnabled: !enabled } : t));
      showToast('Failed to update — reverted');
    }
  }

  if (loading) return (
    <div className="grid gap-4 md:grid-cols-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="bg-white rounded-xl border border-gray-200 p-5 animate-pulse">
          <div className="h-4 w-40 bg-gray-200 rounded mb-2" />
          <div className="h-3 w-64 bg-gray-100 rounded mb-4" />
          <div className="h-6 w-12 bg-gray-200 rounded-full" />
        </div>
      ))}
    </div>
  );

  if (types.length === 0) return (
    <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
      <p className="text-[#1A1A2E] font-medium">No notification types configured</p>
      <p className="text-sm text-[#6B7280] mt-1">Notification types are created from the database seed.</p>
    </div>
  );

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        {types.map(t => (
          <div key={t.id} className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex flex-col">
            <div className="flex items-start justify-between mb-2">
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-[#1A1A2E] truncate">{t.displayName}</h3>
                {t.description && <p className="text-xs text-[#6B7280] mt-0.5 line-clamp-2">{t.description}</p>}
              </div>
              <button onClick={() => quickToggle(t.slug, !t.isEnabled)} aria-label="Toggle"
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors ${t.isEnabled ? 'bg-green-500' : 'bg-gray-300'}`}>
                <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform mt-0.5 ${t.isEnabled ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
              </button>
            </div>

            <div className="flex flex-wrap gap-1.5 mb-3">
              {t.channels.map(ch => (
                <span key={ch} className="px-2 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-700">{ch}</span>
              ))}
            </div>

            {t.recipientRoles && t.recipientRoles.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-3">
                {t.recipientRoles.map(r => (
                  <span key={r} className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-[#4B5563]">{fmtRole(r)}</span>
                ))}
              </div>
            )}

            <div className="mt-auto pt-2 flex items-center gap-3">
              <button onClick={() => setPreviewing(t)}
                className="inline-flex items-center gap-1 text-xs font-medium text-[#4B5563] border border-gray-200 rounded-md px-2 py-1 hover:bg-gray-50 transition-colors">
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                Preview
              </button>
              <button onClick={() => setEditing(t)}
                className="text-xs font-medium text-[#F26B2B] hover:text-[#E05A1A] transition-colors">
                Edit Configuration
              </button>
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <EditModal
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={(updated) => {
            setTypes(prev => prev.map(t => t.slug === updated.slug ? updated : t));
            setEditing(null);
          }}
        />
      )}

      {previewing && (
        <TemplatePreviewModal
          slug={previewing.slug}
          displayName={previewing.displayName}
          onClose={() => setPreviewing(null)}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-2.5 bg-[#1B2A4A] text-white text-sm font-medium rounded-lg shadow-lg animate-fade-in">
          {toast}
        </div>
      )}
    </>
  );
}

/* ── Edit Modal ──────────────────────────────────────────────────────────── */

function EditModal({ initial, onClose, onSaved }: {
  initial: NotificationType;
  onClose: () => void;
  onSaved: (t: NotificationType) => void;
}) {
  const [enabled, setEnabled] = useState(initial.isEnabled);
  const [channels, setChannels] = useState<Set<string>>(new Set(initial.channels));
  const [roles, setRoles] = useState<Set<string>>(new Set(initial.recipientRoles ?? []));
  const [ccText, setCcText] = useState((initial.internalCc ?? []).join(', '));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [tplHtml, setTplHtml] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!initial.templateId) return;
    fetch(`/api/admin/notification-templates`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        const tpl = (d?.templates ?? []).find((t: { eventType: string; body: string }) => t.eventType === initial.slug);
        if (tpl?.body) setTplHtml(tpl.body);
      })
      .catch(() => {});
  }, [initial.templateId, initial.slug]);

  function toggleCh(ch: string) {
    setChannels(prev => { const n = new Set(prev); n.has(ch) ? n.delete(ch) : n.add(ch); return n; });
  }
  function toggleRole(r: string) {
    setRoles(prev => { const n = new Set(prev); n.has(r) ? n.delete(r) : n.add(r); return n; });
  }

  async function save() {
    setSaving(true);
    setError('');
    try {
      const body = {
        isEnabled: enabled,
        channels: [...channels],
        recipientRoles: [...roles],
        internalCc: ccText.split(',').map(s => s.trim()).filter(Boolean),
      };
      const res = await fetch(`/api/admin/notifications/types/${initial.slug}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) { const b = await res.json().catch(() => null); throw new Error(b?.error ?? 'Save failed'); }
      onSaved({ ...initial, ...body });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div ref={ref} className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[#1B2A4A]">{initial.displayName}</h2>
          <button onClick={onClose} className="text-[#6B7280] hover:text-[#1A1A2E]">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {error && <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}

          {/* Enabled toggle */}
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-[#1A1A2E]">Enabled</span>
            <button onClick={() => setEnabled(!enabled)}
              className={`relative inline-flex h-6 w-11 rounded-full transition-colors ${enabled ? 'bg-green-500' : 'bg-gray-300'}`}>
              <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform mt-0.5 ${enabled ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
            </button>
          </div>

          {/* Channels */}
          <div>
            <p className="text-sm font-medium text-[#1A1A2E] mb-2">Channels</p>
            <div className="flex gap-4">
              {['email', 'sms'].map(ch => (
                <label key={ch} className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={channels.has(ch)} onChange={() => toggleCh(ch)}
                    className="h-4 w-4 rounded border-gray-300 text-[#1B2A4A] focus:ring-[#1B2A4A]" />
                  <span className="text-sm text-[#1A1A2E] capitalize">{ch}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Recipient roles */}
          <div>
            <p className="text-sm font-medium text-[#1A1A2E] mb-2">Recipient Roles</p>
            <div className="grid grid-cols-2 gap-2">
              {ROLE_OPTIONS.map(r => (
                <label key={r} className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={roles.has(r)} onChange={() => toggleRole(r)}
                    className="h-4 w-4 rounded border-gray-300 text-[#1B2A4A] focus:ring-[#1B2A4A]" />
                  <span className="text-sm text-[#1A1A2E]">{fmtRole(r)}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Internal CC */}
          <div>
            <p className="text-sm font-medium text-[#1A1A2E] mb-1">Internal CC Emails</p>
            <input type="text" value={ccText} onChange={e => setCcText(e.target.value)} placeholder="email1@pct.com, email2@pct.com"
              className="w-full h-10 px-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 focus:border-[#1B2A4A]" />
            <p className="text-xs text-[#9CA3AF] mt-1">Comma-separated list</p>
          </div>

          {/* Template preview */}
          {tplHtml && (
            <div>
              <p className="text-sm font-medium text-[#1A1A2E] mb-2">Email Template Preview</p>
              <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
                <iframe srcDoc={tplHtml} title="Template preview" sandbox="" className="w-full h-48 border-0" />
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium border border-gray-200 text-[#4B5563] rounded-lg hover:bg-gray-50 transition-colors">Cancel</button>
          <button onClick={save} disabled={saving}
            className="px-5 py-2 text-sm font-semibold bg-[#F26B2B] text-white rounded-lg hover:bg-[#E05A1A] disabled:opacity-50 transition-colors">
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
