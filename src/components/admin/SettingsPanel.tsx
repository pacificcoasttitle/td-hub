'use client';

import { useCallback, useEffect, useState } from 'react';
import { ToggleSwitch } from './ToggleSwitch';

/* ── Types ─────────────────────────────────────────────────────────────────── */

interface Setting {
  key: string;
  value: string;
  label: string;
  description: string;
  type: 'boolean' | 'string' | 'number';
}

type SettingsMap = Record<string, Setting[]>;

const DANGEROUS_KEYS: Record<string, string> = {
  titlepoint_shut_off: 'Are you sure? This will disable all TitlePoint document generation for new orders.',
  maintenance_mode: 'Are you sure? This will show a maintenance message to all non-admin users.',
  tessa_prelim_enabled: 'Are you sure? Turning this ON exposes AI-generated prelim interpretation to all users (sales reps) and resumes new AI analysis (LLM cost). Turning it OFF hides the feature and stops new analysis. Existing stored analyses are not affected.',
};

/* ── Panel ─────────────────────────────────────────────────────────────────── */

export function SettingsPanel() {
  const [role, setRole] = useState<string | null>(null);
  const [settings, setSettings] = useState<SettingsMap | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    Promise.all([
      fetch('/api/auth/session', { signal: ac.signal }).then(r => r.ok ? r.json() : null),
      fetch('/api/admin/settings', { signal: ac.signal }).then(r => {
        if (!r.ok) throw new Error(`Failed to load settings (${r.status})`);
        return r.json();
      }),
    ])
      .then(([session, data]) => {
        setRole(session?.role ?? null);
        setSettings(data?.settings ?? null);
      })
      .catch(err => { if (err.name !== 'AbortError') setError(err.message); })
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, []);

  if (loading) return <SkeletonCards />;
  if (role && role !== 'super_admin' && role !== 'admin') {
    return (
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-12 text-center">
        <p className="text-[#1A1A2E] font-medium">You don&apos;t have permission to view this page.</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-12 text-center">
        <p className="text-red-600 font-medium">Failed to load settings</p>
        <p className="text-sm text-[#6B7280] mt-1">{error}</p>
      </div>
    );
  }
  if (!settings || Object.keys(settings).length === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-12 text-center">
        <p className="text-[#1A1A2E] font-medium">No settings configured</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {Object.entries(settings).map(([category, items]) => (
        <CategoryCard key={category} category={category} items={items} onUpdate={(key, value) => {
          setSettings(prev => {
            if (!prev) return prev;
            const copy = { ...prev };
            copy[category] = copy[category].map(s => s.key === key ? { ...s, value } : s);
            return copy;
          });
        }} />
      ))}
    </div>
  );
}

function CategoryCard({ category, items, onUpdate }: {
  category: string; items: Setting[]; onUpdate: (key: string, value: string) => void;
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
      <h3 className="text-lg font-semibold text-[#1A1A2E] mb-4">{category}</h3>
      <div className="divide-y divide-gray-100">
        {items.map(setting => (
          <SettingRow key={setting.key} setting={setting} onUpdate={onUpdate} />
        ))}
      </div>
    </div>
  );
}

function SettingRow({ setting, onUpdate }: { setting: Setting; onUpdate: (key: string, value: string) => void }) {
  if (setting.type === 'boolean') {
    return <BooleanSettingRow setting={setting} onUpdate={onUpdate} />;
  }
  return <StringSettingRow setting={setting} onUpdate={onUpdate} />;
}

