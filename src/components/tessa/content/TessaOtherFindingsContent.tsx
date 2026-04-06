'use client'

import type { ExtractedOtherFinding } from '@/lib/tessa/tessa-types'

interface Props {
  findings: ExtractedOtherFinding[]
}

const IMPACT_STYLE: Record<string, string> = {
  high:   'bg-red-50    text-red-700    border-red-200',
  medium: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  low:    'bg-gray-50   text-gray-600   border-gray-200',
}

export function TessaOtherFindingsContent({ findings }: Props) {
  if (!findings.length) {
    return <p className="text-sm text-gray-500 italic">No additional findings.</p>
  }

  return (
    <ul className="space-y-3">
      {findings.map((f, i) => {
        const impact = f.impact?.toLowerCase() ?? 'low'
        const style  = IMPACT_STYLE[impact] ?? IMPACT_STYLE.low

        return (
          <li key={i} className={`rounded-xl border p-4 ${style}`}>
            <div className="flex flex-wrap items-center gap-2 mb-1">
              {f.type && (
                <span className="text-xs font-bold uppercase tracking-wide">{f.type}</span>
              )}
              {f.item_number !== null && f.item_number !== undefined && (
                <span className="text-xs text-gray-500">Item #{f.item_number}</span>
              )}
              {f.impact && (
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-white/70 border border-current">
                  {f.impact} impact
                </span>
              )}
            </div>

            <p className="text-sm leading-snug">{f.description}</p>

            {f.action && (
              <p className="text-xs mt-1 font-medium">→ {f.action}</p>
            )}
            {f.recording_ref && (
              <p className="text-xs text-gray-500 mt-0.5">Ref: {f.recording_ref}</p>
            )}
          </li>
        )
      })}
    </ul>
  )
}
