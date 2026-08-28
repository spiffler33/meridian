/**
 * useKeyboardShortcuts: the Read key, the Week key that is no longer one, and
 * the Pulse key.
 *
 * R joins the view keys. The one thing worth holding down is that it stays a
 * view key and not a stray letter: typing the word "read" into a task field
 * must not throw the owner out of the field and into the pane.
 *
 * W is the odd one now. The week stopped being a view, so the key has to reach
 * the lens rather than ask the router for a view that no longer exists.
 *
 * P is a plain view key too, now that Pulse has its own place on the rail: it
 * asks for the pulse view exactly as `r` asks for read. Arriving there is what
 * puts the cursor in the capture box — a job the box does for itself on mount,
 * not one this hook knows about.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, renderHook } from '@testing-library/react';

import { useKeyboardShortcuts } from './useKeyboardShortcuts';

function mount() {
  const onViewChange = vi.fn();
  const onOpenWeek = vi.fn();
  renderHook(() =>
    useKeyboardShortcuts({
      onViewChange,
      onGoToToday: vi.fn(),
      onPreviousDay: vi.fn(),
      onNextDay: vi.fn(),
      onOpenWeek,
    })
  );
  return { onViewChange, onOpenWeek };
}

afterEach(cleanup);

describe('the read key', () => {
  it('opens the read view', () => {
    const { onViewChange } = mount();

    fireEvent.keyDown(window, { key: 'r' });

    expect(onViewChange).toHaveBeenCalledWith('read');
  });

  it('answers to a shifted key too', () => {
    const { onViewChange } = mount();

    fireEvent.keyDown(window, { key: 'R' });

    expect(onViewChange).toHaveBeenCalledWith('read');
  });

  it('stays out of the way while the owner is typing', () => {
    const { onViewChange } = mount();
    const input = document.createElement('input');
    document.body.appendChild(input);

    fireEvent.keyDown(input, { key: 'r' });

    expect(onViewChange).not.toHaveBeenCalled();
    input.remove();
  });

  it('leaves the browser its own ctrl-R', () => {
    const { onViewChange } = mount();

    fireEvent.keyDown(window, { key: 'r', metaKey: true });

    expect(onViewChange).not.toHaveBeenCalled();
  });
});

describe('the pulse key', () => {
  it('opens the pulse view', () => {
    const { onViewChange } = mount();

    fireEvent.keyDown(window, { key: 'p' });

    expect(onViewChange).toHaveBeenCalledWith('pulse');
  });

  it('stays out of the way while the owner is typing', () => {
    const { onViewChange } = mount();
    const input = document.createElement('input');
    document.body.appendChild(input);

    fireEvent.keyDown(input, { key: 'p' });

    expect(onViewChange).not.toHaveBeenCalled();
    input.remove();
  });
});

describe('the week key', () => {
  it('opens the lens rather than a view of its own', () => {
    const { onViewChange, onOpenWeek } = mount();

    fireEvent.keyDown(window, { key: 'w' });

    expect(onOpenWeek).toHaveBeenCalled();
    expect(onViewChange).not.toHaveBeenCalled();
  });

  it('stays out of the way while the owner is typing', () => {
    const { onOpenWeek } = mount();
    const input = document.createElement('input');
    document.body.appendChild(input);

    fireEvent.keyDown(input, { key: 'w' });

    expect(onOpenWeek).not.toHaveBeenCalled();
    input.remove();
  });
});
