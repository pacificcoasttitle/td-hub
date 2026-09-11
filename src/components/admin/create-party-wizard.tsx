'use client';

import { useEffect, useRef, useState } from 'react';
import type { AddCompanyUserType } from '@/lib/domain/contacts/company-constants';
import type { CreatePersonUserType } from '@/lib/domain/contacts/create-contact';

const IN = 'w-full h-10 px-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 focus:border-[#1B2A4A]';

export interface CreatedPartyContact {
  id: number;
  firstName: string;
  lastName: string;
  fullName: string;
  companyName: string;
  companyLookupCode: string;
  clientLookupCode: string;
  lookupCode: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
}

export interface CreatedCompany {
  id: number;
  lookupCode: string;
  name: string;
  address1: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
}

interface NearMatch {
  id: number;
  name: string;
  lookupCode: string | null;
  address1: string | null;
  city: string | null;
  score: number;
  reason: string;
}

const USER_TYPE_LABEL: Record<CreatePersonUserType, string> = {
  escrow: 'Escrow Company',
  lender: 'Lender',
  mortgage_broker: 'Mortgage Broker',
  realtor: 'Selling Agent/Broker',
};

export function CreatePartyWizard({
  open,
  onClose,
  onCreated,
  onCompanyCreated,
  userType: lockedUserType,
  label,
  initialQuery,
  companyOnly,
  chooseUserType,
}: {
  open: boolean;
  onClose: () => void;
  onCreated?: (contact: CreatedPartyContact) => void;
  onCompanyCreated?: (company: CreatedCompany) => void;
  userType: CreatePersonUserType;
  label: string;
  initialQuery?: string;
  companyOnly?: boolean;
  chooseUserType?: boolean;
}) {
  const [userType, setUserType] = useState<CreatePersonUserType>(lockedUserType);
  const [step, setStep] = useState<'company' | 'person'>('company');
  const [name, setName] = useState(initialQuery ?? '');
  const [address1, setAddress1] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('CA');
  const [zip, setZip] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [matches, setMatches] = useState<NearMatch[]>([]);
  const [confirmCreate, setConfirmCreate] = useState(false);
  const [selectedCompany, setSelectedCompany] = useState<CreatedCompany | null>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [personPhone, setPersonPhone] = useState('');
  const [personEmail, setPersonEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const searchRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (!open) return;
    setStep('company');
    setUserType(lockedUserType);
    setName(initialQuery ?? '');
    setAddress1('');
    setCity('');
    setState('CA');
    setZip('');
    setPhone('');
    setEmail('');
    setMatches([]);
    setConfirmCreate(false);
    setSelectedCompany(null);
    setFirstName('');
    setLastName(initialQuery?.includes(' ') ? '' : (initialQuery ?? ''));
    setPersonPhone('');
    setPersonEmail('');
    setError('');
  }, [open, initialQuery, lockedUserType]);

  useEffect(() => {
    if (!open || name.trim().length < 2) { setMatches([]); return; }
    clearTimeout(searchRef.current);
    searchRef.current = setTimeout(() => {
      const p = new URLSearchParams({ name: name.trim() });
      if (address1.trim()) p.set('address1', address1.trim());
      if (city.trim()) p.set('city', city.trim());
      fetch(`/api/companies/near-match?${p}`)
        .then((r) => r.ok ? r.json() : { matches: [] })
        .then((d: { matches?: NearMatch[] }) => setMatches(d.matches ?? []))
        .catch(() => setMatches([]));
    }, 250);
  }, [open, name, address1, city]);

  function pickMatch(m: NearMatch) {
    setSelectedCompany({
      id: m.id,
      lookupCode: m.lookupCode ?? '',
      name: m.name,
      address1: m.address1,
      city: m.city,
      phone: null,
      email: null,
    });
    setConfirmCreate(false);
    setError('');
    if (!companyOnly) setStep('person');
  }

  async function submitCompany(e: React.FormEvent) {
    e.preventDefault();
    if (selectedCompany?.lookupCode) {
      if (companyOnly) { onCompanyCreated?.(selectedCompany); onClose(); return; }
      setStep('person');
      return;
    }
    if (!name.trim() || !address1.trim()) {
      setError('Company name and Address1 are required');
      return;
    }
    if (matches.length > 0 && !confirmCreate) {
      setError('Select an existing company or confirm you want to create a new one');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const companyType: AddCompanyUserType = userType === 'escrow' ? 'escrow_company' : userType;
      const res = await fetch('/api/companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          address1: address1.trim(),
          city, state, zip, phone, email,
          userType: companyType,
          confirmCreate,
        }),
      });
      const body = await res.json().catch(() => null);
      if (res.status === 409 && body?.matches) {
        setMatches(body.matches);
        setError(body.error ?? 'Similar companies exist');
        return;
      }
      if (!res.ok) throw new Error(body?.error ?? body?.detail ?? `Failed (${res.status})`);
      const company = body as CreatedCompany;
      setSelectedCompany(company);
      onCompanyCreated?.(company);
      if (companyOnly) { onClose(); return; }
      setStep('person');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Company create failed');
    } finally {
      setSaving(false);
    }
  }

  async function submitPerson(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedCompany?.lookupCode) {
      setError('A selected company with a lookup code is required');
      setStep('company');
      return;
    }
    if (!firstName.trim() || !lastName.trim()) {
      setError('First and last name are required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          phone: personPhone,
          email: personEmail,
          address: selectedCompany.address1,
          city: selectedCompany.city,
          companyLookupCode: selectedCompany.lookupCode,
          userType,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        if (body?.companyKept) {
          setSelectedCompany({
            id: body.companyKept.id,
            lookupCode: body.companyKept.lookupCode,
            name: body.companyKept.name,
            address1: selectedCompany.address1,
            city: selectedCompany.city,
            phone: selectedCompany.phone,
            email: selectedCompany.email,
          });
        }
        throw new Error(body?.error ?? body?.detail ?? `Failed (${res.status})`);
      }
      onCreated?.({
        id: body.id,
        firstName: body.firstName,
        lastName: body.lastName,
        fullName: body.fullName,
        companyName: body.companyName,
        companyLookupCode: body.companyLookupCode,
        clientLookupCode: body.lookupCode,
        lookupCode: body.lookupCode,
        email: body.email,
        phone: body.phone,
        address: body.address,
        city: body.city,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Contact create failed');
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-[#1A1A2E]">
            {companyOnly ? `Add ${USER_TYPE_LABEL[userType]}` : `Create ${label}`}
          </h2>
          <button type="button" onClick={onClose} className="text-[#6B7280] hover:text-[#1A1A2E] text-lg">×</button>
        </div>

        {saving && (
          <div className="mx-6 mt-4 flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700">
            <div className="w-3 h-3 border-2 border-blue-300 border-t-blue-700 rounded-full animate-spin" />
            {step === 'company' ? 'Creating company in SoftPro…' : 'Creating contact in SoftPro…'}
          </div>
        )}
        {error && (
          <div className="mx-6 mt-4 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{error}</div>
        )}

        {step === 'company' ? (
          <form onSubmit={submitCompany} className="p-6 space-y-4">
            {chooseUserType ? (
              <div>
                <label className="block text-xs font-medium text-[#1A1A2E] mb-1">SoftPro type *</label>
                <select className={IN} value={userType} onChange={(e) => setUserType(e.target.value as CreatePersonUserType)}>
                  {(Object.keys(USER_TYPE_LABEL) as CreatePersonUserType[]).map((t) => (
                    <option key={t} value={t}>{USER_TYPE_LABEL[t]}</option>
                  ))}
                </select>
              </div>
            ) : (
              <p className="text-xs text-[#6B7280]">
                SoftPro type: {USER_TYPE_LABEL[userType]}.
              </p>
            )}
            {/* ONE LIST. Same reason as CompanyFormModal: an operator added the
                same lender on both company pages because nothing said they were
                one list, or which one the CPL search reads. */}
            <p className="text-xs text-[#6B7280]">
              This is the same company list as the Companies page — a company added on either page appears on both, so add it once.
              {userType === 'lender' && ' Lenders here are what the CPL and Proposed Insured lender search finds.'}
            </p>
            {selectedCompany ? (
              <div className="px-3 py-2 bg-[#1B2A4A]/5 border border-[#1B2A4A]/15 rounded-lg text-sm">
                <p className="font-medium text-[#1A1A2E]">{selectedCompany.name}</p>
                <p className="text-xs text-[#6B7280]">{selectedCompany.lookupCode}</p>
                <button type="button" className="mt-1 text-xs text-[#6B7280] underline" onClick={() => setSelectedCompany(null)}>Change</button>
              </div>
            ) : (
              <>
                {/* SEARCH FIRST.
                    The common case is a company PCT already works with: find
                    it, then add the employee under it. This step used to open
                    as a create form with required Name and Address1 and the
                    matches tucked underneath in an amber "are you sure" box, so
                    the common path started by filling in a form for something
                    that already existed. Same state, same endpoints, same
                    pickMatch and submitCompany — presented in the order the
                    work actually happens. */}
                <div>
                  <label className="block text-xs font-medium text-[#1A1A2E] mb-1">
                    Find the company
                  </label>
                  <input
                    className={IN}
                    value={name}
                    autoFocus
                    placeholder="Start typing a company name…"
                    onChange={(e) => { setName(e.target.value); setConfirmCreate(false); }}
                    required
                  />
                  {name.trim().length > 0 && name.trim().length < 2 && (
                    <p className="mt-1 text-xs text-[#6B7280]">Keep typing to search.</p>
                  )}
                </div>

                {matches.length > 0 && (
                  <div className="border border-[#E5E7EB] rounded-lg divide-y divide-[#F3F4F6] max-h-64 overflow-y-auto">
                    {matches.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => pickMatch(m)}
                        className="w-full text-left px-3 py-2 hover:bg-[#1B2A4A]/5 text-sm"
                      >
                        <span className="font-medium text-[#1A1A2E]">{m.name}</span>
                        <span className="block text-xs text-[#6B7280]">{[m.lookupCode, m.address1, m.city].filter(Boolean).join(' · ')}</span>
                      </button>
                    ))}
                  </div>
                )}

                {name.trim().length >= 2 && matches.length === 0 && !confirmCreate && (
                  <p className="text-xs text-[#6B7280]">No existing company matches that name.</p>
                )}

                {/* Creation is the fallback, and stays explicit: ticking this is
                    what satisfies the confirmCreate guard in submitCompany when
                    near-matches exist. */}
                {name.trim().length >= 2 && (
                  <label className="flex items-center gap-2 text-xs text-[#1A1A2E] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={confirmCreate}
                      onChange={(e) => setConfirmCreate(e.target.checked)}
                    />
                    Not listed — create <span className="font-medium">{name.trim()}</span> as a new company
                  </label>
                )}

                {confirmCreate && (
                  <div className="space-y-4 border-l-2 border-[#1B2A4A]/15 pl-3">
                    <div>
                      <label className="block text-xs font-medium text-[#1A1A2E] mb-1">Address1 *</label>
                      <input className={IN} value={address1} onChange={(e) => setAddress1(e.target.value)} required />
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-[#1A1A2E] mb-1">City</label>
                        <input className={IN} value={city} onChange={(e) => setCity(e.target.value)} />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-[#1A1A2E] mb-1">State</label>
                        <input className={IN} value={state} onChange={(e) => setState(e.target.value)} />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-[#1A1A2E] mb-1">ZIP</label>
                        <input className={IN} value={zip} onChange={(e) => setZip(e.target.value)} />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-[#1A1A2E] mb-1">Phone</label>
                        <input className={IN} value={phone} onChange={(e) => setPhone(e.target.value)} />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-[#1A1A2E] mb-1">Email</label>
                        <input type="email" className={IN} value={email} onChange={(e) => setEmail(e.target.value)} />
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose} className="flex-1 h-10 border border-gray-200 rounded-lg text-sm font-medium text-[#4B5563] hover:bg-gray-50">Cancel</button>
              <button type="submit" disabled={saving || (!selectedCompany && !confirmCreate)} className="flex-1 h-10 bg-[#1B2A4A] text-white rounded-lg text-sm font-semibold hover:bg-[#243658] disabled:opacity-50">
                {selectedCompany
                  ? (companyOnly ? 'Use company' : 'Continue')
                  : confirmCreate ? 'Create company' : 'Select a company'}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={submitPerson} className="p-6 space-y-4">
            <div className="px-3 py-2 bg-[#1B2A4A]/5 border border-[#1B2A4A]/15 rounded-lg text-sm">
              <p className="text-xs text-[#6B7280]">Company (required)</p>
              <p className="font-medium text-[#1A1A2E]">{selectedCompany?.name}</p>
              <p className="text-xs text-[#6B7280]">{selectedCompany?.lookupCode}</p>
              <button type="button" className="mt-1 text-xs text-[#6B7280] underline" onClick={() => { setStep('company'); setError(''); }}>
                Change company
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-[#1A1A2E] mb-1">First Name *</label>
                <input className={IN} value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#1A1A2E] mb-1">Last Name *</label>
                <input className={IN} value={lastName} onChange={(e) => setLastName(e.target.value)} required />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-[#1A1A2E] mb-1">Phone</label>
                <input className={IN} value={personPhone} onChange={(e) => setPersonPhone(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#1A1A2E] mb-1">Email</label>
                <input type="email" className={IN} value={personEmail} onChange={(e) => setPersonEmail(e.target.value)} />
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose} className="flex-1 h-10 border border-gray-200 rounded-lg text-sm font-medium text-[#4B5563] hover:bg-gray-50">Cancel</button>
              <button type="submit" disabled={saving || !selectedCompany?.lookupCode} className="flex-1 h-10 bg-[#1B2A4A] text-white rounded-lg text-sm font-semibold hover:bg-[#243658] disabled:opacity-50">
                Create contact
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
