'use client'

import { useEffect, useCallback, useRef } from 'react'
import { X } from 'lucide-react'
import { usePrelimAnalysis } from '@/hooks/usePrelimAnalysis'
import { TessaPrelimResults } from './TessaPrelimResults'

// ── Progress bar ──────────────────────────────────────────────
function ProgressBar({ progress, label }: { progress: number; label: string }) {
  const isActive = progress > 0 && progress < 100
  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center text-sm">
        <span className="text-gray-600 font-medium">{label}</span>
        <span className="text-gray-400 tabular-nums">{progress}%</span>
      </div>
      <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${isActive ? 'tessa-progress-shimmer' : ''}`}
          style={{
            width: `${progress}%`,
            background: 'linear-gradient(90deg, #f26b2b, #e05a1f)',
          }}
        />
      </div>
    </div>
  )
}

// ── Step indicator ────────────────────────────────────────────
const STEPS = [
  { key: 'extracting',      label: 'Extracting PDF text…',    icon: '📄' },
  { key: 'computing_facts', label: 'Computing facts…',        icon: '🔍' },
  { key: 'analyzing',       label: 'Extracting findings…',    icon: '🤖' },
  { key: 'validating',      label: 'Validating results…',     icon: '✅' },
  { key: 'summarizing',     label: 'Generating summary…',     icon: '📝' },
]

const PROCESSING_STATUSES = new Set([
  'extracting',
  'computing_facts',
  'analyzing',
  'validating',
  'summarizing',
])

function StepIndicator({ status }: { status: string }) {
  return (
    <ol className="flex items-center gap-2 mt-4 flex-wrap">
      {STEPS.map((step, i) => {
        const stepIdx = STEPS.findIndex((s) => s.key === status)
        const done   = i < stepIdx
        const active = step.key === status
        return (
          <li key={step.key} className="flex items-center gap-1.5">
            <span
              className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-colors
                ${done   ? 'bg-green-500 border-green-500 text-white'
                : active ? 'bg-[#f26b2b] border-[#f26b2b] text-white animate-pulse'
                :          'bg-gray-100 border-gray-300 text-gray-400'}`}
            >
              {done ? '✓' : step.icon}
            </span>
            <span
              className={`text-xs hidden sm:block ${
                active ? 'text-gray-800 font-semibold' : done ? 'text-green-700' : 'text-gray-400'
              }`}
            >
              {step.label}
            </span>
            {i < STEPS.length - 1 && (
              <span className="text-gray-300 text-xs mx-1 hidden sm:block">→</span>
            )}
          </li>
        )
      })}
    </ol>
  )
}

// ── Main Modal ────────────────────────────────────────────────
interface Props {
  isOpen: boolean
  onClose: () => void
  file: File | null
}

