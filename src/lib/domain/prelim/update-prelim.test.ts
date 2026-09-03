import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  UPDATE_PRELIM_FOLDER_NAME,
  UPDATE_PRELIM_TASK_ID,
  buildPrelimNoteText,
  prelimUploadFilename,
} from './update-prelim';

describe('buildPrelimNoteText', () => {
  it('prepends the subject, because AddNotes has no Subject field', () => {
    expect(buildPrelimNoteText({ subject: 'Amended vesting', note: 'Please re-check.' }))
      .toBe('Amended vesting\n\nPlease re-check.');
  });

  it('does not leave dangling separators when one side is empty', () => {
    expect(buildPrelimNoteText({ subject: 'Only subject', note: '   ' })).toBe('Only subject');
    expect(buildPrelimNoteText({ subject: '  ', note: 'Only note' })).toBe('Only note');
  });
});

describe('prelimUploadFilename', () => {
  it('carries the order number — legacy collided on YmdHis alone', () => {
    const name = prelimUploadFilename('20021642-OCT', new Date('2026-09-02T18:40:05Z'));
    expect(name).toContain('20021642-OCT');
    expect(name.startsWith('prelim_20021642-OCT_20260902184005_')).toBe(true);
    expect(name.endsWith('.pdf')).toBe(true);
  });

  it('does not collide inside the same second', () => {
    const at = new Date('2026-09-02T18:40:05Z');
    const names = new Set(
      Array.from({ length: 200 }, () => prelimUploadFilename('20021642-OCT', at)),
    );
    expect(names.size).toBeGreaterThan(190);
  });

  it('produces a legal Windows filename — SoftPro runs Path.GetFileName on it', () => {
    const name = prelimUploadFilename('20021642/OCT?x=1', new Date('2026-09-02T18:40:05Z'));
    expect(name).toMatch(/^[A-Za-z0-9._-]+$/);
  });
});

// Source-sliced deliberately: these are ORDERING and OMISSION claims about the
// flow. A rendered test cannot show that AddTask is never reached when the
// attach failed, nor that no step writes a hard-coded success.
describe('the Update Prelim flow does not repeat legacy behaviour', () => {
  const handler = readFileSync(join(__dirname, '../../jobs/handlers/update-prelim.ts'), 'utf8');
  const route = readFileSync(
    join(process.cwd(), 'src/app/api/orders/[id]/update-prelim/route.ts'),
    'utf8',
  );
  const drain = readFileSync(
    join(__dirname, '../../jobs/handlers/update-prelim-drain.ts'),
    'utf8',
  );

  it('runs attach → verify → note → task, not legacy note → task → upload', () => {
    // Call sites, not declarations — confirmPrelimListed is defined above them.
    const attach = handler.indexOf('await attachToSoftPro(');
    const verify = handler.indexOf('await confirmPrelimListed(');
    const note = handler.indexOf('await addNotes(');
    const task = handler.indexOf('await addTask(');

    expect(attach).toBeGreaterThan(-1);
    expect(verify).toBeGreaterThan(attach);
    expect(note).toBeGreaterThan(verify);
    expect(task).toBeGreaterThan(note);
  });

  it('throws before the note when the attach failed — no task, no email', () => {
    const attachBlock = handler.slice(
      handler.indexOf('const attach = await attachToSoftPro'),
      handler.indexOf('// 2 —'),
    );
    expect(attachBlock).toMatch(/throw new Error\(`update-prelim: SoftPro attach failed/);
  });

  it('honours the AddTask result — legacy updateTaskStatus() returned nothing', () => {
    expect(handler).toMatch(/const taskResult = await addTask\(/);
    expect(handler).toMatch(/taskResult\.success/);
    expect(handler).toMatch(/throw new Error\(`update-prelim: attached and noted but AddTask failed/);
  });

  it('records what happened — no hard-coded success anywhere in the flow', () => {
    expect(handler).not.toMatch(/success:\s*true\s*,?\s*\/\//);
    expect(handler).not.toMatch(/status:\s*['"]success['"]/);
    // Every step result is derived from a vendor result, never asserted.
    expect(handler).toMatch(/step\(\s*noteResult\.success/);
    expect(handler).toMatch(/step\(\s*taskResult\.success/);
  });

  it('verifies with the prelim listing, which can actually see prelims', () => {
    expect(handler).toContain('getAttachedDocumentsPrelim');
    expect(handler).not.toMatch(/[^m]getAttachedDocuments\(/);
  });

  it('sends no presigned S3 URL to SoftPro', () => {
    expect(handler).not.toContain('getSignedUrl');
    expect(route).not.toContain('getSignedUrl');
  });

  it('reads the stored object back before SoftPro is told to fetch it', () => {
    expect(route).toContain('getObjectStream(storageKey)');
    const readback = route.indexOf('getObjectStream(storageKey)');
    const enqueue = route.indexOf('enqueueUpdatePrelimJob(');
    expect(readback).toBeGreaterThan(-1);
    expect(enqueue).toBeGreaterThan(readback);
  });

  it('authorizes by order ownership, not merely by being logged in', () => {
    expect(route).toContain('canAccessOrder(session, orderId)');
    const authz = route.indexOf('canAccessOrder(session, orderId)');
    const upload = route.indexOf('uploadDocument(');
    expect(upload).toBeGreaterThan(authz);
  });

  it('never redirects, and never reads the referer header', () => {
    expect(route).not.toContain('NextResponse.redirect');
    expect(route).not.toMatch(/headers\.get\(\s*['"]referer/i);
  });

  it('returns immediately with a job id instead of blocking on SoftPro', () => {
    expect(route).toMatch(/status:\s*202/);
    expect(route).not.toContain('handleUpdatePrelim(');
  });

  it('ships behind a flag that defaults off', () => {
    expect(route).toContain('isUpdatePrelimEnabled()');
    const flag = readFileSync(join(__dirname, 'update-prelim-flag.ts'), 'utf8');
    expect(flag).toMatch(/=== 'true'/);
  });

  it('resumes rather than re-posting a note a retry already sent', () => {
    expect(handler).toMatch(/if \(!progress\.noted\)/);
    expect(handler).toMatch(/if \(!progress\.tasked\)/);
    expect(drain).toContain('FOR UPDATE SKIP LOCKED');
  });

  it('keeps legacy proven strings: folder "prelim" and task 03-005', () => {
    expect(UPDATE_PRELIM_FOLDER_NAME).toBe('prelim');
    expect(UPDATE_PRELIM_TASK_ID).toBe('03-005');
  });

  it('supersedes only after the attach was accepted', () => {
    const attach = handler.indexOf('attachToSoftPro(');
    const supersede = handler.indexOf('supersedePriorPrelims(');
    expect(supersede).toBeGreaterThan(attach);
  });
});
