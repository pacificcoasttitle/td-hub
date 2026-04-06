'use client'

import type { ExtractedTax } from '@/lib/tessa/tessa-types'

interface Props {
  taxes: ExtractedTax[]
}

const STATUS_STYLE: Record<string, string> = {
  paid:       'text-green-700  bg-green-100  border-green-300',
  open:       'text-yellow-700 bg-yellow-100 border-yellow-300',
  delinquent: 'text-red-700    bg-red-100    border-red-300',
  defaulted:  'text-red-900    bg-red-200    border-red-400',
}

function InstallmentBadge({ label, installment }: {
  label: string
  installment?: { amount: string; status: string } | null
}) {
  if (!installment) return null
  const style = STATUS_STYLE[installment.status?.toLowerCase() ?? ''] ?? STATUS_STYLE.open
  return (
    <div>
      <span className="text-xs text-gray-500 block">{label}</span>
      <div className="flex items-center gap-1.5 mt-0.5">
        <span className="text-sm font-semibold text-gray-800">{installment.amount}</span>
        <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${style}`}>
          {installment.status}
        </span>
      </div>
    </div>
  )
}

function TaxParcel({ tax }: { tax: ExtractedTax }) {
  const isDelinquent =
    tax.first_installment?.status === 'delinquent' ||
    tax.second_installment?.status === 'delinquent' ||
    tax.first_installment?.status === 'defaulted' ||
    tax.second_installment?.status === 'defaulted'

  return (
    <div className={`rounded-xl border p-4 space-y-3 ${
      isDelinquent ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'
    }`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-mono font-semibold text-gray-600 bg-white border border-gray-200 px-2 py-0.5 rounded">
          ID: {tax.tax_id}
        </span>
        {tax.fiscal_year && (
          <span className="text-xs text-gray-500">FY {tax.fiscal_year}</span>
        )}
        {tax.code_area && (
          <span className="text-xs text-gray-400">Area: {tax.code_area}</span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-2">
        <InstallmentBadge label="1st Installment" installment={tax.first_installment} />
        <InstallmentBadge label="2nd Installment" installment={tax.second_installment} />
      </div>

      {tax.total_tax && (
        <div>
          <span className="text-xs text-gray-500 block">Total Tax</span>
          <span className="text-sm font-bold text-gray-900">{tax.total_tax}</span>
        </div>
      )}
      {tax.exemption && (
        <p className="text-xs text-green-700 font-medium">Exemption: {tax.exemption}</p>
      )}
      {tax.penalties && (
        <p className="text-xs text-red-700 font-medium">Penalties: {tax.penalties}</p>
      )}
    </div>
  )
}

export function TessaTaxContent({ taxes }: Props) {
  if (!taxes.length) {
    return <p className="text-sm text-gray-500 italic">No tax parcels found in this report.</p>
  }

  return (
    <div className="space-y-3">
      {taxes.map((tax, i) => <TaxParcel key={i} tax={tax} />)}
    </div>
  )
}
