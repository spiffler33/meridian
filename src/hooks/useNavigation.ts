/**
 * Navigation Hook
 *
 * Manages the current view and selected date.
 * Uses URL hash for state (allows browser back/forward).
 */

import { useState, useEffect, useCallback } from 'react';
import type { ReadSurface, ViewType } from '../types';
import { getToday, formatDate, parseDate } from '../utils/dates';

/** Where the Read view is pointed: a surface, plus the item path inside it. */
export interface ReadRoute {
  surface: ReadSurface;
  item: string[];
}

interface NavigationState {
  view: ViewType;
  selectedDate: string;
  selectedYear: number;
  read: ReadRoute;
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
  setReadSurface: (surface: ReadSurface) => void;
}

const VALID_VIEWS: ViewType[] = ['tower', 'habits', 'week', 'year', 'read', 'settings'];
const READ_SURFACES: ReadSurface[] = ['tape', 'chart', 'canon', 'essay', 'library', 'raw'];
const DEFAULT_READ: ReadRoute = { surface: 'tape', item: [] };

/** A segment that is not valid percent-encoding is a segment, not a crash. */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * The Read view addresses itself with a path-shaped hash — `#/read/tape/<id>`,
 * `#/read/canon/<doc>/<day>` — rather than the query-shaped one the other
 * views share. Those routes are part of the pane's contract (citations resolve
 * to them and must keep resolving), so they stay literal and stable rather
 * than becoming encoded parameters. One hash, two grammars, one owner: this
 * hook writes every form of it.
 */
function parseReadHash(hash: string): ReadRoute | null {
  if (hash !== '/read' && !hash.startsWith('/read/')) return null;

  const [, , surface, ...item] = hash.split('/');
  return {
    surface: READ_SURFACES.includes(surface as ReadSurface)
      ? (surface as ReadSurface)
      : DEFAULT_READ.surface,
    item: item.filter(Boolean).map(decodeSegment),
  };
}

function parseHash(prev?: NavigationState): NavigationState {
  const hash = window.location.hash.slice(1);

  const read = parseReadHash(hash);
  if (read) {
    // A read route carries no date or year. Whatever the session already had
    // stays put, rather than snapping back to today on every tab change.
    return {
      view: 'read',
      selectedDate: prev?.selectedDate ?? getToday(),
      selectedYear: prev?.selectedYear ?? new Date().getFullYear(),
      read,
    };
  }

  const params = new URLSearchParams(hash);

  const rawView = params.get('view');
  const view: ViewType = rawView && VALID_VIEWS.includes(rawView as ViewType)
    ? (rawView as ViewType)
    : 'tower';
  const date = params.get('date') || getToday();
  const year = parseInt(params.get('year') || '') || new Date().getFullYear();

  return { view, selectedDate: date, selectedYear: year, read: prev?.read ?? DEFAULT_READ };
}

function updateHash(state: NavigationState): void {
  const today = getToday();
  const currentYear = new Date().getFullYear();

  if (state.view === 'read') {
    const segments = ['read', state.read.surface, ...state.read.item.map(encodeURIComponent)];
    window.location.hash = `/${segments.join('/')}`;
    return;
  }

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
      setState(prev => parseHash(prev));
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

  const setReadSurface = useCallback((surface: ReadSurface) => {
    // Changing tab drops the item: the rail selects a surface, not an entry.
    setState(prev => ({ ...prev, view: 'read', read: { surface, item: [] } }));
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
    setReadSurface,
  };
}
