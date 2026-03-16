'use client';

import type { Person } from './types';
import { IN, FL } from './types';

export function PersonFields({ person, onChange, label }: { person: Person; onChange: (p: Person) => void; label: string }) {
  return (
    <>
      {label && <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-2">{label}</p>}
      <div className="grid grid-cols-3 gap-3 mb-3">
        <div><label className={FL}>First</label><input className={IN} value={person.firstName} onChange={(e) => onChange({ ...person, firstName: e.target.value })} /></div>
        <div><label className={FL}>Middle</label><input className={IN} value={person.middleName} onChange={(e) => onChange({ ...person, middleName: e.target.value })} /></div>
        <div><label className={FL}>Last</label><input className={IN} value={person.lastName} onChange={(e) => onChange({ ...person, lastName: e.target.value })} /></div>
      </div>
    </>
  );
}
