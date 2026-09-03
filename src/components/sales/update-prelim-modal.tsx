'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ModalShell } from '@/components/shared/action-modals';

/**
 * Titled for the action it performs. Legacy called this "Add a Note", which
 * described one of the four things it did and none of the reason for doing it.
 */
interface Props {
  open: boolean;
  onClose: () => void;
  orderId: number;
  fileNumber: string;
  /**
   * Whether the Hub holds an active prelim for this order. The button is not
   * gated on it, so this is a notice rather than a block — the rep should know
   * they are sending a request about a prelim we do not have, and send it
   * anyway if that is what they mean to do.
   */
  hubHoldsPrelim: boolean;
  onAccepted?: (message: string) => void;
}

const SUBJECT_MAX = 200;
const NOTE_MAX = 4000;
const MAX_PDF_BYTES = 25 * 1024 * 1024;

type Phase = 'form' | 'submitting' | 'tracking';

interface JobStatus {
  jobId: number;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'retrying';
  verifyState: 'confirmed' | 'accepted' | 'failed' | null;
  error: string | null;
}

const STATUS_COPY: Record<JobStatus['status'], string> = {
  queued: 'Queued — waiting to send to SoftPro.',
  running: 'Sending to SoftPro: attaching the PDF, adding the note, opening task 03-005.',
  retrying: 'A step did not complete. Retrying automatically.',
  completed: 'Done. Prelim attached, note added, task 03-005 opened.',
  failed: 'Did not complete.',
};

/**
 * Said out loud rather than folded into "done". A completed job means the task
 * is open either way, but the operator should know whether we actually saw the
 * prelim on the file or only got a 200 back.
 */
const VERIFY_COPY: Record<'confirmed' | 'accepted', string> = {
  confirmed: 'Confirmed on the SoftPro prelim listing.',
  accepted: 'Accepted, unconfirmed — SoftPro took the upload but its prelim listing did not return the file. Almost certainly on the file; we just could not see it there.',
};

export function UpdatePrelimModal({
  open,
  onClose,
  orderId,
  fileNumber,
  hubHoldsPrelim,
  onAccepted,
}: Props) {
  const [subject, setSubject] = useState('');
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>('form');
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<JobStatus | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // No reset-on-close effect: the dashboard mounts this only while an order is
  // selected, so closing unmounts it and the state goes with it.

  const poll = useCallback(async () => {
    const res = await fetch(`/api/orders/${orderId}/update-prelim`);
    if (!res.ok) return;
    const body = await res.json() as { status: JobStatus | null };
    if (body.status) setJob(body.status);
  }, [orderId]);

  // Real status on the row, not a spinner that lies. Stops once terminal.
  useEffect(() => {
    if (phase !== 'tracking') return;
    if (job && (job.status === 'completed' || job.status === 'failed')) return;
    const t = setInterval(() => { void poll(); }, 3000);
    return () => clearInterval(t);
  }, [phase, job, poll]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!subject.trim()) return setError('Subject is required.');
    if (!note.trim()) return setError('Note is required.');
    if (!file) return setError('Attach the updated prelim PDF.');
    if (file.size === 0) return setError('That PDF is empty.');
    if (file.size > MAX_PDF_BYTES) return setError('The PDF must be 25 MB or smaller.');

    const body = new FormData();
    body.set('subject', subject.trim());
    body.set('note', note.trim());
    body.set('file', file);

    setPhase('submitting');
    try {
      const res = await fetch(`/api/orders/${orderId}/update-prelim`, { method: 'POST', body });
      const payload = await res.json().catch(() => ({}));

      if (!res.ok) {
        setPhase('form');
        setError(payload?.error ?? `Submission failed (${res.status}).`);
        return;
      }

      setJob({ jobId: payload.jobId, status: 'queued', verifyState: null, error: null });
      setPhase('tracking');
      onAccepted?.('Update Prelim accepted — sending to SoftPro.');
      void poll();
    } catch {
      setPhase('form');
      setError('Could not reach the server. Nothing was sent to SoftPro.');
    }
  }

  const terminal = job?.status === 'completed' || job?.status === 'failed';

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title="Update Prelim"
      subtitle={fileNumber}
    >
      <div className="p-5">
        {phase === 'tracking' && job ? (
          <div className="space-y-4">
            <div
              className={`rounded-lg border px-4 py-3 text-sm ${
                job.status === 'completed'
                  ? 'border-green-200 bg-green-50 text-green-800'
                  : job.status === 'failed'
                    ? 'border-red-200 bg-red-50 text-red-800'
                    : 'border-blue-200 bg-blue-50 text-blue-800'
              }`}
            >
              <p className="font-medium">{STATUS_COPY[job.status]}</p>
              {job.status === 'completed'
                && (job.verifyState === 'confirmed' || job.verifyState === 'accepted') && (
                <p className="mt-1 text-xs opacity-90">{VERIFY_COPY[job.verifyState]}</p>
              )}
              {job.error && (
                <p className="mt-1 text-xs opacity-90">{job.error}</p>
              )}
            </div>
            <p className="text-xs text-gray-500">
              This runs in the background. You can close this window — the work
              continues and the row shows the result.
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm rounded-lg bg-[#1B2A4A] text-white hover:bg-[#16223c]"
              >
                {terminal ? 'Close' : 'Close and keep working'}
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                {error}
              </div>
            )}

            {!hubHoldsPrelim && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                We don&apos;t currently have a prelim on this file — your request
                will still be sent.
                <span className="mt-1 block text-[11px] opacity-90">
                  SoftPro may hold one we haven&apos;t fetched. The note says the
                  same thing, so production knows before they open it.
                </span>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Subject <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={subject}
                maxLength={SUBJECT_MAX}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full rounded-lg border border-[#DFE3EA] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F26B2B]/30"
                placeholder="Amended prelim — vesting corrected"
              />
              <p className="mt-1 text-[11px] text-gray-500">
                Sent as the first line of the SoftPro note.
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Note <span className="text-red-500">*</span>
              </label>
              <textarea
                value={note}
                rows={5}
                maxLength={NOTE_MAX}
                onChange={(e) => setNote(e.target.value)}
                className="w-full rounded-lg border border-[#DFE3EA] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F26B2B]/30"
                placeholder="What changed on this prelim and what production needs to do."
              />
              <p className="mt-1 text-[11px] text-gray-500">
                {note.length}/{NOTE_MAX}
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Updated prelim (PDF) <span className="text-red-500">*</span>
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,.pdf"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-[#1B2A4A] file:px-3 file:py-1.5 file:text-xs file:text-white"
              />
              {file && (
                <p className="mt-1 text-[11px] text-gray-500">
                  {file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB
                </p>
              )}
            </div>

            <div className="rounded-lg bg-gray-50 border border-gray-200 px-4 py-3 text-[11px] text-gray-600">
              On submit: the PDF is stored and attached to SoftPro, the attach is
              verified, the note is added, then task <strong>03-005</strong> opens
              and production is emailed. The task opens last, so nobody is told
              there is work to do unless the prelim is actually on the file.
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm rounded-lg border border-[#DFE3EA] bg-white text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={phase === 'submitting'}
                className="px-4 py-2 text-sm rounded-lg bg-[#F26B2B] text-white hover:bg-[#E05A1A] disabled:opacity-60"
              >
                {phase === 'submitting' ? 'Submitting…' : 'Submit Update'}
              </button>
            </div>
          </form>
        )}
      </div>
    </ModalShell>
  );
}
