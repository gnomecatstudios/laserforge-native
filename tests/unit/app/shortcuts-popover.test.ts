// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ canStop: false, stop: vi.fn() }));
vi.mock('$app/machines/registry', () => ({ connectedSession: () => session }));

const { handleKeydown } = await import('$app/shortcuts');
const { editor } = await import('$app/state/editor.svelte');

function escape(target: Element): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  Object.defineProperty(event, 'target', { value: target });
  return event;
}

describe('Escape with an open popover', () => {
  beforeEach(() => {
    session.canStop = false;
    session.stop.mockClear();
    editor.tool = 'rect'; // makes "Clear selection" applicable
    document.body.innerHTML = `
      <button id="trigger"></button>
      <div data-popover-content data-state="open"><input id="slider" type="range" /></div>`;
  });

  it('leaves Escape to the popover, wherever focus is', () => {
    for (const id of ['slider', 'trigger']) {
      const event = escape(document.getElementById(id)!);
      expect(handleKeydown(event)).toBe(false);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(editor.tool).toBe('rect');
  });

  it('still stops a running job first', () => {
    session.canStop = true;
    expect(handleKeydown(escape(document.getElementById('slider')!))).toBe(true);
    expect(session.stop).toHaveBeenCalledOnce();
  });

  it('clears the tool again once the popover has closed', () => {
    document.body.innerHTML = '<div data-popover-content data-state="closed"></div><button id="b"></button>';
    expect(handleKeydown(escape(document.getElementById('b')!))).toBe(true);
    expect(editor.tool).toBe('select');
  });
});
