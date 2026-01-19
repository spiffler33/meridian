/**
 * Keyboard Shortcuts Hook
 *
 * Handles global keyboard navigation.
 * Shortcuts are disabled when user is typing in an input/textarea.
 */

import { useEffect, useCallback } from 'react';
import type { ViewType } from '../types';

interface UseKeyboardShortcutsOptions {
  onViewChange: (view: ViewType) => void;
  onGoToToday: () => void;
  onPreviousDay: () => void;
  onNextDay: () => void;
}

export function useKeyboardShortcuts({
  onViewChange,
  onGoToToday,
  onPreviousDay,
  onNextDay,
}: UseKeyboardShortcutsOptions) {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in inputs
      const target = event.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      // Don't trigger with modifier keys (except for arrow keys)
      if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }

      switch (event.key.toLowerCase()) {
        case 't':
          event.preventDefault();
          onViewChange('tower');
          break;
        case 'h':
          event.preventDefault();
          onViewChange('habits');
          break;
        case 'w':
          event.preventDefault();
          onViewChange('week');
          break;
        case 'y':
          event.preventDefault();
          onViewChange('year');
          break;
        case 's':
          event.preventDefault();
          onViewChange('settings');
          break;
        case '0':
          event.preventDefault();
          onGoToToday();
          break;
        case 'arrowleft':
          event.preventDefault();
          onPreviousDay();
          break;
        case 'arrowright':
          event.preventDefault();
          onNextDay();
          break;
      }
    },
    [onViewChange, onGoToToday, onPreviousDay, onNextDay]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}
