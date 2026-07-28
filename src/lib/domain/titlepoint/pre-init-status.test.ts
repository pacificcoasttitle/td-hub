import { describe, expect, it } from 'vitest';
import { PRE_INIT_TERMINAL_STATUSES } from './pre-init-status';

describe('PRE_INIT_TERMINAL_STATUSES', () => {
  it('treats result_ready / completed / failed / exception as terminal for the submit gate', () => {
    expect(PRE_INIT_TERMINAL_STATUSES.has('result_ready')).toBe(true);
    expect(PRE_INIT_TERMINAL_STATUSES.has('completed')).toBe(true);
    expect(PRE_INIT_TERMINAL_STATUSES.has('failed')).toBe(true);
    expect(PRE_INIT_TERMINAL_STATUSES.has('exception')).toBe(true);
    expect(PRE_INIT_TERMINAL_STATUSES.has('pending')).toBe(false);
    expect(PRE_INIT_TERMINAL_STATUSES.has('ready')).toBe(false);
    expect(PRE_INIT_TERMINAL_STATUSES.has('processing')).toBe(false);
  });
});
