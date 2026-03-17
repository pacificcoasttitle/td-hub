'use client';

import { useState, useRef } from 'react';
import { useContactSearch, type ContactResult } from '@/hooks/use-contact-search';
import { IN, FL, type PartyContact } from '@/components/admin/quick-entry/types';
import type { QuickEntryState } from '@/components/admin/quick-entry/use-quick-entry';
import { PARTY_DEFS, ROLE_SP_TYPE, ALLOWED_TYPES, MAX_FILE_SIZE, type UploadFile } from './constants';

export function PartiesFields({ s, checks, setChecks }: { s: QuickEntryState; checks: Record<string, boolean>; setChecks: (c: Record<string, boolean>) => void }) {
  const toggle = (k: string) => setChecks({ ...checks, [k]: !checks[k] });
  const contacts: Record<string, { val: PartyContact; set: (v: PartyContact) => void; role: string; companyFirst?: boolean }> = {
    buyerAgent: { val: s.buyerAgent, set: s.setBuyerAgent, role: 'buyer_agent' },
    listingAgent: { val: s.listingAgent, set: s.setListingAgent, role: 'listing_agent' },
    lender: { val: s.lender, set: s.setLender, role: 'lender', companyFirst: true },
    escrow: { val: s.escrow, set: s.setEscrow, role: 'escrow_officer', companyFirst: true },
  };

  return (
    <div>
      <div className="flex flex-wrap gap-3 mb-4">
        {PARTY_DEFS.map(p => (
          <label key={p.key} className="flex items-center gap-2 text-sm text-[#1A1A2E] cursor-pointer select-none">
            <input type="checkbox" checked={!!checks[p.key]} onChange={() => toggle(p.key)} className="rounded border-gray-300 accent-[#F26B2B] h-4 w-4" />{p.label}
          </label>
        ))}
      </div>
      {PARTY_DEFS.filter(p => checks[p.key]).map(p => {
        const c = contacts[p.key];
        return (
          <div key={p.key} className="mb-4 p-4 bg-[#F8F9FA] rounded-lg border border-gray-100">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-3">{p.label}</p>
            <PartyFieldsInline contact={c.val} onChange={c.set} role={c.role} companyFirst={c.companyFirst} />
          </div>
        );
      })}
      <div className="mt-3">
        <label className={FL}>Escrow Officer</label>
        {s.formOpts?.escrowOfficers?.length ? (
          <select value={s.escrowOfficer} onChange={e => s.setEscrowOfficer(e.target.value)} className={IN}><option value="">Select…</option>{s.formOpts.escrowOfficers.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
        ) : <input className={IN} value={s.escrowOfficer} onChange={e => s.setEscrowOfficer(e.target.value)} placeholder="Escrow officer" />}
      </div>
    </div>
  );
}

function PartyFieldsInline({ contact, onChange, role, companyFirst }: { contact: PartyContact; onChange: (v: PartyContact) => void; role: string; companyFirst?: boolean }) {
  const spType = ROLE_SP_TYPE[role];
  const { results, open, search, close, ref } = useContactSearch(spType, 8);

  function handleSearch(v: string) {
    const field = companyFirst ? 'company' : 'name';
    onChange({ ...contact, [field]: v });
    search(v);
  }

  function pick(c: ContactResult) {
    onChange({ name: c.fullName ?? '', email: c.email ?? '', phone: c.phone ?? '', company: c.companyName ?? '' });
    close();
  }

  return (
    <div ref={ref} className="relative">
      <div className="grid grid-cols-2 gap-2">
        <div className="relative">
          <label className="block text-[10px] text-[#6B7280] mb-0.5">{companyFirst ? 'Company' : 'Name'}</label>
          <input className={IN} value={companyFirst ? contact.company : contact.name} onChange={e => handleSearch(e.target.value)} />
          {open && results.length > 0 && (
            <div className="absolute z-20 top-full mt-1 left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
              {results.map(r => (
                <button key={r.id} onClick={() => pick(r)} className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 border-b border-gray-100 last:border-0">
                  <span className="font-medium text-[#1A1A2E]">{r.fullName ?? r.companyName}</span> <span className="text-[#6B7280]">{r.email}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div><label className="block text-[10px] text-[#6B7280] mb-0.5">{companyFirst ? 'Name' : 'Company'}</label><input className={IN} value={companyFirst ? contact.name : contact.company} onChange={e => onChange({ ...contact, [companyFirst ? 'name' : 'company']: e.target.value })} /></div>
        <div><label className="block text-[10px] text-[#6B7280] mb-0.5">Email</label><input type="email" className={IN} value={contact.email} onChange={e => onChange({ ...contact, email: e.target.value })} /></div>
        <div><label className="block text-[10px] text-[#6B7280] mb-0.5">Phone</label><input className={IN} value={contact.phone} onChange={e => onChange({ ...contact, phone: e.target.value })} /></div>
      </div>
    </div>
  );
}

export function DeliverableEmails({ s }: { s: QuickEntryState }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Deliverable Emails</p>
        {s.deliverableEmails.length < 5 && (
          <button onClick={() => s.setDeliverableEmails([...s.deliverableEmails, ''])} className="text-xs font-medium text-[#F26B2B] hover:text-[#E05A1A] min-h-[36px]">+ Add</button>
        )}
      </div>
      {s.deliverableEmails.length === 0 && <p className="text-xs text-[#9CA3AF]">No deliverable emails added.</p>}
      {s.deliverableEmails.map((em, i) => (
        <div key={i} className="flex gap-2 mb-2">
          <input className={IN} type="email" value={em} placeholder="email@example.com"
            onChange={e => { const a = [...s.deliverableEmails]; a[i] = e.target.value; s.setDeliverableEmails(a); }} />
          <button onClick={() => s.setDeliverableEmails(s.deliverableEmails.filter((_, j) => j !== i))} className="text-red-500 px-2 text-lg min-h-[36px]">×</button>
        </div>
      ))}
    </div>
  );
}

export function DocumentUpload({ uploads, setUploads }: { uploads: UploadFile[]; setUploads: (f: UploadFile[]) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function validate(file: File): string | undefined {
    if (!ALLOWED_TYPES.includes(file.type)) return `Invalid type: ${file.name}`;
    if (file.size > MAX_FILE_SIZE) return `Too large: ${file.name} (max 10 MB)`;
    return undefined;
  }

  function addFiles(files: FileList | null) {
    if (!files) return;
    const next = [...uploads];
    for (const f of Array.from(files)) next.push({ file: f, error: validate(f) });
    setUploads(next);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault(); setDragging(false);
    addFiles(e.dataTransfer.files);
  }

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-2">Documents</p>
      <div onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${dragging ? 'border-[#F26B2B] bg-[#F26B2B]/5' : 'border-gray-300 hover:border-[#F26B2B]/50'}`}>
        <svg className="h-8 w-8 text-[#9CA3AF] mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
        <p className="text-sm text-[#4B5563]">Drop files here or <span className="text-[#F26B2B] font-medium">browse</span></p>
        <p className="text-[10px] text-[#9CA3AF] mt-1">PDF, DOC, DOCX, JPG, PNG, TIFF — max 10 MB each</p>
        <input ref={inputRef} type="file" multiple accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.tiff,.tif" className="hidden" onChange={e => addFiles(e.target.files)} />
      </div>
      {uploads.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {uploads.map((u, i) => (
            <div key={i} className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm ${u.error ? 'bg-red-50 border border-red-200' : 'bg-gray-50 border border-gray-200'}`}>
              <div className="min-w-0">
                <p className={`truncate text-xs ${u.error ? 'text-red-700' : 'text-[#1A1A2E]'}`}>{u.file.name}</p>
                {u.error && <p className="text-[10px] text-red-500">{u.error}</p>}
                {!u.error && <p className="text-[10px] text-[#9CA3AF]">{(u.file.size / 1024).toFixed(0)} KB</p>}
              </div>
              <button onClick={() => setUploads(uploads.filter((_, j) => j !== i))} className="text-[#9CA3AF] hover:text-red-500 ml-2 shrink-0">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
