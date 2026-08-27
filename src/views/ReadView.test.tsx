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
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { closeDb, putCachedFile, setMeta } from '../lib/db';
import { resetSession } from '../lib/entities';
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

/**
 * The reading baseline as a seeded journal line.
 *
 * Read-state is folded journal data now, so the instrument cannot be tested
 * from a prop: the backlog is whatever a profile event and a set of readItem
 * events say it is.
 */
async function seedBaseline(at: string): Promise<void> {
  const fields: Record<string, unknown> = { username: 'owner', reading_baseline_at: at };
  await putCachedFile({
    path: 'journal/2026-01.seed.jsonl',
    text: `${JSON.stringify({
      id: 'seed-profile',
      device: 'seed',
      seq: 1,
      ts: 1_700_000_000_000,
      type: 'upsert',
      entity: 'profile',
      entityId: 'profile',
      fields,
    })}\n`,
    sha: null,
    fetchedAt: 1_700_000_000_000,
  });
  resetSession();
}

/**
 * Let the writes an unmounted view still had in flight finish.
 *
 * A mark is an IndexedDB transaction that outlives the tap, and three of them
 * queue behind each other. Deleting the database under an open connection is
 * BLOCKED rather than refused, so a half-drained store leaks one test's marks
 * into the next — which is exactly the bug this waits out.
 */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 8; turn += 1) {
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}

async function resetDb(): Promise<void> {
  await closeDb();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase('meridian');
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('deleteDatabase failed'));
    // Loud on purpose: a blocked delete that resolved anyway is how leaked
    // read-state got into the next test in the first place.
    req.onblocked = () => reject(new Error('deleteDatabase was blocked: a test leaked a connection'));
  });
}

beforeEach(async () => {
  await resetDb();
  resetSession();
  library();
  navigate.mockReset();
});

afterEach(async () => {
  cleanup();
  await settle();
  resetSession();
  await resetDb();
});

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
  it('reads the backlog the library is actually carrying', async () => {
    await seedBaseline('2026-08-16T00:00:00.000Z');
    show('library');

    expect(await screen.findByText(`${ENTRIES.length} unread`)).toBeInTheDocument();
    expect(screen.getByText('Drifting')).toBeInTheDocument();
  });

  it('counts an unread brief alongside the corpus', async () => {
    // The tape and the charts are digests of the entries below them and stay
    // out of the instrument. A brief is not: it sweeps threads that never
    // land in raw/ and carries the book, so it is a fourth thing owed rather
    // than a fourth count of three.
    await setMeta('gitread:newsletters:tree', [{ path: 'state/briefs/2026-08-25.md', sha: 'b1', size: 1 }]);
    await seedBaseline('2026-08-16T00:00:00.000Z');
    show('library');

    expect(await screen.findByText(`${ENTRIES.length + 1} unread`)).toBeInTheDocument();
  });

  it('leaves everything the baseline covers out of the backlog', async () => {
    await seedBaseline('2026-08-19T12:00:00.000Z');
    show('library');

    // Only 2026-08-21 is after the mark; the two older entries were read in
    // email, which is the whole reason the baseline exists.
    expect(await screen.findByText('1 unread')).toBeInTheDocument();
    expect(screen.getByText('Holding steady')).toBeInTheDocument();
  });

  it('counts the baseline day itself, rather than hiding it forever', async () => {
    await seedBaseline('2026-08-21T09:00:00.000Z');
    show('library');

    // An entry's date has no time in it, so it cannot be placed either side of
    // the instant. Rounding it to unread costs one tap; the other rounding
    // costs the entry.
    expect(await screen.findByText('1 unread')).toBeInTheDocument();
  });

  it('admits it has nothing to report until a baseline can be established', async () => {
    // Nothing seeded: a device that has never seen the journal cannot know
    // whether a baseline already exists, so it does not invent one — and an
    // instrument with no baseline reports that rather than "all read".
    show('library');
    await settle();

    expect(screen.getByText('Standing by')).toBeInTheDocument();
    expect(screen.getByText('not synced')).toBeInTheDocument();
  });

  it('settles as the backlog is cleared', async () => {
    await seedBaseline('2026-08-16T00:00:00.000Z');
    show('library');
    await screen.findByText(`${ENTRIES.length} unread`);

    for (const button of screen.getAllByRole('button', { name: /^Mark .* read$/ })) {
      fireEvent.click(button);
    }

    expect(await screen.findByText('all read')).toBeInTheDocument();
    expect(screen.getByText('At setpoint')).toBeInTheDocument();
  });

  it('drifts again when an entry is marked unread', async () => {
    await seedBaseline('2026-08-16T00:00:00.000Z');
    show('library');
    await screen.findByText(`${ENTRIES.length} unread`);

    fireEvent.click(screen.getAllByRole('button', { name: /^Mark .* read$/ })[0]);
    expect(await screen.findByText(`${ENTRIES.length - 1} unread`)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Mark .* unread$/ }));
    expect(await screen.findByText(`${ENTRIES.length} unread`)).toBeInTheDocument();
  });

  it('survives a mark and a reload: the mark is journal data, not screen state', async () => {
    await seedBaseline('2026-08-16T00:00:00.000Z');
    const first = show('library');
    await screen.findByText(`${ENTRIES.length} unread`);

    fireEvent.click(screen.getAllByRole('button', { name: /^Mark .* read$/ })[0]);
    await screen.findByText(`${ENTRIES.length - 1} unread`);
    // The tick is optimistic; durability is what this test is about, so wait
    // for the event to actually reach the outbox before the reload.
    await settle();

    first.unmount();
    show('library');

    expect(await screen.findByText(`${ENTRIES.length - 1} unread`)).toBeInTheDocument();
  });
});

describe('the tab rail ticks', () => {
  it("carries each tab's own backlog, and nothing where there is none", async () => {
    await seedBaseline('2026-08-16T00:00:00.000Z');
    show('library');

    const library_ = await screen.findByRole('tab', { name: /Library/ });
    await waitFor(() => expect(library_.textContent).toBe(`Library${ENTRIES.length}`));

    // Nothing is synced in this file, so the tape, the charts and the briefs
    // have no dated material at all — and a tab with no backlog carries no
    // tick.
    expect(screen.getByRole('tab', { name: /Canon/ }).textContent).toBe('Canon');
    expect(screen.getByRole('tab', { name: /Essays/ }).textContent).toBe('Essays');
    expect(screen.getByRole('tab', { name: /Tape/ }).textContent).toBe('Tape');
    expect(screen.getByRole('tab', { name: /Brief/ }).textContent).toBe('Brief');
  });

  it('ticks the brief tab from the tree, with no brief file fetched at all', async () => {
    // The dates are the filenames, so which briefs exist is a property of the
    // tree. A device that has listed the repo but not yet pulled the markdown
    // still knows it is a day behind.
    await setMeta('gitread:newsletters:tree', [{ path: 'state/briefs/2026-08-25.md', sha: 'b1', size: 1 }]);
    await seedBaseline('2026-08-16T00:00:00.000Z');
    show('library');

    const brief = await screen.findByRole('tab', { name: /Brief/ });
    await waitFor(() => expect(brief.textContent).toBe('Brief1'));
  });
});
