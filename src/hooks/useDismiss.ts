/**
 * useDismiss
 *
 * Escape, or a press that lands outside the element, closes the thing.
 *
 * Four surfaces — the three pack modals and the habit stats popover — had each
 * written this out for themselves, verbatim and twice over (one effect for the
 * key, one for the pointer). It is one effect here, registered once.
 *
 * `mousedown` rather than `click` on purpose: a press that starts outside and
 * releases inside should still dismiss.
 */

import { useEffect } from 'react';
import type { RefObject } from 'react';

export function useDismiss<T extends HTMLElement>(
  ref: RefObject<T | null>,
  onClose: () => void,
): void {
  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose();
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [ref, onClose]);
}
