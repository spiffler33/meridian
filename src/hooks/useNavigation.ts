/**
 * Navigation Hook
 *
 * Manages the current view and selected date.
 * Uses URL hash for state (allows browser back/forward).
 */

import { useState, useEffect, useCallback } from 'react';
import type { ViewType } from '../types';
import { getToday, formatDate, parseDate } from '../utils/dates';

interface NavigationState {
  view: ViewType;
  selectedDate: string;
  selectedYear: number;
}

interface UseNavigationReturn extends NavigationState {
  setView: (view: ViewType) => void;
  setSelectedDate: (date: string) => void;
  setSelectedYear: (year: number) => void;
  goToToday: () => void;
  goToPreviousDay: () => void;
  goToNextDay: () => void;
  goToPreviousWeek: () => void;
  goToNextWeek: () => void;
}

const VALID_VIEWS: ViewType[] = ['tower', 'habits', 'week', 'year', 'settings'];

function parseHash(): NavigationState {
  const hash = window.location.hash.slice(1);
  const params = new URLSearchParams(hash);

  const rawView = params.get('view');
  const view: ViewType = rawView && VALID_VIEWS.includes(rawView as ViewType)
    ? (rawView as ViewType)
    : 'tower';
  const date = params.get('date') || getToday();
  const year = parseInt(params.get('year') || '') || new Date().getFullYear();

  return { view, selectedDate: date, selectedYear: year };
}

function updateHash(state: NavigationState): void {
  const today = getToday();
  const currentYear = new Date().getFullYear();

  // If on tower view with today's date, use clean URL (no hash)
  if (state.view === 'tower' && state.selectedDate === today && state.selectedYear === currentYear) {
    if (window.location.hash) {
      history.replaceState(null, '', window.location.pathname);
    }
    return;
  }

  const params = new URLSearchParams();
  params.set('view', state.view);
  params.set('date', state.selectedDate);
  params.set('year', state.selectedYear.toString());
  window.location.hash = params.toString();
}

export function useNavigation(): UseNavigationReturn {
  const [state, setState] = useState<NavigationState>(() => parseHash());

  // Listen for hash changes (browser back/forward)
  useEffect(() => {
    const handleHashChange = () => {
      setState(parseHash());
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // Update URL when state changes
  useEffect(() => {
    updateHash(state);
  }, [state]);

  const setView = useCallback((view: ViewType) => {
    setState(prev => ({ ...prev, view }));
  }, []);

  const setSelectedDate = useCallback((selectedDate: string) => {
    setState(prev => ({ ...prev, selectedDate }));
  }, []);

  const setSelectedYear = useCallback((selectedYear: number) => {
    setState(prev => ({ ...prev, selectedYear }));
  }, []);

  const goToToday = useCallback(() => {
    setState(prev => ({
      ...prev,
      view: 'tower',
      selectedDate: getToday(),
      selectedYear: new Date().getFullYear(),
    }));
  }, []);

  const goToPreviousDay = useCallback(() => {
    setState(prev => {
      const date = parseDate(prev.selectedDate);
      date.setDate(date.getDate() - 1);
      return { ...prev, selectedDate: formatDate(date) };
    });
  }, []);

  const goToNextDay = useCallback(() => {
    setState(prev => {
      const date = parseDate(prev.selectedDate);
      date.setDate(date.getDate() + 1);
      return { ...prev, selectedDate: formatDate(date) };
    });
  }, []);

  const goToPreviousWeek = useCallback(() => {
    setState(prev => {
      const date = parseDate(prev.selectedDate);
      date.setDate(date.getDate() - 7);
      return { ...prev, selectedDate: formatDate(date) };
    });
  }, []);

  const goToNextWeek = useCallback(() => {
    setState(prev => {
      const date = parseDate(prev.selectedDate);
      date.setDate(date.getDate() + 7);
      return { ...prev, selectedDate: formatDate(date) };
    });
  }, []);

  return {
    ...state,
    setView,
    setSelectedDate,
    setSelectedYear,
    goToToday,
    goToPreviousDay,
    goToNextDay,
    goToPreviousWeek,
    goToNextWeek,
  };
}
