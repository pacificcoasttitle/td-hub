'use client'

import type { ExtractedAnalysis, PrelimFacts, CheatSheetItem } from '@/lib/tessa/tessa-types'
import { TessaSectionCard }          from './TessaSectionCard'
import { TessaComplexityScore }      from './TessaComplexityScore'
import { TessaRequirementsContent }  from './content/TessaRequirementsContent'
import { TessaSummaryContent }       from './content/TessaSummaryContent'
import { TessaPropertyContent }      from './content/TessaPropertyContent'
import { TessaLiensContent }         from './content/TessaLiensContent'
import { TessaTaxContent }           from './content/TessaTaxContent'
import { TessaOtherFindingsContent } from './content/TessaOtherFindingsContent'
import { TessaDocStatusContent }     from './content/TessaDocStatusContent'

// ── Section icon map ──────────────────────────────────────────
const ICON: Record<string, { letter: string; color: string }> = {
  REQUIREMENTS: { letter: '✓', color: '#16a34a' },
  SUMMARY:      { letter: 'Σ', color: '#2563eb' },
  PROPERTY:     { letter: 'P', color: '#0891b2' },
  LIENS:        { letter: '$', color: '#dc2626' },
  TAXES:        { letter: 'T', color: '#d97706' },
  OTHER:        { letter: '!', color: '#7c3aed' },
  DOCSTATUS:    { letter: 'i', color: '#6b7280' },
}

interface Props {
  extracted: ExtractedAnalysis
  summary: string
  facts?: PrelimFacts | null
  cheatSheetItems?: CheatSheetItem[]
  fileName: string
  onReset: () => void
}

export function TessaPrelimResults({ extracted, summary, facts, cheatSheetItems, fileName, onReset }: Props) {
  const reqs  = extracted.title_requirements ?? []
  const liens = extracted.liens ?? []
  const taxes = extracted.taxes ?? []
  const other = extracted.other_findings ?? []
  const ds    = extracted.document_status
  const prop  = extracted.property_info

  return (
    <div className="space-y-5">
      {/* Complexity Score */}
      <TessaComplexityScore extracted={extracted} facts={facts} />

      {/* SUMMARY */}
      {summary && (
        <TessaSectionCard
          title="Summary"
          iconLetter={ICON.SUMMARY.letter}
          iconColor={ICON.SUMMARY.color}
          defaultOpen
        >
          <TessaSummaryContent summary={summary} />
        </TessaSectionCard>
      )}

      {/* PROPERTY INFORMATION */}
      {prop && (
        <TessaSectionCard
          title="Property Information"
          iconLetter={ICON.PROPERTY.letter}
          iconColor={ICON.PROPERTY.color}
        >
          <TessaPropertyContent prop={prop} />
        </TessaSectionCard>
      )}

      {/* TITLE REQUIREMENTS */}
      {reqs.length > 0 && (
        <TessaSectionCard
          title="Title Requirements"
          iconLetter={ICON.REQUIREMENTS.letter}
          iconColor={ICON.REQUIREMENTS.color}
          badge={`${reqs.length} item${reqs.length !== 1 ? 's' : ''}`}
        >
          <TessaRequirementsContent requirements={reqs} />
        </TessaSectionCard>
      )}

      {/* LIENS AND JUDGMENTS */}
      <TessaSectionCard
        title="Liens & Judgments"
        iconLetter={ICON.LIENS.letter}
        iconColor={ICON.LIENS.color}
        badge={liens.length > 0 ? `${liens.length} found` : 'Clear'}
      >
        <TessaLiensContent liens={liens} />
      </TessaSectionCard>

      {/* TAXES AND ASSESSMENTS */}
      <TessaSectionCard
        title="Taxes & Assessments"
        iconLetter={ICON.TAXES.letter}
        iconColor={ICON.TAXES.color}
        badge={taxes.length > 0 ? `${taxes.length} parcel${taxes.length !== 1 ? 's' : ''}` : 'None'}
      >
        <TessaTaxContent taxes={taxes} />
      </TessaSectionCard>

      {/* OTHER FINDINGS */}
      {other.length > 0 && (
        <TessaSectionCard
          title="Other Findings"
          iconLetter={ICON.OTHER.letter}
          iconColor={ICON.OTHER.color}
          badge={`${other.length} item${other.length !== 1 ? 's' : ''}`}
        >
          <TessaOtherFindingsContent findings={other} />
        </TessaSectionCard>
      )}

      {/* DOCUMENT STATUS */}
      {ds && (
        <TessaSectionCard
          title="Document Status"
          iconLetter={ICON.DOCSTATUS.letter}
          iconColor={ICON.DOCSTATUS.color}
        >
          <TessaDocStatusContent docStatus={ds} />
        </TessaSectionCard>
      )}

      {/* CTA */}
      <div className="flex flex-col sm:flex-row items-center gap-3 pt-3">
        <a
          href="tel:+18667241050"
          className="w-full sm:w-auto flex items-center justify-center gap-2 py-3 px-6 rounded-xl bg-[#F26B2B] text-white font-bold text-sm hover:bg-[#e05a1f] transition-colors"
        >
          📞 Talk to a Title Officer
        </a>
        <button
          type="button"
          onClick={onReset}
          className="w-full sm:w-auto flex items-center justify-center gap-2 py-3 px-6 rounded-xl border-2 border-gray-200 text-gray-600 font-semibold text-sm hover:bg-gray-50 transition-colors"
        >
          ↩ Analyze Another Prelim
        </button>
      </div>

      {/* Disclaimer */}
      <p className="text-xs text-gray-400 text-center pt-2 pb-1">
        TESSA™ is an AI-powered analysis tool. Always review the complete Preliminary Title Report
        and consult a licensed title officer for guidance. ©{new Date().getFullYear()} Pacific Coast Title Company.
      </p>
    </div>
  )
}
