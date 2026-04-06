'use client'

import type { ExtractedLien } from '@/lib/tessa/tessa-types'

interface Props {
  liens: ExtractedLien[]
}

function DotCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2 items-start py-2.5 border-b border-gray-100 last:border-0">
      <span className="mt-1.5 flex-shrink-0 w-2 h-2 rounded-full bg-red-400" aria-hidden />
      <div className="flex-1 min-w-0 text-sm text-gray-800">{children}</div>
    </div>
  )
}

export function TessaLiensContent({ liens }: Props) {
  if (!liens.length) {
    return (
      <div className="flex items-center gap-2 py-1">
        <span className="text-green-500 text-lg">✓</span>
        <p className="text-sm text-green-700 font-medium">No liens or judgments detected.</p>
      </div>
    )
  }

  return (
    <div>
      {liens.map((lien, i) => (
        <DotCard key={i}>
          <div className="flex flex-wrap items-center gap-2 mb-0.5">
            {lien.type && (
              <span className="text-xs font-bold uppercase text-red-700 tracking-wide">{lien.type}</span>
            )}
            {lien.amount && (
              <span className="text-xs font-semibold text-gray-700 bg-gray-100 px-2 py-0.5 rounded-full">
                {lien.amount}
              </span>
            )}
            <span className="text-xs text-gray-400">#{lien.position}</span>
          </div>

          {lien.beneficiary && (
            <p className="text-xs text-gray-700 font-medium">
              Beneficiary: <span className="font-normal">{lien.beneficiary}</span>
            </p>
          )}
          {lien.trustor && (
            <p className="text-xs text-gray-500 mt-0.5">
              Trustor: <span className="font-medium">{lien.trustor}</span>
            </p>
          )}
          {lien.assigned_to && (
            <p className="text-xs text-gray-500 mt-0.5">
              Assigned to: <span className="font-medium">{lien.assigned_to}</span>
            </p>
          )}
          {lien.recording_date && (
            <p className="text-xs text-gray-500 mt-0.5">
              Recorded: <span className="font-medium">{lien.recording_date}</span>
            </p>
          )}
          {lien.recording_ref && (
            <p className="text-xs text-gray-500 mt-0.5">
              Ref: <span className="font-medium">{lien.recording_ref}</span>
            </p>
          )}
          {lien.action_required && (
            <p className="text-xs text-blue-700 font-medium mt-1">
              → {lien.action_required}
            </p>
          )}
        </DotCard>
      ))}
    </div>
  )
}
