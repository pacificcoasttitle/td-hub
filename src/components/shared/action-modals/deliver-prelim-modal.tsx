'use client';

import { useEffect, useMemo, useState } from 'react';
import { ModalShell } from './modal-shell';

interface PrelimRecipient {
  email: string;
  name: string | null;
  role: string;
}

interface PrelimCcRecipient extends PrelimRecipient {
  source: 'title_officer' | 'officer_cc_defaults' | 'ad_hoc';
}

interface PrelimRecipientWarning {
  code: string;
  message: string;
  email?: string;
  role?: string;
  source?: string;
}

interface PrelimDeliveryMode {
  mode: 'test' | 'live' | 'blocked';
  armed: boolean;
  message: string;
  testRecipient?: string;
}

export interface PrelimRecipientResolution {
  to: PrelimRecipient | null;
  cc: PrelimCcRecipient[];
  warnings: PrelimRecipientWarning[];
  blocked: boolean;
  blockReason?: string;
  deliveryMode?: PrelimDeliveryMode;
}

export interface EditableRecipient extends PrelimCcRecipient {
  key: string;
}

export interface AdHocCcDraft {
  email: string;
  name: string;
  role: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function labelRole(role: string): string {
  return role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function recipientKey(recipient: PrelimCcRecipient, index: number): string {
  return `${recipient.source}:${recipient.email}:${index}`;
}

export function toEditableRecipients(recipients: PrelimCcRecipient[]): EditableRecipient[] {
  return recipients.map((recipient, index) => ({ ...recipient, key: recipientKey(recipient, index) }));
}

export function getDeliverPrelimSendDisabledReason({
  loading,
  error,
  resolution,
}: {
  loading: boolean;
  error: string;
  resolution: PrelimRecipientResolution | null;
}): string {
  if (loading) return 'Resolving recipients...';
  if (error) return 'Resolve recipients before sending.';
  if (resolution?.blocked) return resolution.blockReason ?? 'Delivery is blocked.';
  if (resolution?.deliveryMode && !resolution.deliveryMode.armed) return resolution.deliveryMode.message;
  if (!resolution?.to) return 'No primary recipient resolved.';
  return '';
}

export function addAdHocCcRecipient({
  current,
  draft,
  to,
  keySuffix = Date.now(),
}: {
  current: EditableRecipient[];
  draft: AdHocCcDraft;
  to: PrelimRecipient | null;
  keySuffix?: number | string;
}): { recipients: EditableRecipient[]; error: string } {
  const email = draft.email.trim().toLowerCase();
  const name = draft.name.trim();
  const role = draft.role.trim() || 'ad_hoc';

  if (!EMAIL_PATTERN.test(email)) {
    return { recipients: current, error: 'Enter a valid email address.' };
  }

  const seen = new Set([
    to?.email.toLowerCase(),
    ...current.map((recipient) => recipient.email.toLowerCase()),
  ].filter(Boolean));
  if (seen.has(email)) {
    return { recipients: current, error: 'That recipient is already listed.' };
  }

  return {
    recipients: [
      ...current,
      {
        key: `ad_hoc:${email}:${keySuffix}`,
        email,
        name: name || null,
        role,
        source: 'ad_hoc',
      },
    ],
    error: '',
  };
}

export function removeCcRecipient(current: EditableRecipient[], key: string): EditableRecipient[] {
  return current.filter((item) => item.key !== key);
}

export function getDeliveryModeClassName(mode: PrelimDeliveryMode | undefined): string {
  if (mode?.mode === 'live') return 'border-red-200 bg-red-50 text-red-700';
  if (mode?.mode === 'test') return 'border-amber-200 bg-amber-50 text-amber-800';
  return 'border-gray-200 bg-gray-50 text-gray-700';
}

export function buildDeliverPrelimPayload(to: PrelimRecipient, ccRecipients: EditableRecipient[]) {
  return {
    to,
    cc: ccRecipients.map((recipient) => ({
      email: recipient.email,
      name: recipient.name,
      role: recipient.role,
      source: recipient.source,
    })),
  };
}

export function DeliverPrelimFooter({
  sendDisabledReason,
  sending,
  onClose,
  onSend,
}: {
  sendDisabledReason: string;
  sending: boolean;
  onClose: () => void;
  onSend: () => void;
}) {
  return (
    <div className="flex items-center justify-end gap-2 border-t border-gray-100 pt-4">
      {sendDisabledReason && <span className="mr-auto text-sm text-red-600">{sendDisabledReason}</span>}
      <button
        type="button"
        onClick={onClose}
        className="h-10 rounded-lg border border-gray-200 px-4 text-sm font-medium text-[#4B5563] hover:bg-gray-50"
      >
        Close
      </button>
      <button
        type="button"
        onClick={onSend}
        disabled={!!sendDisabledReason || sending}
        className="h-10 rounded-lg bg-[#F26B2B] px-4 text-sm font-semibold text-white hover:bg-[#E05A1A] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {sending ? 'Posting...' : 'Send'}
      </button>
    </div>
  );
}

function RecipientCard({
  label,
  recipient,
  onRemove,
}: {
  label: string;
  recipient: PrelimRecipient & { source?: string };
  onRemove?: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-[#1B2A4A]/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#1B2A4A]">
            {label}
          </span>
          <span className="text-xs font-medium text-[#6B7280]">{labelRole(recipient.role)}</span>
          {recipient.source && <span className="text-[10px] text-[#9CA3AF]">via {labelRole(recipient.source)}</span>}
        </div>
        <p className="mt-1 truncate text-sm font-medium text-[#1A1A2E]">{recipient.name || recipient.email}</p>
        {recipient.name && <p className="truncate text-xs text-[#6B7280]">{recipient.email}</p>}
      </div>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
        >
          Remove
        </button>
      )}
    </div>
  );
}

export function DeliverPrelimModal({
  open,
  onClose,
  orderId,
  fileNumber,
  address,
  accentColor = '#F26B2B',
}: {
  open: boolean;
  onClose: () => void;
  orderId: number;
  fileNumber: string;
  address: string;
  accentColor?: string;
}) {
  const [resolution, setResolution] = useState<PrelimRecipientResolution | null>(null);
  const [ccRecipients, setCcRecipients] = useState<EditableRecipient[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sendMessage, setSendMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState({ email: '', name: '', role: 'ad_hoc' });
  const [draftError, setDraftError] = useState('');

  useEffect(() => {
    if (!open || !orderId) {
      queueMicrotask(() => {
        setResolution(null);
        setCcRecipients([]);
        setLoading(false);
        setSending(false);
        setError('');
        setSendMessage('');
        setDraft({ email: '', name: '', role: 'ad_hoc' });
        setDraftError('');
      });
      return;
    }

    const controller = new AbortController();
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setLoading(true);
      setError('');
      setSendMessage('');
    });
    fetch(`/api/admin/orders/${orderId}/prelim-recipients`, { signal: controller.signal })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.error ?? `Failed to resolve recipients (${res.status})`);
        return body as PrelimRecipientResolution;
      })
      .then((body) => {
        setResolution(body);
        setCcRecipients(toEditableRecipients(body.cc ?? []));
      })
      .catch((err) => {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          setError(err instanceof Error ? err.message : 'Failed to resolve recipients');
        }
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [open, orderId]);

  const sendDisabledReason = useMemo(
    () => getDeliverPrelimSendDisabledReason({ loading, error, resolution }),
    [error, loading, resolution],
  );

  function addRecipient() {
    const result = addAdHocCcRecipient({ current: ccRecipients, draft, to: resolution?.to ?? null });
    setDraftError(result.error);
    if (result.error) return;

    setCcRecipients(result.recipients);
    setDraft({ email: '', name: '', role: 'ad_hoc' });
  }

  async function sendPrelim() {
    if (!resolution?.to || sendDisabledReason) return;
    setSending(true);
    setSendMessage('');
    setError('');
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/deliver-prelim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildDeliverPrelimPayload(resolution.to, ccRecipients)),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `Prelim delivery failed (${res.status})`);
      const writeback = body?.writeback;
      setSendMessage(
        body?.messageId && writeback?.deliveredAtPt
          ? `Delivered ${writeback.deliveredAtPt} to ${1 + ccRecipients.length} recipients · SendGrid ${body.messageId}\nSoftPro note ${writeback.softproSynced ? `added ${writeback.deliveredAtPt} ✓` : `pending/failed ${writeback.deliveredAtPt}`}`
          : body?.messageId
            ? `Prelim sent. Message ID: ${body.messageId}`
          : 'Prelim delivery request completed.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Prelim delivery failed');
    } finally {
      setSending(false);
    }
  }

  return (
    <ModalShell open={open} onClose={onClose} title="Deliver Prelim" subtitle={`${fileNumber} · ${address}`} wide accentColor={accentColor}>
      <div className="space-y-4 p-5">
        {loading && <p className="py-8 text-center text-sm text-[#6B7280]">Resolving prelim recipients...</p>}
        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        {resolution && !loading && (
          <>
            <div className={`rounded-lg border px-3 py-2 text-sm font-medium ${getDeliveryModeClassName(resolution.deliveryMode)}`}>
              {resolution.deliveryMode?.message ?? 'prelim delivery not armed'}
            </div>

            {resolution.blocked && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {resolution.blockReason ?? 'Send is blocked.'}
              </div>
            )}

            {resolution.warnings.length > 0 && (
              <div className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Resolver warnings</p>
                {resolution.warnings.map((warning, index) => (
                  <p key={`${warning.code}:${index}`} className="text-sm text-amber-800">
                    {warning.message}{warning.email ? `: ${warning.email}` : ''}
                  </p>
                ))}
              </div>
            )}

            <section>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Primary Recipient</h4>
              {resolution.to ? (
                <RecipientCard label="TO" recipient={resolution.to} />
              ) : (
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-[#6B7280]">No valid TO recipient resolved.</div>
              )}
            </section>

            <section>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#6B7280]">CC Recipients</h4>
              <div className="space-y-2">
                {ccRecipients.length > 0 ? (
                  ccRecipients.map((recipient) => (
                    <RecipientCard
                      key={recipient.key}
                      label="CC"
                      recipient={recipient}
                      onRemove={() => setCcRecipients((current) => removeCcRecipient(current, recipient.key))}
                    />
                  ))
                ) : (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-[#6B7280]">No CC recipients selected.</div>
                )}
              </div>
            </section>

            <section className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Add Ad-Hoc CC</h4>
              <div className="grid gap-2 md:grid-cols-[1.2fr_1fr_0.8fr_auto]">
                <input
                  value={draft.email}
                  onChange={(e) => setDraft((current) => ({ ...current, email: e.target.value }))}
                  placeholder="email@example.com"
                  className="h-9 rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-[#F26B2B]"
                />
                <input
                  value={draft.name}
                  onChange={(e) => setDraft((current) => ({ ...current, name: e.target.value }))}
                  placeholder="Name (optional)"
                  className="h-9 rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-[#F26B2B]"
                />
                <input
                  value={draft.role}
                  onChange={(e) => setDraft((current) => ({ ...current, role: e.target.value }))}
                  placeholder="Role"
                  className="h-9 rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-[#F26B2B]"
                />
                <button
                  type="button"
                  onClick={addRecipient}
                  className="h-9 rounded-lg border border-[#1B2A4A] px-3 text-sm font-semibold text-[#1B2A4A] hover:bg-[#1B2A4A]/5"
                >
                  Add
                </button>
              </div>
              {draftError && <p className="mt-2 text-xs text-red-600">{draftError}</p>}
            </section>

            {sendMessage && (
              <div className="whitespace-pre-line rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
                {sendMessage}
              </div>
            )}

            <DeliverPrelimFooter
              sendDisabledReason={sendDisabledReason}
              sending={sending}
              onClose={onClose}
              onSend={sendPrelim}
            />
          </>
        )}
      </div>
    </ModalShell>
  );
}
