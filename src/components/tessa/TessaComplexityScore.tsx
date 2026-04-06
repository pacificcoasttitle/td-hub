'use client'

import type { ExtractedAnalysis, PrelimFacts } from '@/lib/tessa/tessa-types'

// ── Scoring ───────────────────────────────────────────────────

interface ScoreResult {
  score: number   // 0-100
  label: 'Low' | 'Moderate' | 'High' | 'Very High'
  color: string
  bg: string
  reasons: string[]
}

function computeScore(extracted: ExtractedAnalysis, facts?: PrelimFacts | null): ScoreResult {
  let score = 0
  const reasons: string[] = []

  const liens  = extracted.liens ?? []
  const taxes  = extracted.taxes ?? []
  const reqs   = extracted.title_requirements ?? []
  const other  = extracted.other_findings ?? []
  const ds     = extracted.document_status

  // Liens
  if (liens.length >= 1) { score += 10; reasons.push(`${liens.length} lien${liens.length > 1 ? 's' : ''} on record`) }
  if (liens.length >= 3) { score += 10; reasons.push('Multiple liens detected') }
  const hasHOA  = liens.some((l) => /hoa|homeowner/i.test(l.type ?? ''))
  const hasJudg = liens.some((l) => /judgment/i.test(l.type ?? ''))
  if (hasHOA)  { score += 5;  reasons.push('HOA lien present') }
  if (hasJudg) { score += 15; reasons.push('Judgment lien detected') }

  // Taxes
  const unpaid = taxes.filter(
    (t) =>
      /unpaid|delinquent/i.test(t.first_installment?.status ?? '') ||
      /unpaid|delinquent/i.test(t.second_installment?.status ?? '')
  )
  if (unpaid.length > 0) { score += 20; reasons.push(`${unpaid.length} delinquent tax parcel${unpaid.length > 1 ? 's' : ''}`) }

  // Requirements
  if (reqs.length >= 5)  { score += 10; reasons.push(`${reqs.length} title requirements`) }
  if (reqs.length >= 10) { score += 10; reasons.push('High number of requirements') }

  // Blockers
  const blockers = reqs.filter((r) => r.severity === 'blocker')
  if (blockers.length > 0) { score += 15; reasons.push(`${blockers.length} blocking requirement${blockers.length > 1 ? 's' : ''}`) }

  // Other findings
  if (other.length >= 3) { score += 10; reasons.push(`${other.length} other findings`) }

  // High-impact findings
  const highImpact = other.filter((f) => f.impact === 'high')
  if (highImpact.length > 0) { score += 10; reasons.push(`${highImpact.length} high-impact finding${highImpact.length > 1 ? 's' : ''}`) }

  // Document status
  if (ds?.missing_sections && ds.missing_sections.length > 0) {
    score += 8; reasons.push('Missing document sections')
  }

  // Foreclosure / recent conveyance
  if (extracted.foreclosure_detected) { score += 20; reasons.push('Foreclosure activity detected') }
  if (extracted.recent_conveyance_detected) { score += 5; reasons.push('Recent conveyance') }

  // Facts augmentation
  const exceptions = facts?.requirements?.length ?? 0
  if (exceptions >= 8)  { score += 5 }
  if (exceptions >= 15) { score += 5 }

  score = Math.min(score, 100)

  if (score <= 25) return { score, label: 'Low',       color: '#16a34a', bg: 'bg-green-50 border-green-200',   reasons }
  if (score <= 50) return { score, label: 'Moderate',  color: '#d97706', bg: 'bg-yellow-50 border-yellow-200', reasons }
  if (score <= 75) return { score, label: 'High',      color: '#ea580c', bg: 'bg-orange-50 border-orange-200', reasons }
  return              { score, label: 'Very High', color: '#dc2626', bg: 'bg-red-50 border-red-200',       reasons }
}

// ── Gauge arc ─────────────────────────────────────────────────

function ScoreGauge({ score, color }: { score: number; color: string }) {
  const r = 42
  const circumference = Math.PI * r
  const fill = circumference * (score / 100)

  return (
    <svg viewBox="0 0 104 60" className="w-24 h-14" aria-hidden>
      <path
        d={`M 10 52 A ${r} ${r} 0 0 1 94 52`}
        fill="none" stroke="#e5e7eb" strokeWidth="8" strokeLinecap="round"
      />
      <path
        d={`M 10 52 A ${r} ${r} 0 0 1 94 52`}
        fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
        strokeDasharray={`${fill} ${circumference}`}
        style={{ transition: 'stroke-dasharray 0.8s ease' }}
      />
      <text x={52} y={48} textAnchor="middle" fill={color} fontSize="16" fontWeight="900" fontFamily="sans-serif">
        {score}
      </text>
    </svg>
  )
}

// ── Component ──────────────────────────────────────────────────

interface Props {
  extracted: ExtractedAnalysis
  facts?: PrelimFacts | null
}

export function TessaComplexityScore({ extracted, facts }: Props) {
  const { score, label, color, bg, reasons } = computeScore(extracted, facts)
  const address = extracted.property_info?.address ?? facts?.property?.address ?? null

  return (
    <div className={`rounded-2xl border-2 p-5 ${bg} flex flex-col sm:flex-row items-start sm:items-center gap-5`}>
      {/* Gauge */}
      <div className="flex flex-col items-center gap-1 flex-shrink-0">
        <ScoreGauge score={score} color={color} />
        <span className="text-xs font-black tracking-wider uppercase" style={{ color }}>
          {label} Complexity
        </span>
      </div>

      {/* Details */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-bold text-gray-800 mb-0.5">Complexity Assessment</h3>
            {address && <p className="text-xs text-gray-500 truncate max-w-xs">{address}</p>}
          </div>
          <span className="text-2xl font-black flex-shrink-0" style={{ color }}>{score}/100</span>
        </div>

        {reasons.length > 0 ? (
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {reasons.map((r, i) => (
              <li key={i} className="text-xs bg-white/70 border border-gray-200 text-gray-700 px-2.5 py-1 rounded-full font-medium">
                {r}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-gray-500">No significant complexity factors detected.</p>
        )}
      </div>
    </div>
  )
}
