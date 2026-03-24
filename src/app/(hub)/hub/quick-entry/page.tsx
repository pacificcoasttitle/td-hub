'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { PropertyConfirmModal } from '@/components/shared/property-confirm-modal';
import { useQuickEntry } from '@/components/admin/quick-entry/use-quick-entry';
import { STEPS, STEP_LABELS, CARD, PARTY_MATRIX, type UploadFile } from '@/components/hub/quick-entry/constants';
import { Reveal, SectionShell, SkipLink, Spinner, PersonIcon, MapIcon, CalcIcon, GroupIcon } from '@/components/hub/quick-entry/shared';
import { ClientSearch } from '@/components/hub/quick-entry/client-search';
import { PropertySearch, TransactionFields } from '@/components/hub/quick-entry/form-sections';
import { PartiesFields, DeliverableEmails, DocumentUpload } from '@/components/hub/quick-entry/parties-section';

export default function QuickEntryPage() {
  const s = useQuickEntry();
  const router = useRouter();
  const [revealed, setRevealed] = useState(0);
  const [uploads, setUploads] = useState<UploadFile[]>([]);
  const [partyChecks, setPartyChecks] = useState<Record<string, boolean>>({});
  const [dupWarning, setDupWarning] = useState('');

  const unlock = useCallback((step: number) => setRevealed(p => Math.max(p, step)), []);

  useEffect(() => { if (s.client && revealed < 1) unlock(1); }, [s.client, revealed, unlock]);
  useEffect(() => { if (s.street && revealed < 2) unlock(2); }, [s.street, revealed, unlock]);
  useEffect(() => { if (s.txType && revealed < 3) unlock(3); }, [s.txType, revealed, unlock]);

  useEffect(() => {
    if (!s.client?.contactType) return;
    const auto: Record<string, boolean> = {};
    for (const k of (PARTY_MATRIX[s.client.contactType] ?? ['buyerAgent', 'listingAgent', 'lender', 'escrow'])) auto[k] = true;
    setPartyChecks(auto);
  }, [s.client?.contactType]);

  function skip(step: number) {
    unlock(step);
    setTimeout(() => document.getElementById(`step-${STEPS[step]}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
  }

  useEffect(() => {
    if (!s.apn) return;
    fetch('/api/orders/check-duplicate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apn: s.apn }),
    })
      .then(r => r.json())
      .then(d => { if (d.isDuplicate) setDupWarning(`Possible duplicate: APN matches existing order ${d.existingFileNumber ?? ''}`); else setDupWarning(''); })
      .catch(() => {});
  }, [s.apn]);

  if (s.result?.type === 'success') {
    return (
      <div className="max-w-2xl mx-auto p-8">
        <div className={`${CARD} overflow-hidden`}>
          <div className="bg-[#1B2A4A] px-6 py-5 flex items-center gap-3">
            <svg className="h-6 w-6 text-[#F26B2B]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <div><p className="text-white font-semibold">Order Created</p><p className="text-white/60 text-sm">{s.result.message}</p></div>
          </div>
          <div className="p-6 flex gap-3">
            <button onClick={() => router.push('/hub')} className="flex-1 px-5 py-3 text-sm font-semibold bg-[#F26B2B] text-white rounded-lg hover:bg-[#E05A1A] transition-colors h-11">Back to Hub</button>
            <button onClick={() => { s.setResult(null); setRevealed(0); setUploads([]); window.scrollTo(0, 0); }} className="flex-1 px-5 py-3 text-sm font-medium border border-gray-200 text-[#4B5563] rounded-lg hover:bg-gray-50 transition-colors h-11">Create Another</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#F8F9FA] min-h-screen">
      <div className="p-6 lg:p-8 max-w-3xl mx-auto pb-28">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-[#1A1A2E]">Quick Entry</h1>
          <p className="text-sm text-[#6B7280] mt-1">Open an order — complete each section to reveal the next.</p>
        </div>

        <div className="flex items-center gap-1 mb-8">
          {STEPS.map((st, i) => (
            <button key={st} onClick={() => { if (i <= revealed) document.getElementById(`step-${st}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
              disabled={i > revealed}
              className="flex items-center gap-1 group disabled:opacity-30">
              <div className={`w-2.5 h-2.5 rounded-full transition-colors ${i <= revealed ? 'bg-[#F26B2B]' : 'bg-gray-300'}`} />
              <span className={`text-[10px] font-medium uppercase tracking-wide hidden sm:inline ${i <= revealed ? 'text-[#1A1A2E]' : 'text-[#9CA3AF]'}`}>{STEP_LABELS[st]}</span>
              {i < STEPS.length - 1 && <div className={`w-4 h-px mx-0.5 ${i < revealed ? 'bg-[#F26B2B]' : 'bg-gray-300'}`} />}
            </button>
          ))}
        </div>

        <Reveal id="step-client" open>
          <SectionShell icon={<PersonIcon />} title="Client" step={1}>
            <ClientSearch s={s} />
            <SkipLink show={revealed < 1 && !s.client} onClick={() => skip(1)} />
          </SectionShell>
        </Reveal>

        <Reveal id="step-property" open={revealed >= 1}>
          <SectionShell icon={<MapIcon />} title="Property" step={2}>
            <PropertySearch s={s} />
            {dupWarning && <div className="mt-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">{dupWarning}</div>}
            <SkipLink show={revealed < 2 && !s.street} onClick={() => skip(2)} />
          </SectionShell>
        </Reveal>

        <Reveal id="step-transaction" open={revealed >= 2}>
          <SectionShell icon={<CalcIcon />} title="Transaction" step={3}>
            <p className="text-xs text-[#6B7280] mb-3">Choose transaction type first — sellers (purchase) or borrowers (refinance / equity) appear below.</p>
            <TransactionFields s={s} />
            <SkipLink show={revealed < 3 && !s.txType} onClick={() => skip(3)} />
          </SectionShell>
        </Reveal>

        <Reveal id="step-parties" open={revealed >= 3}>
          <SectionShell icon={<GroupIcon />} title="Parties & Deliverables" step={4}>
            <PartiesFields s={s} checks={partyChecks} setChecks={setPartyChecks} />
            <div className="border-t border-gray-100 pt-4 mt-4"><DeliverableEmails s={s} /></div>
            <div className="border-t border-gray-100 pt-4 mt-4"><DocumentUpload uploads={uploads} setUploads={setUploads} /></div>
            <SkipLink show={revealed < 4} onClick={() => skip(4)} />
          </SectionShell>
        </Reveal>

        <Reveal id="step-submit" open={revealed >= 4}>
          <div className={`${CARD} p-6`}>
            {s.result?.type === 'error' && <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{s.result.message}</div>}
            <button onClick={s.handleSubmit} disabled={s.submitting}
              className="w-full h-12 bg-[#F26B2B] text-white text-sm font-semibold rounded-lg hover:bg-[#E05A1A] disabled:opacity-50 transition-colors inline-flex items-center justify-center gap-2">
              {s.submitting ? <><Spinner /> Creating Order…</> : 'Create Order'}
            </button>
          </div>
        </Reveal>
      </div>

      <PropertyConfirmModal open={s.showConfirmModal}
        address={s.pendingAddress ?? { street: '', city: '', state: '', zip: '' }}
        onConfirm={s.handleConfirm}
        onNoMatch={() => { s.setShowConfirmModal(false); s.setNoMatchMsg('Property not found — enter details manually.'); }}
        onReject={() => { s.setShowConfirmModal(false); s.setStreet(''); s.setCity(''); s.setState(''); s.setZip(''); }}
        accentColor="#F26B2B" />
    </div>
  );
}
