'use client'

import type { ExtractedPropertyInfo } from '@/lib/tessa/tessa-types'

interface Props {
  prop: ExtractedPropertyInfo
}

function Row({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null
  return (
    <div className="flex flex-col sm:flex-row sm:items-baseline gap-0.5 sm:gap-3 py-2 border-b border-gray-100 last:border-0">
      <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide sm:w-40 flex-shrink-0">
        {label}
      </span>
      <span className="text-sm text-gray-800">{value}</span>
    </div>
  )
}

export function TessaPropertyContent({ prop }: Props) {
  const hasData = prop.address || prop.apn || prop.legal_description || prop.vesting

  if (!hasData) {
    return <p className="text-sm text-gray-500 italic">No property information extracted.</p>
  }

  return (
    <div>
      <Row label="Address"            value={prop.address} />
      <Row label="APN"                value={prop.apn} />
      <Row label="Legal Description"  value={prop.legal_description} />
      <Row label="Vesting"            value={prop.vesting} />
      <Row label="Property Type"      value={prop.property_type} />
      <Row label="Ownership"          value={prop.ownership_structure} />
    </div>
  )
}