export function TessaPrelimModal({ isOpen, onClose, file }: Props) {
  const {
    status,
    progress,
    progressLabel,
    extracted,
    summary,
    facts,
    cheatSheetItems,
    error,
    fileName,
    analyzePrelim,
    reset,
  } = usePrelimAnalysis()

  const bodyRef = useRef<HTMLDivElement>(null)

  // Kick off analysis when modal opens with a file
  useEffect(() => {
    if (isOpen && file && status === 'idle') {
      analyzePrelim(file)
    }
  }, [isOpen, file, status, analyzePrelim])

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  // Scroll to top when results appear
  useEffect(() => {
    if (status === 'complete' && bodyRef.current) {
      bodyRef.current.scrollTop = 0
    }
  }, [status])

  const handleClose = useCallback(() => {
    reset()
    onClose()
  }, [reset, onClose])

  const handleReset = useCallback(() => {
    reset()
    onClose()
  }, [reset, onClose])

  if (!isOpen) return null

  const isProcessing = PROCESSING_STATUSES.has(status)
  const isComplete   = status === 'complete'
  const hasError     = status === 'error'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/50 backdrop-blur-sm tessa-modal-backdrop"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose() }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl flex flex-col tessa-modal-enter
        h-full max-h-full sm:max-h-[88vh]">

        {/* ── Header ── */}
        <div className="flex-shrink-0 flex items-start justify-between px-8 pt-6 pb-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#f26b2b] flex items-center justify-center text-white font-black text-base flex-shrink-0">
              T
            </div>
            <div>
              <h2 className="text-lg font-black text-gray-900 leading-tight">TESSA™ Prelim Analysis</h2>
              {fileName && (
                <p className="text-xs text-gray-500 truncate max-w-xs sm:max-w-sm">
                  📄 {fileName}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close"
            className="flex-shrink-0 ml-4 p-2 rounded-xl hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* ── Progress (shown while processing) ── */}
        {isProcessing && (
          <div className="flex-shrink-0 px-8 py-4 border-b border-gray-100 bg-gray-50/70 space-y-3">
            <ProgressBar progress={progress} label={progressLabel} />
            <StepIndicator status={status} />
          </div>
        )}

        {/* ── Scrollable body ── */}
        <div
          ref={bodyRef}
          className="flex-1 overflow-y-auto tessa-modal-body px-8 py-6"
        >

          {/* Processing: dimmed placeholder cards */}
          {isProcessing && (
            <div className="space-y-3 opacity-40 pointer-events-none select-none">
              {['TITLE REQUIREMENTS', 'SUMMARY', 'PROPERTY INFORMATION', 'LIENS AND JUDGMENTS', 'TAXES AND ASSESSMENTS'].map((title) => (
                <div key={title} className="rounded-xl border border-gray-200 bg-white px-5 py-4 flex items-center gap-3">
                  <div className="w-6 h-6 rounded-full bg-gray-200 animate-pulse flex-shrink-0" />
                  <div className="flex-1 space-y-1">
                    <div className="h-3 bg-gray-200 rounded animate-pulse w-48" />
                    <div className="h-2 bg-gray-100 rounded animate-pulse w-64" />
                  </div>
                </div>
              ))}
              <p className="text-center text-xs text-gray-400 pt-2">
                Results will appear here after analysis completes…
              </p>
            </div>
          )}

          {/* Error */}
          {hasError && (
            <div className="text-center space-y-5 py-8">
              <p className="text-4xl">😕</p>
              <div>
                <h3 className="text-lg font-bold text-red-700 mb-2">Analysis Failed</h3>
                <p className="text-sm text-gray-600 bg-red-50 border border-red-200 rounded-xl px-5 py-3 max-w-md mx-auto">
                  {error}
                </p>
              </div>
              <button
                type="button"
                onClick={handleClose}
                className="py-2.5 px-6 rounded-xl bg-[#f26b2b] text-white font-bold text-sm hover:bg-[#e05a1f] transition-colors"
              >
                Close &amp; Try Again
              </button>
            </div>
          )}

          {/* Results */}
          {isComplete && extracted && (
            <div>
              {/* ── Results divider ── */}
              <div className="flex items-center gap-3 mb-5">
                <div className="flex-1 h-px bg-gray-200" />
                <span className="text-xs font-bold tracking-widest uppercase text-gray-400 px-2">
                  ✅ Analysis Complete
                </span>
                <div className="flex-1 h-px bg-gray-200" />
              </div>

              <TessaPrelimResults
                extracted={extracted}
                summary={summary}
                facts={facts}
                cheatSheetItems={cheatSheetItems}
                fileName={fileName ?? ''}
                onReset={handleReset}
              />
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="flex-shrink-0 px-8 py-4 border-t border-gray-100 bg-gray-50/60 flex flex-col sm:flex-row items-center justify-between gap-2 rounded-b-2xl">
          <p className="text-xs text-gray-500 text-center sm:text-left">
            📞 Questions? Call PCT: <a href="tel:+18667241050" className="text-[#f26b2b] font-semibold hover:underline">(866) 724-1050</a>
          </p>
          <p className="text-xs text-gray-400 text-center sm:text-right max-w-xs">
            ⚠️ AI-generated summary for informational purposes only. Read the full prelim and contact your title officer.
          </p>
        </div>
      </div>
    </div>
  )
}
