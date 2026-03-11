import type { PartyPerson, PartiesData } from './types';
import { EMPTY_PERSON, INPUT_CLASS, ORG_TYPES, SELECT_CLASS } from './constants';
import { FieldLabel, StepHeader, StepNav } from './shared';

export function Step3Parties({
  data, onChange, onNext, onPrev,
}: {
  data: PartiesData; onChange: (d: PartiesData) => void; onNext: () => void; onPrev: () => void;
}) {
  function updateSeller(field: keyof PartyPerson, value: string) {
    onChange({ ...data, seller: { ...data.seller, [field]: value } });
  }
  function updateSecondarySeller(field: keyof PartyPerson, value: string) {
    onChange({ ...data, secondarySeller: { ...data.secondarySeller, [field]: value } });
  }
  function updateBuyer(field: keyof PartyPerson, value: string) {
    onChange({ ...data, buyer: { ...data.buyer, [field]: value } });
  }
  function updateSecondaryBuyer(field: keyof PartyPerson, value: string) {
    onChange({ ...data, secondaryBuyer: { ...data.secondaryBuyer, [field]: value } });
  }

  return (
    <div className="p-6">
      <StepHeader title="Parties" sub="Add the buyer/borrower and seller information." />

      {/* Seller */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Seller</p>
        </div>
        <PersonFields person={data.seller} onChange={updateSeller} />
        {!data.hasSecondarySeller ? (
          <button
            onClick={() => onChange({ ...data, hasSecondarySeller: true })}
            className="mt-2 text-xs text-[#C5A55A] hover:text-[#b3923e] font-medium transition-colors"
          >
            + Add secondary seller
          </button>
        ) : (
          <div className="mt-3 pl-4 border-l-2 border-gray-100">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-[#6B7280] font-medium">Secondary Seller</p>
              <button
                onClick={() => onChange({ ...data, hasSecondarySeller: false, secondarySeller: { ...EMPTY_PERSON } })}
                className="text-xs text-red-500 hover:text-red-700"
              >
                Remove
              </button>
            </div>
            <PersonFields person={data.secondarySeller} onChange={updateSecondarySeller} />
          </div>
        )}
      </div>

      {/* Buyer/Borrower */}
      <div className="border-t border-gray-100 pt-6">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Buyer / Borrower</p>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={data.buyerIsOrg}
              onChange={(e) => onChange({ ...data, buyerIsOrg: e.target.checked })}
              className="rounded border-gray-300 text-[#C5A55A] focus:ring-[#C5A55A]/40"
            />
            <span className="text-xs text-[#6B7280]">Organization (LLC/Corp)</span>
          </label>
        </div>

        {data.buyerIsOrg && (
          <div className="mb-3">
            <FieldLabel>Organization Type</FieldLabel>
            <select
              value={data.orgType}
              onChange={(e) => onChange({ ...data, orgType: e.target.value })}
              className={SELECT_CLASS}
            >
              <option value="">Select type…</option>
              {ORG_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        )}

        <PersonFields person={data.buyer} onChange={updateBuyer} />

        {!data.hasSecondaryBuyer ? (
          <button
            onClick={() => onChange({ ...data, hasSecondaryBuyer: true })}
            className="mt-2 text-xs text-[#C5A55A] hover:text-[#b3923e] font-medium transition-colors"
          >
            + Add secondary buyer/borrower
          </button>
        ) : (
          <div className="mt-3 pl-4 border-l-2 border-gray-100">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-[#6B7280] font-medium">Secondary Buyer/Borrower</p>
              <button
                onClick={() => onChange({ ...data, hasSecondaryBuyer: false, secondaryBuyer: { ...EMPTY_PERSON } })}
                className="text-xs text-red-500 hover:text-red-700"
              >
                Remove
              </button>
            </div>
            <PersonFields person={data.secondaryBuyer} onChange={updateSecondaryBuyer} />
          </div>
        )}
      </div>

      <StepNav onPrev={onPrev} onNext={onNext} />
    </div>
  );
}

function PersonFields({
  person, onChange,
}: {
  person: PartyPerson; onChange: (field: keyof PartyPerson, value: string) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <div>
        <FieldLabel>First Name</FieldLabel>
        <input className={INPUT_CLASS} value={person.firstName} onChange={(e) => onChange('firstName', e.target.value)} placeholder="First" />
      </div>
      <div>
        <FieldLabel>Middle</FieldLabel>
        <input className={INPUT_CLASS} value={person.middleName} onChange={(e) => onChange('middleName', e.target.value)} placeholder="Middle" />
      </div>
      <div>
        <FieldLabel>Last Name</FieldLabel>
        <input className={INPUT_CLASS} value={person.lastName} onChange={(e) => onChange('lastName', e.target.value)} placeholder="Last" />
      </div>
    </div>
  );
}
