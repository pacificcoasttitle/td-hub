'use client'

import type { RequirementSeverity } from '@/lib/tessa/tessa-types'

interface Props {
  severity: RequirementSeverity | string
}

const CONFIG: Record<string, { label: string; className: string }> = {
  blocker: {
    label: '🔴 BLOCKER',
    className: 'inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-red-100 text-red-800 border border-red-300',
  },
  material: {
    label: '🟡 MATERIAL',
    className: 'inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300',
  },
  informational: {
    label: '🔵 INFO',
    className: 'inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-blue-100 text-blue-800 border border-blue-300',
  },
}

export function TessaSeverityBadge({ severity }: Props) {
  const key = (severity || 'material').toLowerCase()
  const cfg = CONFIG[key] || CONFIG.material
  return <span className={cfg.className}>{cfg.label}</span>
}
