'use client';

import type { Person } from './types';
import { IN, FL } from './types';

export function PersonFields({ person, onChange, label, highlight, asOrganization }: { person: Person; onChange: (p: Person) => void; label: string; highlight?: string; asOrganization?: boolean }) {
  const cls = highlight ? `${IN} ${highlight}` : IN;
  return (
    <>
      {label && <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-2">{label}</p>}
      {asOrganization ? (
        <div className="mb-3">
          <label className={FL}>Organization</label>
          <input
            className={cls}
            value={person.firstName || [person.middleName, person.lastName].filter(Boolean).join(' ')}
            onChange={(e) => onChange({ firstName: e.target.value, middleName: '', lastName: '' })}
          />
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3 mb-3">
          <div><label className={FL}>First</label><input className={cls} value={person.firstName} onChange={(e) => onChange({ ...person, firstName: e.target.value })} /></div>
          <div><label className={FL}>Middle</label><input className={cls} value={person.middleName} onChange={(e) => onChange({ ...person, middleName: e.target.value })} /></div>
          <div><label className={FL}>Last</label><input className={cls} value={person.lastName} onChange={(e) => onChange({ ...person, lastName: e.target.value })} /></div>
        </div>
      )}
    </>
  );
}
