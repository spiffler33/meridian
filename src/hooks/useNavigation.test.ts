/**
 * useNavigation, the Read routes.
 *
 * The pane's routes are a contract: citations resolve to them and have to keep
 * resolving, so this covers the grammar rather than the hook's older query
 * form — a path parses back to the surface and item that wrote it, an unknown
 * surface opens the pane instead of blanking it, a malformed segment survives
 * as itself, and the date the session was already holding is not thrown away
 * by a route that does not carry one.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { useNavigation } from './useNavigation';

function goTo(hash: string) {
  window.history.replaceState(null, '', hash);
}

afterEach(() => {
  goTo('/');
});

describe('reading a read route', () => {
  it('mounts the read view on the surface and item in the URL', () => {
    goTo('#/read/canon/risk-memos/04');
    const { result } = renderHook(() => useNavigation());

    expect(result.current.view).toBe('read');
    expect(result.current.read.surface).toBe('canon');
    expect(result.current.read.item).toEqual(['risk-memos', '04']);
  });

  it('keeps a two-part item whole, and a one-part item single', () => {
    goTo('#/read/raw/2026-08-18--sample-macro');
    const { result } = renderHook(() => useNavigation());

    expect(result.current.read.surface).toBe('raw');
    expect(result.current.read.item).toEqual(['2026-08-18--sample-macro']);
  });

  it('opens the pane bare when the route names no surface', () => {
    goTo('#/read');
    const { result } = renderHook(() => useNavigation());

    expect(result.current.view).toBe('read');
    expect(result.current.read.surface).toBe('tape');
    expect(result.current.read.item).toEqual([]);
  });

  it('falls back to a surface that exists rather than rendering nothing', () => {
    goTo('#/read/onepager/whatever');
    const { result } = renderHook(() => useNavigation());

    expect(result.current.view).toBe('read');
    expect(result.current.read.surface).toBe('tape');
  });

  it('leaves a segment that is not valid encoding as itself', () => {
    goTo('#/read/raw/100%25-broken');
    const { result } = renderHook(() => useNavigation());
    expect(result.current.read.item).toEqual(['100%-broken']);

    goTo('#/read/raw/100%-broken');
    const { result: malformed } = renderHook(() => useNavigation());
    expect(malformed.current.read.item).toEqual(['100%-broken']);
  });

  it('does not mistake another hash that starts the same way for a read route', () => {
    goTo('#/readings');
    const { result } = renderHook(() => useNavigation());
    expect(result.current.view).toBe('tower');
  });
});

describe('writing a read route', () => {
  it('puts the chosen tab in the URL', () => {
    const { result } = renderHook(() => useNavigation());

    act(() => result.current.setReadSurface('chart'));

    expect(window.location.hash).toBe('#/read/chart');
    expect(result.current.view).toBe('read');
  });

  it('drops the item when the tab changes', () => {
    goTo('#/read/canon/risk-memos/04');
    const { result } = renderHook(() => useNavigation());

    act(() => result.current.setReadSurface('library'));

    expect(window.location.hash).toBe('#/read/library');
    expect(result.current.read.item).toEqual([]);
  });

  it('carries a cited span through the address intact', () => {
    // A citation is an address, and the corpus quotes prose: the span it
    // names contains slashes, pipes, quotes and percent signs. If the hash
    // mangles any of them the tap lands at the top of the entry instead.
    const span = 'by 1890, 40% of railroad capitalization represented "water" | 1/4th of all track';
    const item = ['2025-12-18--railroad-buildout', 'prose', span];
    const { result } = renderHook(() => useNavigation());

    act(() => result.current.setReadRoute('raw', item));

    // Read back the way a reload or a back button would, not from memory.
    const reread = renderHook(() => useNavigation());
    expect(reread.result.current.read).toEqual({ surface: 'raw', item });
  });
});

describe('what a read route does not carry', () => {
  it('holds on to the date the session was already on', () => {
    goTo('#view=habits&date=2026-01-05&year=2026');
    const { result } = renderHook(() => useNavigation());
    expect(result.current.selectedDate).toBe('2026-01-05');

    act(() => result.current.setReadSurface('tape'));
    act(() => {
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });

    expect(result.current.view).toBe('read');
    expect(result.current.selectedDate).toBe('2026-01-05');
    expect(result.current.selectedYear).toBe(2026);
  });
});
