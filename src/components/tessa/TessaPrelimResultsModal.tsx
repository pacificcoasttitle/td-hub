'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { TessaPrelimResults } from './TessaPrelimResults';
import type { ExtractedAnalysis } from '@/lib/tessa/tessa-types';

type AnalysisStatus = 'idle' | 'loading' | 'polling' | 'complete' | 'failed' | 'not_found' | 'triggering';

interface AnalysisData {
  extracted: ExtractedAnalysis;
  summary: string;
  fileName: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  orderId: number;
  fileNumber: string;
}

const PIPELINE_STEPS = ['pending', 'extracting', 'computing_facts', 'analyzing', 'validating', 'summarizing'];

const STEP_LABELS: Record<string, string> = {
  pending: 'Queued…',
  extracting: 'Extracting PDF text…',
  computing_facts: 'Computing facts…',
  analyzing: 'Analyzing document…',
  validating: 'Validating findings…',
  summarizing: 'Generating summary…',
};

const MAX_POLLS = 60;

export function TessaPrelimResultsModal({ isOpen, onClose, orderId, fileNumber }: Props) {
  const [status, setStatus] = useState<AnalysisStatus>('idle');
  const [pipelineStep, setPipelineStep] = useState('pending');
  const [data, setData] = useState<AnalysisData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollCountRef = useRef(0);
  const inflightRef = useRef(false);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) { clearInterval(pollRef.current); pollRef.current = null; }
    pollCountRef.current = 0;
  }, []);

  const fetchFull = useCallback(async (reason: string) => {
    console.log(`[TESSA Modal] fetchFull called, reason: ${reason}`);
    try {
      const res = await fetch(`/api/orders/${orderId}/prelim-analysis`);
      if (res.status === 404) { setStatus('not_found'); return; }
      if (!res.ok) { setStatus('failed'); setError(`Failed to load (${res.status})`); return; }

      const body = await res.json();
      if (body.status === 'complete' && body.extractionJson) {
        setData({
          extracted: body.extractionJson as ExtractedAnalysis,
          summary: body.summaryText ?? '',
          fileName: fileNumber,
        });
        setStatus('complete');
      } else if (body.status === 'failed') {
        setStatus('failed');
        setError(body.errorMessage ?? 'Analysis failed');
      } else {
        setPipelineStep(body.status ?? 'pending');
        setStatus('polling');
      }
    } catch {
      setStatus('failed');
      setError('Network error loading analysis');
    }
  }, [orderId, fileNumber]);

  const startPolling = useCallback(() => {
    stopPolling();
    setStatus('polling');
    pollCountRef.current = 0;
    pollRef.current = setInterval(async () => {
      pollCountRef.current++;
      if (pollCountRef.current >= MAX_POLLS) {
        stopPolling();
        setStatus('failed');
        setError('Analysis timed out — please try again');
        return;
      }
      try {
        const res = await fetch(`/api/orders/${orderId}/prelim-analysis/status`);
        if (res.status === 404) { setPipelineStep('pending'); return; }
        if (!res.ok) return;
        const body = await res.json();
        if (body.status === 'not_started' || body.status === 'not_found') { setPipelineStep('pending'); return; }
        setPipelineStep(body.status ?? 'pending');
        if (body.status === 'complete') {
          console.log('[TESSA Modal] Polling saw complete');
          stopPolling();
          fetchFull('poll-complete');
        }
        if (body.status === 'failed') {
          console.log('[TESSA Modal] Polling saw failed');
          stopPolling();
          setStatus('failed');
          setError(body.error ?? 'Analysis failed');
        }
      } catch { /* network error — keep polling */ }
    }, 3000);
  }, [orderId, stopPolling, fetchFull]);

  const triggerAnalysis = useCallback(async (force = false) => {
    if (inflightRef.current) return;
    inflightRef.current = true;
    console.log('[TESSA Modal] triggerAnalysis start, force:', force);
    setStatus('triggering');
    setPipelineStep('pending');
    setError(null);
    try {
      const url = `/api/orders/${orderId}/analyze-prelim${force ? '?force=true' : ''}`;
      const res = await fetch(url, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      console.log('[TESSA Modal] POST response:', res.status, 'body.status:', body.status, 'cached:', body.cached);

      // A) HTTP error
      if (!res.ok) {
        setStatus('failed');
        setError(body.detail || body.error || 'Analysis failed');
        return;
      }

      // E) Cached complete — fetch full results
      if (body.cached) {
        fetchFull('manual-cached');
        return;
      }

      // B) Pipeline finished complete
      if (body.status === 'complete') {
        fetchFull('manual-complete');
        return;
      }

      // C) Pipeline finished failed
      if (body.status === 'failed') {
        setStatus('failed');
        setError('Analysis failed — check the prelim document and try again');
        return;
      }

      // D) Pipeline returned an in-progress status (shouldn't normally happen
      //    since analyzePrelim awaits the full pipeline, but handle defensively)
      startPolling();
    } catch {
      setStatus('failed');
      setError('Network error — please try again');
    } finally {
      inflightRef.current = false;
    }
  }, [orderId, fetchFull, startPolling]);

  useEffect(() => {
    if (!isOpen) { stopPolling(); setStatus('idle'); setData(null); setError(null); return; }
    setStatus('loading');
    fetchFull('open');
    return stopPolling;
  }, [isOpen, fetchFull, stopPolling]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between px-6 py-4 bg-[#1B2A4A] text-white">
        <div className="flex items-center gap-3">
          <span className="w-8 h-8 rounded-lg bg-[#F26B2B] flex items-center justify-center text-white text-sm font-black flex-shrink-0">T</span>
          <div>
            <h2 className="text-base font-bold leading-tight">TESSA™ Prelim Analysis</h2>
            <p className="text-xs text-white/70">{fileNumber}</p>
          </div>
        </div>
        <button onClick={onClose} aria-label="Close"
          className="p-2 rounded-lg hover:bg-white/10 transition-colors">
          <X size={20} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-6 py-8">
          {status === 'loading' && <LoadingSkeleton />}
          {status === 'polling' && <PollingState step={pipelineStep} />}
          {status === 'triggering' && <PollingState step="pending" />}
          {status === 'not_found' && <NoAnalysisState onTrigger={() => triggerAnalysis(false)} />}
          {status === 'failed' && <FailedState error={error} onRetry={() => triggerAnalysis(true)} />}
          {status === 'complete' && data && (
            <TessaPrelimResults
              extracted={data.extracted}
              summary={data.summary}
              fileName={data.fileName}
              onReset={onClose}
            />
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 px-6 py-3 border-t border-gray-200 bg-gray-50">
        <p className="text-xs text-gray-400 text-center">
          AI-generated analysis for informational purposes only. Review with your title officer before relying on this analysis.
        </p>
      </div>
    </div>
  );
}

function PollingState({ step }: { step: string }) {
  const idx = PIPELINE_STEPS.indexOf(step);
  return (
    <div className="flex flex-col items-center py-16 gap-6">
      <div className="w-14 h-14 rounded-2xl bg-[#F26B2B] flex items-center justify-center text-white text-2xl font-black animate-pulse">T</div>
      <div className="text-center">
        <h3 className="text-lg font-bold text-gray-900 mb-1">Analyzing Prelim…</h3>
        <p className="text-sm text-gray-500">{STEP_LABELS[step] ?? 'Processing…'}</p>
      </div>
      <ol className="flex items-center gap-1.5 flex-wrap justify-center">
        {PIPELINE_STEPS.map((s, i) => {
          const done = i < idx;
          const active = s === step;
          return (
            <li key={s} className="flex items-center gap-1.5">
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-colors ${
                done ? 'bg-green-500 border-green-500 text-white'
                  : active ? 'bg-[#F26B2B] border-[#F26B2B] text-white animate-pulse'
                    : 'bg-gray-100 border-gray-300 text-gray-400'
              }`}>{done ? '✓' : i + 1}</span>
              {i < PIPELINE_STEPS.length - 1 && <span className="text-gray-300 text-xs">→</span>}
            </li>
          );
        })}
      </ol>
      <p className="text-xs text-gray-400">This usually takes 15–30 seconds</p>
    </div>
  );
}

function NoAnalysisState({ onTrigger }: { onTrigger: () => void }) {
  return (
    <div className="flex flex-col items-center py-16 gap-5">
      <div className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center text-gray-400 text-2xl font-black">T</div>
      <div className="text-center">
        <h3 className="text-lg font-bold text-gray-900 mb-1">No Analysis Yet</h3>
        <p className="text-sm text-gray-500">This prelim has not been analyzed yet.</p>
      </div>
      <button onClick={onTrigger}
        className="px-6 py-2.5 bg-[#F26B2B] text-white text-sm font-semibold rounded-lg hover:bg-[#E05A1A] transition-colors">
        Run Analysis
      </button>
    </div>
  );
}

function FailedState({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center py-16 gap-5">
      <div className="w-14 h-14 rounded-2xl bg-red-50 flex items-center justify-center text-red-500 text-2xl font-black">!</div>
      <div className="text-center">
        <h3 className="text-lg font-bold text-red-700 mb-1">Analysis Failed</h3>
        {error && <p className="text-sm text-gray-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2 max-w-md">{error}</p>}
      </div>
      <button onClick={onRetry}
        className="px-6 py-2.5 bg-[#F26B2B] text-white text-sm font-semibold rounded-lg hover:bg-[#E05A1A] transition-colors">
        Retry Analysis
      </button>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-24 bg-gray-100 rounded-xl" />
      <div className="h-40 bg-gray-100 rounded-xl" />
      <div className="h-32 bg-gray-100 rounded-xl" />
    </div>
  );
}
