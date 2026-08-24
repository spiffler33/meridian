/**
 * useKeyboardShortcuts, the Read key.
 *
 * R joins the view keys. The one thing worth holding down is that it stays a
 * view key and not a stray letter: typing the word "read" into a task field
 * must not throw the owner out of the field and into the pane.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, renderHook } from '@testing-library/react';

import { useKeyboardShortcuts } from './useKeyboardShortcuts';

function mount() {
  const onViewChange = vi.fn();
  renderHook(() =>
    useKeyboardShortcuts({
      onViewChange,
      onGoToToday: vi.fn(),
      onPreviousDay: vi.fn(),
      onNextDay: vi.fn(),
    })
  );
  return onViewChange;
}

afterEach(cleanup);

describe('the read key', () => {
  it('opens the read view', () => {
    const onViewChange = mount();

    fireEvent.keyDown(window, { key: 'r' });

    expect(onViewChange).toHaveBeenCalledWith('read');
  });

  it('answers to a shifted key too', () => {
    const onViewChange = mount();

    fireEvent.keyDown(window, { key: 'R' });

    expect(onViewChange).toHaveBeenCalledWith('read');
  });

  it('stays out of the way while the owner is typing', () => {
    const onViewChange = mount();
    const input = document.createElement('input');
    document.body.appendChild(input);

    fireEvent.keyDown(input, { key: 'r' });

    expect(onViewChange).not.toHaveBeenCalled();
    input.remove();
  });

  it('leaves the browser its own ctrl-R', () => {
    const onViewChange = mount();

    fireEvent.keyDown(window, { key: 'r', metaKey: true });

    expect(onViewChange).not.toHaveBeenCalled();
  });
});
