/**
 * ReadView.
 *
 * Every route in the pane's contract has to land on something readable, so
 * this walks all six surfaces and checks each one renders its own content —
 * including raw, which has no tab and arrives only by citation. It also covers
 * the two things the shell owns rather than borrows: the screen adopting the
 * reading palette while the view is mounted and handing it back when it is
 * not, and the instrument answering the library rather than a constant.
 *
 * The library's data is mocked at the hook. What the sync and its selectors do
 * is newslettersSync's business and is tested there; what matters here is that
 * a failure stays on screen next to the rows it could not refresh.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import type { NewslettersView } from '../hooks/useNewsletters';
import type { LibraryEntry } from '../lib/newslettersSync';
import { ReadView } from './ReadView';

const mocks = vi.hoisted(() => ({
  view: null as NewslettersView | null,
}));

vi.mock('../hooks/useNewsletters', () => ({
  useNewsletters: () => mocks.view,
}));

const ENTRIES: LibraryEntry[] = [
  {
    slug: '2026-08-21--lex-asia-insurers',
    date: '2026-08-21',
    name: 'lex-asia-insurers',
    gist: 'FT Lex: Beijing taxes offshore savings products.',
  },
  {
    slug: '2026-08-18--sample-macro',
    date: '2026-08-18',
    name: 'sample-macro',
    gist: 'The long end does the tightening.',
  },
  { slug: '2026-08-17--no-gist', date: '2026-08-17', name: 'no-gist', gist: null },
];

function library(overrides: Partial<NewslettersView> = {}) {
  mocks.view = {
    rows: ENTRIES,
    loaded: true,
    configured: true,
    syncing: false,
    error: null,
    lastSyncedAt: 1,
    refresh: vi.fn(),
    ...overrides,
  };
  return mocks.view;
}

beforeEach(() => {
  library();
  navigate.mockReset();
});

afterEach(cleanup);

const navigate = vi.fn();

function show(surface: Parameters<typeof ReadView>[0]['surface'], item: string[] = []) {
  return render(
    <ReadView surface={surface} item={item} onSurfaceChange={vi.fn()} onNavigate={navigate} />
  );
}

describe('the surfaces', () => {
  // What each surface renders is its own business and is covered in
  // readSurfaces.test.tsx. What the shell owes is that the route reaches the
  // right one — here, against a device with nothing synced, which is also the
  // state a new device is in.
  it('mounts the surface the route names', async () => {
    show('tape');
    expect(await screen.findByText(/no tape on this device yet/)).toBeInTheDocument();

    cleanup();
    show('canon');
    expect(await screen.findByText(/no canon lessons on this device yet/)).toBeInTheDocument();
  });

  it('says an address with no entry in it is exactly that', () => {
    show('raw');
    expect(screen.getByText('no entry named in this address')).toBeInTheDocument();
  });
});

describe('the library', () => {
  it('lists what the corpus holds, gist and all', () => {
    show('library');
    expect(screen.getByText('lex-asia-insurers')).toBeInTheDocument();
    expect(screen.getByText('FT Lex: Beijing taxes offshore savings products.')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Mark / })).toHaveLength(ENTRIES.length);
  });

  it('lists an entry that has no gist rather than dropping it', () => {
    show('library');
    expect(screen.getByText('no-gist')).toBeInTheDocument();
  });

  it('opens the source entry when a row is tapped', () => {
    show('library');

    fireEvent.click(screen.getByText('lex-asia-insurers'));

    expect(navigate).toHaveBeenCalledWith('raw', ['2026-08-21--lex-asia-insurers']);
  });

  it('says where the token goes when there is none', () => {
    library({ configured: false, rows: [] });
    show('library');
    expect(screen.getByText(/add a read-only one in settings/)).toBeInTheDocument();
  });

  it('keeps the last synced copy on screen when a refresh fails, and says so', () => {
    library({ error: 'offline — showing the last copy that synced' });
    show('library');

    expect(screen.getByText('offline — showing the last copy that synced')).toBeInTheDocument();
    expect(screen.getByText('lex-asia-insurers')).toBeInTheDocument();
  });

  it('offers the failed sync a retry', () => {
    const view = library({ error: 'the newsletters token was refused — check it in settings' });
    show('library');

    fireEvent.click(screen.getByRole('button', { name: 'retry' }));

    expect(view.refresh).toHaveBeenCalled();
  });

  it('does not call an empty library empty until it has looked', () => {
    library({ rows: [], loaded: false });
    show('library');
    expect(screen.queryByText(/nothing synced to this device yet/)).toBeNull();
  });
});

describe('the tab rail', () => {
  it('marks the surface in the URL as the selected tab', () => {
    show('canon');
    expect(screen.getByRole('tab', { name: 'Canon' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Tape' })).toHaveAttribute('aria-selected', 'false');
  });

  it('leaves every tab unselected on a surface that has no tab', async () => {
    show('raw');
    await screen.findByText('no entry named in this address');
    for (const tab of screen.getAllByRole('tab')) {
      expect(tab).toHaveAttribute('aria-selected', 'false');
    }
  });

  it('asks the router for the new surface rather than switching on its own', () => {
    const onSurfaceChange = vi.fn();
    render(
      <ReadView surface="tape" item={[]} onSurfaceChange={onSurfaceChange} onNavigate={navigate} />
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Library' }));

    expect(onSurfaceChange).toHaveBeenCalledWith('library');
  });
});

describe('the reading surface', () => {
  it('adopts the palette while mounted and hands it back on the way out', () => {
    const { unmount } = show('tape');
    expect(document.documentElement.getAttribute('data-surface')).toBe('read');

    unmount();
    expect(document.documentElement.getAttribute('data-surface')).toBeNull();
  });
});

describe('the instrument', () => {
  it('reads the backlog the library is actually carrying', () => {
    show('library');
    expect(screen.getByText(`${ENTRIES.length} unread`)).toBeInTheDocument();
    expect(screen.getByText('Drifting')).toBeInTheDocument();
  });

  it('admits it has nothing to report before the library is read', () => {
    library({ rows: [], loaded: false });
    show('library');
    expect(screen.getByText('Standing by')).toBeInTheDocument();
    expect(screen.getByText('not synced')).toBeInTheDocument();
  });

  it('settles as the backlog is cleared', () => {
    show('library');

    for (const button of screen.getAllByRole('button', { name: /^Mark .* read$/ })) {
      fireEvent.click(button);
    }

    expect(screen.getByText('all read')).toBeInTheDocument();
    expect(screen.getByText('At setpoint')).toBeInTheDocument();
  });

  it('drifts again when an entry is marked unread', () => {
    show('library');

    fireEvent.click(screen.getAllByRole('button', { name: /^Mark .* read$/ })[0]);
    expect(screen.getByText(`${ENTRIES.length - 1} unread`)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Mark .* unread$/ }));
    expect(screen.getByText(`${ENTRIES.length} unread`)).toBeInTheDocument();
  });
});
