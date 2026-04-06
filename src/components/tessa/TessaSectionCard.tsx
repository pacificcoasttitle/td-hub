'use client'

import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

interface TessaSectionCardProps {
  title: string
  iconLetter: string
  iconColor: string
  /** Badge text shown right of title (e.g. "3 items") */
  badge?: string
  /** Whether the card starts expanded */
  defaultOpen?: boolean
  children: ReactNode
}

export function TessaSectionCard({
  title,
  iconLetter,
  iconColor,
  badge,
  defaultOpen = false,
  children,
}: TessaSectionCardProps) {
  const [open, setOpen] = useState(defaultOpen)

  const isSummary = title.toUpperCase().includes('SUMMARY')

  return (
    <div
      className={`rounded-xl border overflow-hidden transition-shadow hover:shadow-sm ${
        isSummary
          ? 'bg-blue-50/60 border-blue-200'
          : 'bg-white border-gray-200'
      }`}
    >
      {/* ── Header button ── */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-6 py-4 text-left"
        aria-expanded={open}
      >
        {/* Icon */}
        <span
          className="flex-shrink-0 w-7 h-7 rounded-md flex items-center justify-center text-white text-xs font-black"
          style={{ backgroundColor: iconColor }}
          aria-hidden
        >
          {iconLetter}
        </span>

        {/* Title */}
        <span className="flex-1 text-sm font-semibold text-gray-800 uppercase tracking-wide">
          {title}
        </span>

        {/* Badge */}
        {badge && (
          <span className="hidden sm:inline-flex px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-xs font-semibold border border-gray-200">
            {badge}
          </span>
        )}

        {/* Chevron */}
        <ChevronDown
          size={16}
          className={`flex-shrink-0 text-gray-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {/* ── Collapsible body ── */}
      {open && (
        <div className="px-6 pb-6 pt-3 border-t border-gray-100 tessa-card-body-enter">
          {children}
        </div>
      )}
    </div>
  )
}
