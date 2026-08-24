/**
 * The committed surfaces, rendered from cached files.
 *
 * These run against the real file shapes — the tape's themes and stances, a
 * chart whose bar widths are quantities rather than percentages, a canon day
 * that carries `text` and `html` side by side, an essay whose citation strip
 * is at the foot of its own markdown — because the shapes are what the plan
 * guessed at and the repo settled.
 *
 * The failure paths matter as much as the happy ones: a malformed file names
 * itself, and an entry that has never been downloaded says so rather than
 * rendering an empty page.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { closeDb, getCachedContent, putCachedContent, setMeta } from '../lib/db';
import { GitHubError } from '../lib/github';
import { CanonPane, ChartPane, EssayPane, RawPane, TapePane } from './readSurfaces';

const mocks = vi.hoisted(() => ({ getBlob: vi.fn() }));

vi.mock('../lib/newsletters', () => ({ getBlob: mocks.getBlob }));

const TREE = [
  { path: 'state/tape.json', sha: 'tape1', size: 1 },
  { path: 'state/charts/2026-08-09--rails/chart.json', sha: 'c2', size: 1 },
  { path: 'state/charts/2026-08-08--power/chart.json', sha: 'c1', size: 1 },
  { path: 'state/canon/lessons/marks-sea-change/syllabus.json', sha: 's1', size: 1 },
  { path: 'state/canon/lessons/marks-sea-change/day-01.json', sha: 'd1', size: 1 },
  { path: 'state/canon/lessons/marks-sea-change/day-02.json', sha: 'd2', size: 1 },
  { path: 'wiki/essays/2026-07-07--profit-is-the-wire.md', sha: 'e1', size: 1 },
  { path: 'raw/2026-08-21--lex-asia/2026-08-21--lex-asia.md', sha: 'r1', size: 1 },
  { path: 'raw/2026-08-21--lex-asia/figures.md', sha: 'f1', size: 1 },
  { path: 'raw/2026-08-18--macro/2026-08-18--macro.md', sha: 'r2', size: 1 },
];

const TAPE = {
  window: { key: '2026-W34', start: '2026-08-17', end: '2026-08-23' },
  stats: { entries_in: 30, sources_in: 12 },
  tape: [
    { id: 'rates', display_name: 'CENTRAL BANKS', state: 'COOLING', this_window: 8, delta: -3 },
    { id: 'power', display_name: 'POWER', state: 'HOT', this_window: 6, delta: 2 },
  ],
  cards: [
    {
      id: 'rates',
      display_name: 'CENTRAL BANKS',
      label: 'Bonds and central banks in the inflation re-run',
      state: 'COOLING',
      source_chips: ['FT', 'ECON'],
      stance_left: "Bessent's interventions are working.",
      stance_right: 'This is yield-curve control by another name.',
      pressure_text: 'Whether the buyback playbook is stabilising.',
      evidence: [
        {
          text: "The BoJ's yen defence may have spent more than $95bn.",
          slug: '2026-08-13--yen-carry',
          citation: 'raw/2026-08-13--yen-carry/2026-08-13--yen-carry.md §"may have spent"',
        },
      ],
    },
    { id: 'bare' },
  ],
};

const CHART = {
  date: '2026-08-08',
  entries: ['2026-06-10--lex-making-ai-pay'],
  card: {
    kicker: 'Chart of the Day · 8 August 2026',
    headline: "Three unlisted firms already worth half of 2022's Big Tech",
    srcline: "FT (Lex) '26 · The Economist '26",
    metric: 'Market capitalisation, $ trillions',
    note: 'Reading it: bar length is market capitalisation itself.',
    bars: [
      { label: 'Magnificent Seven', value: '~$24tn', w: 24, group: 0 },
      { label: 'SpaceX + OpenAI', value: '~$4tn', w: 4, group: 2 },
    ],
  },
};

const SYLLABUS = {
  doc_id: 'marks-sea-change',
  days: [
    { day: 1, title: 'A cycle comes back', covers: 'Sea Change', idea: 'Almost everything is a cycle.' },
    { day: 2, title: 'Position size', covers: 'Sea Change', idea: 'Sizing is the opinion.' },
  ],
};

const DAY_TWO = {
  doc_id: 'marks-sea-change',
  day: 2,
  of: 2,
  subject: 'canon: day 2/2',
  html: '<table role="presentation">THIS MUST NOT RENDER</table>',
  text: 'Conviction is expressed in sizing [§“sizing as speech”].\n\nA second paragraph.',
  citations: ['sizing as speech'],
};

const ESSAY = [
  '---',
  'title: The Profit Is the Wire',
  '---',
  '',
  '# The Profit Is the Wire',
  '',
  'The backlog was the size of a country.[^1]',
  '',
  '[^1]: raw/2025-09-16--oracle/2025-09-16--oracle.md §"Denmark’s GDP"',
].join('\n');

const ENTRY = [
  '---',
  'title: Asia’s rising riches protect insurers',
  '---',
  '',
  '![](2026-08-21--lex-asia_images/page-0001.png)',
  '',
  'Insurers Prudential and AIA have recently felt the rough side of that.',
].join('\n');

const FIGURES = ['# Figures — 2026-08-21--lex-asia', '', '## page-0001.png', '', '**Type:** branding'].join('\n');

async function cache(path: string, text: string, sha: string): Promise<void> {
  await putCachedContent({ path, text, sha, fetchedAt: 1 });
}

async function resetDb(): Promise<void> {
  await closeDb();
  await new Promise<void>(resolve => {
    const req = indexedDB.deleteDatabase('meridian');
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

beforeEach(async () => {
  await resetDb();
  mocks.getBlob.mockReset();
  await setMeta('nlTree', TREE);
  await setMeta('newslettersToken', 'test-token-not-a-real-pat');
  await cache('state/tape.json', JSON.stringify(TAPE), 'tape1');
  await cache('state/charts/2026-08-09--rails/chart.json', JSON.stringify(CHART), 'c2');
  await cache('state/canon/lessons/marks-sea-change/syllabus.json', JSON.stringify(SYLLABUS), 's1');
  await cache('state/canon/lessons/marks-sea-change/day-02.json', JSON.stringify(DAY_TWO), 'd2');
  await cache('wiki/essays/2026-07-07--profit-is-the-wire.md', ESSAY, 'e1');
});

afterEach(async () => {
  cleanup();
  await resetDb();
});

const nav = vi.fn();

describe('tape', () => {
  it('renders the window, the themes and the cards', async () => {
    render(<TapePane />);

    expect(await screen.findByText(/2026-W34/)).toBeInTheDocument();
    expect(screen.getByText('30 entries · 12 sources')).toBeInTheDocument();
    expect(screen.getByText('Bonds and central banks in the inflation re-run')).toBeInTheDocument();
    expect(screen.getByText("Bessent's interventions are working.")).toBeInTheDocument();
    expect(screen.getByText('This is yield-curve control by another name.')).toBeInTheDocument();
    expect(
      screen.getByText('raw/2026-08-13--yen-carry/2026-08-13--yen-carry.md §"may have spent"')
    ).toBeInTheDocument();
  });

  it('renders a card with almost nothing in it as absent, never as "undefined"', async () => {
    const { container } = render(<TapePane />);
    await screen.findByText(/2026-W34/);
    expect(container.textContent).not.toContain('undefined');
  });
});

describe('chart', () => {
  it('scales the bars by the widest quantity and keeps the value outside', async () => {
    const { container } = render(<ChartPane item={[]} onNavigate={nav} />);

    expect(await screen.findByText(/Three unlisted firms/)).toBeInTheDocument();
    expect(screen.getByText('~$24tn')).toBeInTheDocument();

    const fills = container.querySelectorAll('.h-full');
    expect((fills[0] as HTMLElement).style.width).toBe('100%');
    // 4 of 24, not 4%.
    expect((fills[1] as HTMLElement).style.width).toBe(`${(4 / 24) * 100}%`);
  });

  it('opens the newest when the route names none, and offers the rest', async () => {
    render(<ChartPane item={[]} onNavigate={nav} />);

    // The newest is the one drawn; every other chart is one tap away.
    expect(await screen.findByText(/Three unlisted firms/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '2026-08-08' }));

    expect(nav).toHaveBeenCalledWith('chart', ['2026-08-08--power']);
  });

  it('names the file when one of the sixteen is malformed', async () => {
    await cache('state/charts/2026-08-08--power/chart.json', '{ not json', 'c1');

    render(<ChartPane item={['2026-08-08--power']} onNavigate={nav} />);

    expect(await screen.findByText('this file is not readable json')).toBeInTheDocument();
    expect(screen.getByText('state/charts/2026-08-08--power/chart.json')).toBeInTheDocument();
  });

  it('says which chart has not been synced rather than drawing nothing', async () => {
    render(<ChartPane item={['2026-08-08--power']} onNavigate={nav} />);
    expect(await screen.findByText('this chart has no card in it')).toBeInTheDocument();
  });
});

describe('canon', () => {
  it('lists the documents, then their days', async () => {
    const { rerender } = render(<CanonPane item={[]} onNavigate={nav} />);
    expect(await screen.findByText('marks-sea-change')).toBeInTheDocument();

    rerender(<CanonPane item={['marks-sea-change']} onNavigate={nav} />);
    expect(await screen.findByText('Position size')).toBeInTheDocument();
    expect(screen.getByText('day 2 · Sea Change')).toBeInTheDocument();
  });

  it('renders a day from its text, never from the email html it also carries', async () => {
    const { container } = render(<CanonPane item={['marks-sea-change', '2']} onNavigate={nav} />);

    expect(await screen.findByText(/Conviction is expressed in sizing/)).toBeInTheDocument();
    expect(container.textContent).not.toContain('THIS MUST NOT RENDER');
    expect(screen.getByText('day 2/2')).toBeInTheDocument();
    expect(screen.getByText('§“sizing as speech”')).toBeInTheDocument();
  });

  it('stops the ticker at both ends of the document', async () => {
    render(<CanonPane item={['marks-sea-change', '2']} onNavigate={nav} />);

    await screen.findByText('day 2/2');
    expect(screen.getByRole('button', { name: 'next →' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '← previous' })).not.toBeDisabled();
  });
});

describe('essays', () => {
  it('lists by title, then renders one with its citation strip', async () => {
    const { rerender } = render(<EssayPane item={[]} onNavigate={nav} />);
    expect(await screen.findByText('The Profit Is the Wire')).toBeInTheDocument();

    rerender(<EssayPane item={['2026-07-07--profit-is-the-wire']} onNavigate={nav} />);
    expect(await screen.findByText(/The backlog was the size of a country/)).toBeInTheDocument();
    expect(screen.getByText(/Denmark’s GDP/)).toBeInTheDocument();
    // The title is printed once, not twice.
    expect(screen.getAllByText('The Profit Is the Wire')).toHaveLength(1);
  });
});

describe('the source reader', () => {
  it('fetches an entry the first time it is opened, and caches it', async () => {
    mocks.getBlob.mockImplementation((_token: string, sha: string) =>
      Promise.resolve(sha === 'r1' ? ENTRY : FIGURES)
    );

    render(<RawPane item={['2026-08-21--lex-asia']} onNavigate={nav} />);

    expect(await screen.findByText('Asia’s rising riches protect insurers')).toBeInTheDocument();
    expect(mocks.getBlob).toHaveBeenCalledTimes(2);
    await waitFor(async () =>
      expect(await getCachedContent('raw/2026-08-21--lex-asia/2026-08-21--lex-asia.md')).toBeDefined()
    );
  });

  it('reads from cache on the second open, with no request at all', async () => {
    await cache('raw/2026-08-21--lex-asia/2026-08-21--lex-asia.md', ENTRY, 'r1');
    await cache('raw/2026-08-21--lex-asia/figures.md', FIGURES, 'f1');

    render(<RawPane item={['2026-08-21--lex-asia']} onNavigate={nav} />);

    expect(await screen.findByText(/Insurers Prudential and AIA/)).toBeInTheDocument();
    expect(mocks.getBlob).not.toHaveBeenCalled();
  });

  it('offers the figure reads only for an entry that has them', async () => {
    await cache('raw/2026-08-21--lex-asia/2026-08-21--lex-asia.md', ENTRY, 'r1');
    await cache('raw/2026-08-21--lex-asia/figures.md', FIGURES, 'f1');
    await cache('raw/2026-08-18--macro/2026-08-18--macro.md', ENTRY, 'r2');

    const { rerender } = render(<RawPane item={['2026-08-21--lex-asia']} onNavigate={nav} />);
    const toggle = await screen.findByRole('button', { name: 'figures' });

    fireEvent.click(toggle);
    expect(await screen.findByText('page-0001.png')).toBeInTheDocument();

    rerender(<RawPane item={['2026-08-18--macro']} onNavigate={nav} />);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'figures' })).toBeNull());
  });

  it('says an entry has not been downloaded rather than rendering an empty page', async () => {
    mocks.getBlob.mockRejectedValue(new GitHubError('offline', 0, 'network'));

    render(<RawPane item={['2026-08-18--macro']} onNavigate={nav} />);

    expect(await screen.findByText('offline — this one has not been downloaded yet')).toBeInTheDocument();
  });

  it('names an entry the corpus does not have', async () => {
    render(<RawPane item={['2026-01-01--not-a-thing']} onNavigate={nav} />);

    expect(await screen.findByText('the corpus has no entry by that name')).toBeInTheDocument();
    expect(
      screen.getByText('raw/2026-01-01--not-a-thing/2026-01-01--not-a-thing.md')
    ).toBeInTheDocument();
  });
});
