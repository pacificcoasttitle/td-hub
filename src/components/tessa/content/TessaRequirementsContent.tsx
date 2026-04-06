'use client'

import type { ExtractedRequirement } from '@/lib/tessa/tessa-types'

interface Props {
  requirements: ExtractedRequirement[]
}

const SEVERITY_BADGE: Record<string, { label: string; cls: string }> = {
  blocker:      { label: 'Blocker',      cls: 'bg-red-100    text-red-700    border-red-200'    },
  material:     { label: 'Material',     cls: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  informational:{ label: 'Informational',cls: 'bg-green-100  text-green-700  border-green-200'  },
}

export function TessaRequirementsContent({ requirements }: Props) {
  if (!requirements.length) {
    return <p className="text-sm text-gray-500 italic">No title requirements found in this report.</p>
  }

  return (
    <ul className="space-y-3">
      {requirements.map((req, i) => {
        const badge = SEVERITY_BADGE[req.severity ?? '']

        return (
          <li key={i} className="flex gap-3 items-start">
            {/* Item number */}
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#f26b2b]/10 text-[#f26b2b] text-xs font-bold flex items-center justify-center mt-0.5">
              {req.item_number ?? i + 1}
            </span>

            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-0.5">
                {req.type && (
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    {req.type}
                  </span>
                )}
                {badge && (
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${badge.cls}`}>
                    {badge.label}
                  </span>
                )}
              </div>

              <p className="text-sm text-gray-800 leading-snug">{req.description}</p>

              {req.action && (
                <p className="text-xs text-blue-700 font-medium mt-1">
                  → {req.action}
                </p>
              )}
              {req.assignee && (
                <p className="text-xs text-gray-500 mt-0.5">
                  Assigned to: <span className="font-medium">{req.assignee}</span>
                </p>
              )}
              {req.related_instrument && (
                <p className="text-xs text-gray-500 mt-0.5">
                  Related instrument: <span className="font-medium">{req.related_instrument}</span>
                </p>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
