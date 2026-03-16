'use client';

import type { PartyContact } from './types';
import { IN, FL } from './types';

export function ContactFields({ contact, onChange, label, companyFirst }: {
  contact: PartyContact; onChange: (c: PartyContact) => void; label: string;
  searchRole: string; companyFirst?: boolean;
}) {
  return (
    <div className="mb-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-2">{label}</p>
      <div className="grid grid-cols-2 gap-3">
        <div><label className={FL}>{companyFirst ? 'Company' : 'Name'}</label><input className={IN} value={companyFirst ? contact.company : contact.name} onChange={(e) => onChange({ ...contact, [companyFirst ? 'company' : 'name']: e.target.value })} /></div>
        <div><label className={FL}>{companyFirst ? 'Contact Name' : 'Company'}</label><input className={IN} value={companyFirst ? contact.name : contact.company} onChange={(e) => onChange({ ...contact, [companyFirst ? 'name' : 'company']: e.target.value })} /></div>
        <div><label className={FL}>Email</label><input className={IN} type="email" value={contact.email} onChange={(e) => onChange({ ...contact, email: e.target.value })} /></div>
        <div><label className={FL}>Phone</label><input className={IN} type="tel" value={contact.phone} onChange={(e) => onChange({ ...contact, phone: e.target.value })} /></div>
      </div>
    </div>
  );
}
