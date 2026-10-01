// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

// PROBE. Does `setState({ ...captured, [k]: v })` actually lose writes under
// React 19, or is that only true of older batching behaviour?
//
// This matters because 2C was diagnosed as exactly that pattern, and the
// interactive test written to prove it passed against the buggy code. Either
// the test cannot reach the condition or the pattern is not lossy here — and
// those lead to opposite conclusions about whether 2C is fixed.
//
// Two components, identical but for the update style, driven the same way.

afterEach(cleanup);

function Stale({ onRead }: { onRead: (s: Record<string, number>) => void }) {
  const [s, setS] = useState<Record<string, number>>({ a: 0, b: 0 });
  // The suspect idiom: spreads the `s` captured by THIS render.
  const set = (k: string, v: number) => setS({ ...s, [k]: v });
  return (
    <>
      <input data-testid="stale-a" type="range" min={0} max={9} value={s.a} onChange={(e) => set('a', Number(e.target.value))} />
      <input data-testid="stale-b" type="range" min={0} max={9} value={s.b} onChange={(e) => set('b', Number(e.target.value))} />
      <button type="button" data-testid="stale-read" onClick={() => onRead(s)}>read</button>
    </>
  );
}

function Fresh({ onRead }: { onRead: (s: Record<string, number>) => void }) {
  const [s, setS] = useState<Record<string, number>>({ a: 0, b: 0 });
  const set = (k: string, v: number) => setS((prev) => ({ ...prev, [k]: v }));
  return (
    <>
      <input data-testid="fresh-a" type="range" min={0} max={9} value={s.a} onChange={(e) => set('a', Number(e.target.value))} />
      <input data-testid="fresh-b" type="range" min={0} max={9} value={s.b} onChange={(e) => set('b', Number(e.target.value))} />
      <button type="button" data-testid="fresh-read" onClick={() => onRead(s)}>read</button>
    </>
  );
}

/** Set a controlled input's value the way React notices, and fire change. */
function nativeChange(el: HTMLElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('is the captured-spread idiom actually lossy here', () => {
  it('reports what each style does with two writes in one act', () => {
    let staleRead: Record<string, number> = {};
    render(<Stale onRead={(s) => { staleRead = s; }} />);
    act(() => {
      nativeChange(screen.getByTestId('stale-a'), '5');
      nativeChange(screen.getByTestId('stale-b'), '7');
    });
    act(() => { screen.getByTestId('stale-read').click(); });

    let freshRead: Record<string, number> = {};
    render(<Fresh onRead={(s) => { freshRead = s; }} />);
    act(() => {
      nativeChange(screen.getByTestId('fresh-a'), '5');
      nativeChange(screen.getByTestId('fresh-b'), '7');
    });
    act(() => { screen.getByTestId('fresh-read').click(); });

    // Recorded rather than asserted-at, because the point is to LEARN which
    // it is. The functional form must always hold both.
    expect(freshRead).toEqual({ a: 5, b: 7 });
    // eslint-disable-next-line no-console
    console.log(`  stale idiom kept: ${JSON.stringify(staleRead)}   functional kept: ${JSON.stringify(freshRead)}`);
  });
});
