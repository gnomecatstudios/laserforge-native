import { describe, expect, it } from 'vitest';
import type { RasterSource } from 'libopenlaser/cam';
import {
  Separation,
  canUndoPicks,
  redoPicks,
  separationFocus,
  undoPicks,
} from '$app/workspace/separation.svelte';

/** Left half green, right half red, 4 × 2. */
function preview(): RasterSource {
  const data = new Uint8ClampedArray(4 * 2 * 4);
  for (let i = 0; i < 8; i++) data.set(i % 4 < 2 ? [0, 200, 0, 255] : [220, 30, 30, 255], i * 4);
  return { width: 4, height: 2, data };
}

const GREEN = { x: 0.1, y: 0.5 };
const RED = { x: 0.9, y: 0.5 };
const selected = (s: Separation) => [...s.weights()!].map((w) => (w > 127 ? 1 : 0));

function make(): Separation {
  const s = new Separation();
  s.setPreview(preview());
  s.setMatching('add', { tolerance: 5, softness: 0 });
  s.setMatching('subtract', { tolerance: 5, softness: 0 });
  return s;
}

describe('Separation picks', () => {
  it('picks in the switch mode unless the pick says otherwise', () => {
    const s = make();
    s.mode = 'subtract';
    s.pick([GREEN]);
    s.pick([RED], 'add');
    expect(s.picks.map((p) => p.mode)).toEqual(['subtract', 'add']);
  });

  it('is empty with only subtract picks', () => {
    const s = make();
    s.pick([GREEN], 'subtract');
    expect(s.empty).toBe(true);
    expect(selected(s)).not.toContain(1);
  });

  it('subtracts and lets a pick switch mode', () => {
    const s = make();
    // One range across both colors, then subtract the red.
    s.pick([GREEN, RED]);
    expect(selected(s)).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
    s.pick([RED], 'subtract');
    expect(selected(s)).toEqual([1, 1, 0, 0, 1, 1, 0, 0]);
    s.togglePick(1);
    expect(s.picks[1].mode).toBe('add');
    expect(selected(s)).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
  });

  it('gives subtract picks their own tolerance', () => {
    const s = make();
    s.pick([GREEN]);
    s.pick([GREEN], 'subtract');
    expect(selected(s)).not.toContain(1);
    // A subtract tolerance of 0 still matches the exact color, so it still takes all the green.
    s.setMatching('subtract', { tolerance: 0 });
    expect(s.selection.keys.map((k) => k.tolerance)).toEqual([5, 0]);
  });

  it('undoes and redoes picks, mode changes and Clear', () => {
    const s = make();
    s.pick([GREEN]);
    s.pick([RED], 'subtract');
    s.togglePick(1);
    s.clear();
    expect(s.picks).toHaveLength(0);
    expect(s.undo()).toBe(true);
    expect(s.picks.map((p) => p.mode)).toEqual(['add', 'add']);
    s.undo();
    expect(s.picks.map((p) => p.mode)).toEqual(['add', 'subtract']);
    s.undo();
    s.undo();
    expect(s.picks).toHaveLength(0);
    expect(s.canUndo).toBe(false);
    s.redo();
    s.redo();
    expect(s.picks.map((p) => p.mode)).toEqual(['add', 'subtract']);
  });

  it('forgets its history on reset, so undo falls back to the project', () => {
    const s = make();
    s.pick([GREEN]);
    separationFocus.current = s;
    expect(canUndoPicks()).toBe(true);
    s.reset();
    expect(s.picks).toHaveLength(0);
    expect(undoPicks()).toBe(false);
    expect(redoPicks()).toBe(false);
    separationFocus.current = null;
  });

  it('keeps subtract picks when the background is selected', () => {
    const s = make();
    s.pick([RED], 'subtract');
    s.selectBackground();
    expect(s.picks.at(-1)!.mode).toBe('subtract');
    expect(s.connected).toBe(true);
    s.clear();
    expect(s.picks).toHaveLength(0);
    expect(s.connected).toBe(false);
  });
});
