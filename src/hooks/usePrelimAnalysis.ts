'use client';

import { useState, useCallback } from 'react';
import type { ExtractedAnalysis, PrelimFacts, CheatSheetItem } from '@/lib/tessa/tessa-types';

type Status = 'idle' | 'extracting' | 'computing_facts' | 'analyzing' | 'validating' | 'summarizing' | 'complete' | 'error';

const STATUS_LABELS: Record<string, string> = {
  idle: 'Ready',
  extracting: 'Extracting PDF text…',
  computing_facts: 'Computing facts…',
  analyzing: 'Extracting findings…',
  validating: 'Validating results…',
  summarizing: 'Generating summary…',
  complete: 'Analysis complete',
  error: 'Analysis failed',
};

const STATUS_PROGRESS: Record<string, number> = {
  idle: 0,
  extracting: 15,
  computing_facts: 30,
  analyzing: 50,
  validating: 70,
  summarizing: 85,
  complete: 100,
  error: 0,
};

interface PrelimAnalysisState {
  status: Status;
  progress: number;
  progressLabel: string;
  extracted: ExtractedAnalysis | null;
  summary: string;
  facts: PrelimFacts | null;
  cheatSheetItems: CheatSheetItem[];
  error: string | null;
  fileName: string | null;
  analyzePrelim: (file: File) => Promise<void>;
  reset: () => void;
}

export function usePrelimAnalysis(): PrelimAnalysisState {
  const [status, setStatus] = useState<Status>('idle');
  const [extracted, setExtracted] = useState<ExtractedAnalysis | null>(null);
  const [summary, setSummary] = useState('');
  const [facts, setFacts] = useState<PrelimFacts | null>(null);
  const [cheatSheetItems, setCheatSheetItems] = useState<CheatSheetItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStatus('idle');
    setExtracted(null);
    setSummary('');
    setFacts(null);
    setCheatSheetItems([]);
    setError(null);
    setFileName(null);
  }, []);

  const analyzePrelim = useCallback(async (file: File) => {
    reset();
    setFileName(file.name);
    setStatus('extracting');

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/tessa/analyze', { method: 'POST', body: formData });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Analysis failed (${res.status})`);
      }

      const data = await res.json();

      setStatus('complete');
      setExtracted(data.extracted ?? null);
      setSummary(data.summary ?? '');
      setFacts(data.facts ?? null);
      setCheatSheetItems(data.cheatSheetItems ?? []);
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  }, [reset]);

  return {
    status,
    progress: STATUS_PROGRESS[status] ?? 0,
    progressLabel: STATUS_LABELS[status] ?? '',
    extracted,
    summary,
    facts,
    cheatSheetItems,
    error,
    fileName,
    analyzePrelim,
    reset,
  };
}
