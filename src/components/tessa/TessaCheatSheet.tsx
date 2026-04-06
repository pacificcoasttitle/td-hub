'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { TessaSeverityBadge } from './TessaSeverityBadge'
import type { CheatSheetItem, PrelimFacts } from '@/lib/tessa/tessa-types'

interface Props {
  items: CheatSheetItem[]
  facts: PrelimFacts | null
}

export function TessaCheatSheet({ items, facts }: Props) {
  const [expanded, setExpanded] = useState(false)

  const taxDefaults = facts?.taxes?.tax_defaults || []

  if (!items.length && !taxDefaults.length) return null

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden hover:shadow-md transition-shadow">
      {/* Header */}
      <button
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-gray-50 transition-colors"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
      >
        {/* Colored square icon — matches section card style */}
        <span className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold flex-shrink-0 bg-amber-500">
          🧭
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-gray-900 text-sm tracking-tight">
              REALTOR CHEAT SHEET
            </span>
            <span className="text-xs font-medium text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
              {items.length}
            </span>
          </div>
          {!expanded && (
            <p className="text-xs text-gray-500 mt-0.5">Plain-English explanations for your clients</p>
          )}
        </div>
        <span className="flex-shrink-0 text-gray-400">
          {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        </span>
      </button>

      {/* Body */}
      {expanded && (
        <div className="px-5 pb-5 pt-1 border-t border-gray-100 space-y-4 tessa-card-body-enter">
          <p className="text-sm text-gray-500 mb-2">
            Use this as your quick talk track with sellers/buyers. It explains <strong>what</strong> is needed,{' '}
            <strong>who</strong> typically supplies it, and <strong>why</strong> it impacts closing.
          </p>

          {items.map((item, i) => {
            const itemLabel =
              item.itemNumbers.length > 1
                ? `Items #${item.itemNumbers.join(' & #')}`
                : item.itemNumbers.length === 1
                ? `Item #${item.itemNumbers[0]}`
                : 'Item'

            return (
              <div
                key={i}
                className="border border-gray-200 rounded-xl p-4 bg-white space-y-2"
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-amber-100 text-amber-900 font-bold text-xs">
                    {itemLabel}
                  </span>
                  <TessaSeverityBadge severity={item.severity} />
                </div>
                <p className="font-semibold text-gray-900 text-sm">{item.label}</p>
                <p className="text-xs text-gray-600">
                  <span className="text-gray-400">Why it matters:</span> {item.whyItMatters}
                </p>
                <div className="flex gap-4 text-xs text-gray-500">
                  <span><strong>Who:</strong> {item.who}</span>
                  <span><strong>Timing:</strong> {item.timing}</span>
                </div>
                <div className="bg-blue-50 border-l-4 border-blue-300 rounded-r-lg px-3 py-2 text-xs text-blue-800">
                  <strong>Agent script:</strong> &ldquo;{item.agentScript}&rdquo;
                </div>
              </div>
            )
          })}

          {/* Tax Default Callout */}
          {taxDefaults.length > 0 && (
            <div className="bg-red-50 border-l-4 border-red-500 rounded-r-xl px-4 py-3 space-y-1">
              <p className="font-bold text-red-700 text-sm">🔥 Tax Default / Redemption Alert</p>
              <p className="text-xs text-red-700">
                This file shows <strong>{taxDefaults.length}</strong> tax-default item(s). Redemption amounts
                and deadlines can change monthly.{' '}
                {taxDefaults[0]?.redemption_schedule?.[0] && (
                  <>
                    Example:{' '}
                    <strong>{taxDefaults[0].redemption_schedule[0].amount}</strong> due by{' '}
                    <strong>{taxDefaults[0].redemption_schedule[0].by}</strong>.
                  </>
                )}
              </p>
              <p className="text-xs text-red-700 mt-1">
                <strong>Agent script:</strong> &ldquo;This property is in tax default. We&apos;ll need a
                redemption payoff from the county and it must be cleared before closing to avoid tax
                foreclosure risk.&rdquo;
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
