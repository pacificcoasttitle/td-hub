'use client'

import type { ReactNode } from 'react'

// ── Key-Value row ─────────────────────────────────────────────────────────────
export function KV({
  label,
  children,
  mono = false,
}: {
  label: string
  children: ReactNode
  mono?: boolean
}) {
  return (
    <div className="flex justify-between items-baseline py-2.5 border-b border-gray-100 last:border-0 gap-4">
      <span className="text-xs uppercase tracking-widest text-gray-400 font-medium shrink-0 mr-6">
        {label}
      </span>
      <span className={`text-sm text-right ${mono ? 'font-mono' : ''} text-gray-800`}>
        {children}
      </span>
    </div>
  )
}

// ── Dollar amount ─────────────────────────────────────────────────────────────
export function Dollar({
  amount,
  size = 'normal',
}: {
  amount: string
  size?: 'normal' | 'large'
}) {
  return (
    <span
      className={
        size === 'large'
          ? 'text-lg font-bold text-gray-900 tabular-nums'
          : 'font-semibold text-gray-900 tabular-nums'
      }
    >
      {amount}
    </span>
  )
}

// ── Recording reference ───────────────────────────────────────────────────────
export function Recording({ num, date }: { num: string; date?: string }) {
  return (
    <span className="text-xs text-gray-400 font-mono">
      {num}
      {date ? ` · ${date}` : ''}
    </span>
  )
}

// ── Tax/installment status badge ──────────────────────────────────────────────
export function StatusBadge({ status }: { status: string }) {
  const s = status?.toLowerCase()
  if (s === 'paid')
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
        ✓ PAID
      </span>
    )
  if (s === 'open')
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">
        ◷ OPEN
      </span>
    )
  if (s === 'delinquent')
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold bg-red-50 text-red-700 border border-red-200">
        ✕ DELINQUENT
      </span>
    )
  return <span className="text-xs text-gray-400 italic">{status}</span>
}

// ── Severity badge (inline pill) ──────────────────────────────────────────────
export function SeverityBadgeInline({ severity }: { severity: string }) {
  const s = severity?.toLowerCase()
  if (s?.startsWith('block'))
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold tracking-wide bg-red-50 border border-red-200 text-red-700">
        <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
        BLOCKER
      </span>
    )
  if (s?.startsWith('info') || s === 'informational')
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold tracking-wide bg-blue-50 border border-blue-200 text-blue-600">
        <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
        INFO
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold tracking-wide bg-amber-50 border border-amber-200 text-amber-700">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
      MATERIAL
    </span>
  )
}