function BooleanSettingRow({ setting, onUpdate }: { setting: Setting; onUpdate: (key: string, value: string) => void }) {
  const checked = setting.value === 'true';
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<'success' | 'error' | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);

  const isDangerous = setting.key in DANGEROUS_KEYS;

  const doToggle = useCallback(async (next: boolean) => {
    const nextVal = String(next);
    const prevVal = setting.value;
    onUpdate(setting.key, nextVal);
    setSaving(true);
    setFeedback(null);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: setting.key, value: nextVal }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? 'Save failed');
      setFeedback('success');
      setTimeout(() => setFeedback(null), 2000);
    } catch (err) {
      onUpdate(setting.key, prevVal);
      setFeedback('error');
      setErrorMsg(err instanceof Error ? err.message : 'Save failed');
      setTimeout(() => { setFeedback(null); setErrorMsg(null); }, 5000);
    } finally {
      setSaving(false);
    }
  }, [setting.key, setting.value, onUpdate]);

  function handleToggle(next: boolean) {
    if (isDangerous) { setConfirm(true); return; }
    doToggle(next);
  }

  function confirmToggle() {
    setConfirm(false);
    doToggle(!checked);
  }

  return (
    <>
      <div className="py-4 flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-[#1A1A2E]">{setting.label}</p>
            {feedback === 'success' && <SuccessCheck />}
          </div>
          <p className="text-sm text-[#6B7280] mt-0.5">{setting.description}</p>
          {errorMsg && <p className="text-xs text-red-600 mt-1">{errorMsg}</p>}
        </div>
        <ToggleSwitch checked={checked} onChange={handleToggle} disabled={saving} label={setting.label} />
      </div>
      {confirm && (
        <ConfirmDialog
          message={DANGEROUS_KEYS[setting.key]}
          onConfirm={confirmToggle}
          onCancel={() => setConfirm(false)}
        />
      )}
    </>
  );
}

function StringSettingRow({ setting, onUpdate }: { setting: Setting; onUpdate: (key: string, value: string) => void }) {
  const [draft, setDraft] = useState(setting.value);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<'success' | 'error' | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const changed = draft !== setting.value;

  async function save() {
    setSaving(true);
    setFeedback(null);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: setting.key, value: draft }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? 'Save failed');
      onUpdate(setting.key, draft);
      setFeedback('success');
      setTimeout(() => setFeedback(null), 2000);
    } catch (err) {
      setFeedback('error');
      setErrorMsg(err instanceof Error ? err.message : 'Save failed');
      setTimeout(() => { setFeedback(null); setErrorMsg(null); }, 5000);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="py-4">
      <div className="flex items-center gap-2 mb-1">
        <label className="text-sm font-medium text-[#1A1A2E]">{setting.label}</label>
        {feedback === 'success' && <SuccessCheck />}
      </div>
      <p className="text-sm text-[#6B7280] mb-2">{setting.description}</p>
      <div className="flex items-center gap-2 max-w-md">
        <input
          type={setting.type === 'number' ? 'number' : 'text'}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && changed) save(); }}
          className="flex-1 h-9 rounded-md border border-gray-300 bg-white px-3 text-sm text-[#1A1A2E] focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 focus:border-[#1B2A4A]"
        />
        {changed && (
          <button onClick={save} disabled={saving}
            className="h-9 px-4 text-sm font-medium bg-[#1B2A4A] text-white rounded-md hover:bg-[#243658] disabled:opacity-50 transition-colors">
            {saving ? 'Saving…' : 'Save'}
          </button>
        )}
      </div>
      {errorMsg && <p className="text-xs text-red-600 mt-1.5">{errorMsg}</p>}
    </div>
  );
}

function ConfirmDialog({ message, onConfirm, onCancel }: {
  message: string; onConfirm: () => void; onCancel: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onCancel(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onCancel}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-3 mb-4">
          <div className="shrink-0 w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
            <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <div>
            <h3 className="text-base font-semibold text-[#1A1A2E]">Confirm Change</h3>
            <p className="text-sm text-[#6B7280] mt-1">{message}</p>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel}
            className="px-4 py-2 text-sm font-medium border border-gray-200 text-[#4B5563] rounded-lg hover:bg-gray-50 transition-colors">
            Cancel
          </button>
          <button onClick={onConfirm}
            className="px-4 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors">
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

function SuccessCheck() {
  return <svg className="w-4 h-4 text-green-500 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>;
}

function SkeletonCards() {
  const rows = [3, 2, 3, 2];
  return (
    <div className="space-y-6">
      {rows.map((count, ci) => (
        <div key={ci} className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
          <div className="h-5 w-28 bg-gray-200 rounded animate-pulse mb-4" />
          <div className="divide-y divide-gray-100">
            {Array.from({ length: count }).map((_, ri) => (
              <div key={ri} className="py-4 flex items-center justify-between">
                <div className="space-y-2"><div className="h-4 w-40 bg-gray-200 rounded animate-pulse" /><div className="h-3 w-64 bg-gray-100 rounded animate-pulse" /></div>
                <div className="h-6 w-11 bg-gray-200 rounded-full animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
