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
  // A course still being delivered: the syllabus declares four days, one has
  // been written.
  { path: 'state/canon/lessons/dalio-changing-world-order/syllabus.json', sha: 's2', size: 1 },
  { path: 'state/canon/lessons/dalio-changing-world-order/day-01.json', sha: 'dd1', size: 1 },
  { path: 'state/canon/lessons/marks-sea-change/day-01.json', sha: 'd1', size: 1 },
  { path: 'state/canon/lessons/marks-sea-change/day-02.json', sha: 'd2', size: 1 },
  { path: 'wiki/essays/2026-07-07--profit-is-the-wire.md', sha: 'e1', size: 1 },
  { path: 'raw/2026-08-21--lex-asia/2026-08-21--lex-asia.md', sha: 'r1', size: 1 },
  { path: 'raw/2026-08-21--lex-asia/figures.md', sha: 'f1', size: 1 },
  { path: 'raw/2026-08-18--macro/2026-08-18--macro.md', sha: 'r2', size: 1 },
  { path: 'raw/2025-09-16--oracle/2025-09-16--oracle.md', sha: 'r3', size: 1 },
  { path: 'state/gists.md', sha: 'g1', size: 1 },
];

/** `<slug> | <what the piece says>`, joined against the tree. */
const GISTS = '2025-09-16--oracle | The backlog is the size of a small country.';

/** Eight week-starts, the axis every `touches` array is counted over. */
const WEEKS = [
  '2026-07-06',
  '2026-07-13',
  '2026-07-20',
  '2026-07-27',
  '2026-08-03',
  '2026-08-10',
  '2026-08-17',
  '2026-08-24',
];

const TAPE = {
  window: { key: '2026-W34', start: '2026-08-17', end: '2026-08-23' },
  stats: { entries_in: 30, sources_in: 12, figures_in: 29, new_voices: ['Sport Money'] },
  weeks: WEEKS,
  run_date: '2026-08-23',
  tape: [
    {
      id: 'rates',
      display_name: 'CENTRAL BANKS',
      state: 'COOLING',
      this_window: 8,
      delta: -3,
      // Born in the fourth week, so the first three never existed. Busiest
      // week is 8, which is what the rest scale against.
      touches: [0, 0, 0, 1, 4, 8, 2, 0],
      first_seen: '2026-07-27',
    },
    { id: 'power', display_name: 'POWER', state: 'HOT', this_window: 6, delta: 2 },
  ],
  cards: [
    {
      id: 'rates',
      display_name: 'CENTRAL BANKS',
      label: 'Bonds and central banks in the inflation re-run',
      state: 'COOLING',
      source_chips: ['FT', 'ECON'],
      this_window: 8,
      delta: -3,
      touches: [0, 0, 0, 1, 4, 8, 2, 0],
      first_seen: '2026-07-27',
      stance_left: "Bessent's interventions are working.",
      stance_right: 'This is yield-curve control by another name.',
      pressure_text: 'Whether the buyback playbook is stabilising.',
      resurfacing: {
        slug: '2025-09-16--oracle',
        text: 'the same defence, a year earlier',
      },
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
  ledger: {
    born: [{ id: 'sport', display_name: 'SPORT MONEY', note: 'private equity buys a league' }],
    quiet: [{ labels: 'CRYPTO RAILS', note: 'nothing for three weeks' }],
  },
};

/** A tape cut before any of this was in the file. */
const BARE_TAPE = { window: TAPE.window, stats: { entries_in: 4 }, tape: [], cards: [] };

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
  // The piece the published edition prints around the picture. Every chart in
  // the corpus carries one; the pane drew none of it until now.
  post: {
    title: "Three unlisted firms already worth half of 2022's Big Tech",
    subtitle: 'Chart of the Day · 8 August 2026 · FT Lex · The Economist',
    intro: 'A market capitalisation says what the market thinks a company is worth.',
    why: 'Neither author is making this comparison, which is the point of putting them together.',
    questions: [
      '1. Does a private valuation mean the same thing as a public one?',
      '2. What would have to be true for these two bars to swap?',
      '3. Who is on the other side of these marks?',
    ],
    footer: 'Two pieces from my commonplace book, never priced against each other.',
    sources: [
      {
        pre: 'FT (Lex), "Making AI pay," 10 Jun 2026 — ',
        text: 'ft.com',
        href: 'https://www.ft.com',
        post: '',
      },
    ],
  },
};

/** A chart whose file carries the picture and nothing else. */
const BARE_CHART = { date: '2026-08-09', entries: [], card: CHART.card };

const SYLLABUS = {
  doc_id: 'marks-sea-change',
  entry: 'raw/2022-12-01--marks-sea-change',
  days: [
    { day: 1, title: 'A cycle comes back', covers: 'Sea Change', idea: 'Almost everything is a cycle.' },
    { day: 2, title: 'Position size', covers: 'Sea Change', idea: 'Sizing is the opinion.' },
  ],
};

const DALIO_SYLLABUS = {
  doc_id: 'dalio-changing-world-order',
  entry: 'raw/2020-01-01--dalio-changing-world-order',
  days: [
    { day: 1, title: 'A cycle comes back', covers: 'Chapter 1', idea: 'Orders are mortal.' },
    { day: 2, title: 'The machine under everything', covers: 'Chapter 2', idea: 'Credit is not wealth.' },
    { day: 3, title: 'The big cycle', covers: 'Chapter 3', idea: 'Empires rhyme.' },
    { day: 4, title: 'Where we are', covers: 'Chapter 4', idea: 'Read the gauges.' },
  ],
};

const DALIO_DAY_ONE = {
  doc_id: 'dalio-changing-world-order',
  entry: 'raw/2020-01-01--dalio-changing-world-order',
  day: 1,
  of: 4,
  text: 'Day 1 of 4 · Orders are mortal, and this one is no exception.',
};

const DAY_TWO = {
  doc_id: 'marks-sea-change',
  entry: 'raw/2022-12-01--marks-sea-change',
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
  await cache(
    'state/canon/lessons/dalio-changing-world-order/syllabus.json',
    JSON.stringify(DALIO_SYLLABUS),
    's2'
  );
  await cache(
    'state/canon/lessons/dalio-changing-world-order/day-01.json',
    JSON.stringify(DALIO_DAY_ONE),
    'dd1'
  );
  await cache('state/canon/lessons/marks-sea-change/day-02.json', JSON.stringify(DAY_TWO), 'd2');
  await cache('wiki/essays/2026-07-07--profit-is-the-wire.md', ESSAY, 'e1');
  await cache('state/gists.md', GISTS, 'g1');
  nav.mockClear();
});

afterEach(async () => {
  cleanup();
  await resetDb();
});

const nav = vi.fn();

/**
 * Read-state is the Read view's, not a surface's: every pane takes it as a
 * prop, so these render with nothing marked and a toggle that records the tap.
 */
const mark = vi.fn();
const read = { isRead: () => false, toggle: mark };

describe('tape', () => {
  it('renders the window, the themes and the cards', async () => {
    render(<TapePane item={[]} onNavigate={nav}  read={read} />);

    expect(await screen.findByText(/2026-W34/)).toBeInTheDocument();
    expect(screen.getByText('30 entries · 12 sources · 29 figures')).toBeInTheDocument();
    expect(screen.getByText('Bonds and central banks in the inflation re-run')).toBeInTheDocument();
    expect(screen.getByText("Bessent's interventions are working.")).toBeInTheDocument();
    expect(screen.getByText('This is yield-curve control by another name.')).toBeInTheDocument();
    // The evidence chip names the document and taps into it; the span it
    // lands on rides in the title rather than in the line.
    const chip = screen.getByRole('button', { name: '2026-08-13--yen-carry' });
    expect(chip).toHaveAttribute('title', '2026-08-13--yen-carry §may have spent');
  });

  it('draws eight weeks as eight characters, the edition\'s own scale', async () => {
    render(<TapePane item={[]} onNavigate={nav} read={read} />);
    await screen.findByText(/2026-W34/);

    // Born in the fourth week, so the first three are middle dots — the theme
    // did not exist, which is not the same fact as a week with no touches.
    // The rest scale against the theme's own busiest week, not the tape's.
    expect(screen.getAllByText('···▂▅█▃▁')).toHaveLength(2);
  });

  it('says how the week moved and how long the theme has run', async () => {
    render(<TapePane item={[]} onNavigate={nav} read={read} />);
    await screen.findByText(/2026-W34/);

    expect(screen.getByText(/8 touches this wk \(-3\)/)).toBeInTheDocument();
    expect(screen.getByText(/wk 4/)).toBeInTheDocument();
  });

  it('carries the figures count and who is new to the corpus', async () => {
    render(<TapePane item={[]} onNavigate={nav} read={read} />);

    expect(await screen.findByText(/30 entries · 12 sources · 29 figures/)).toBeInTheDocument();
    expect(screen.getByText('1 new voice: Sport Money')).toBeInTheDocument();
  });

  it('shows what an entry resurfaced, and taps into it', async () => {
    render(<TapePane item={[]} onNavigate={nav} read={read} />);
    await screen.findByText(/2026-W34/);

    expect(screen.getByText(/↞ resurfaces/)).toBeInTheDocument();
    expect(screen.getByText(/the same defence, a year earlier/)).toBeInTheDocument();

    // The slug is a live mark like every other one on this surface.
    fireEvent.click(screen.getByRole('button', { name: '2025-09-16--oracle' }));
    expect(nav).toHaveBeenCalledWith('raw', ['2025-09-16--oracle']);
  });

  it('closes on the ledger — what was born and what went quiet', async () => {
    render(<TapePane item={[]} onNavigate={nav} read={read} />);
    await screen.findByText(/2026-W34/);

    expect(screen.getByText('the ledger — born & gone quiet')).toBeInTheDocument();
    expect(screen.getByText(/SPORT MONEY — private equity buys a league/)).toBeInTheDocument();
    expect(screen.getByText(/CRYPTO RAILS — nothing for three weeks/)).toBeInTheDocument();
  });

  it('is still a tape when the file carries none of it', async () => {
    await cache('state/tape.json', JSON.stringify(BARE_TAPE), 'tape1');

    render(<TapePane item={[]} onNavigate={nav} read={read} />);

    expect(await screen.findByText(/2026-W34/)).toBeInTheDocument();
    expect(screen.queryByText(/the ledger/)).not.toBeInTheDocument();
    expect(screen.queryByText(/new voice/)).not.toBeInTheDocument();
    expect(screen.queryByText(/resurfaces/)).not.toBeInTheDocument();
  });

  it('renders a card with almost nothing in it as absent, never as "undefined"', async () => {
    const { container } = render(<TapePane item={[]} onNavigate={nav}  read={read} />);
    await screen.findByText(/2026-W34/);
    expect(container.textContent).not.toContain('undefined');
  });
});

describe('chart', () => {
  it('scales the bars by the widest quantity and keeps the value outside', async () => {
    const { container } = render(<ChartPane item={[]} onNavigate={nav}  read={read} />);

    expect(await screen.findByText(/Three unlisted firms/)).toBeInTheDocument();
    expect(screen.getByText('~$24tn')).toBeInTheDocument();

    const fills = container.querySelectorAll('.h-full');
    expect((fills[0] as HTMLElement).style.width).toBe('100%');
    // 4 of 24, not 4%.
    expect((fills[1] as HTMLElement).style.width).toBe(`${(4 / 24) * 100}%`);
  });

  it('opens the newest when the route names none, and offers the rest', async () => {
    render(<ChartPane item={[]} onNavigate={nav}  read={read} />);

    // The newest is the one drawn; every other chart is one tap away.
    expect(await screen.findByText(/Three unlisted firms/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '2026-08-08' }));

    expect(nav).toHaveBeenCalledWith('chart', ['2026-08-08--power']);
  });

  it('prints the piece the edition prints, in the edition\'s order', async () => {
    const { container } = render(<ChartPane item={[]} onNavigate={nav} read={read} />);
    await screen.findByText(/Three unlisted firms/);

    expect(screen.getByText(/A market capitalisation says/)).toBeInTheDocument();
    expect(screen.getByText("why it's interesting")).toBeInTheDocument();
    expect(screen.getByText(/Neither author is making/)).toBeInTheDocument();
    expect(screen.getByText('table talk')).toBeInTheDocument();
    expect(screen.getByText(/Does a private valuation/)).toBeInTheDocument();
    expect(screen.getByText(/Who is on the other side/)).toBeInTheDocument();
    expect(screen.getByText(/never priced against each other/)).toBeInTheDocument();

    // The order is the published one: the picture, then the opening, then the
    // argument, then the questions.
    const body = container.textContent ?? '';
    expect(body.indexOf('A market capitalisation')).toBeLessThan(body.indexOf("why it's interesting"));
    expect(body.indexOf("why it's interesting")).toBeLessThan(body.indexOf('table talk'));
  });

  it('links a source out to the browser rather than out of the app', async () => {
    const { container } = render(<ChartPane item={[]} onNavigate={nav} read={read} />);
    await screen.findByText(/Three unlisted firms/);

    const link = screen.getByRole('link', { name: 'ft.com' });
    expect(link).toHaveAttribute('href', 'https://www.ft.com');
    // A home-screen PWA has no address bar; a same-window navigation would
    // strand the owner outside the app.
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    // The citation reads as one line: the text before the link, the link, and
    // whatever follows it.
    expect(container.textContent).toContain('FT (Lex), "Making AI pay," 10 Jun 2026 — ft.com');
  });

  it('is still a chart when the file carries no prose at all', async () => {
    await cache('state/charts/2026-08-08--power/chart.json', JSON.stringify(BARE_CHART), 'c1');

    render(<ChartPane item={['2026-08-08--power']} onNavigate={nav} read={read} />);

    expect(await screen.findByText(/Three unlisted firms/)).toBeInTheDocument();
    expect(screen.getByText('~$24tn')).toBeInTheDocument();
    expect(screen.queryByText("why it's interesting")).not.toBeInTheDocument();
    expect(screen.queryByText('table talk')).not.toBeInTheDocument();
    expect(screen.queryByText('sources')).not.toBeInTheDocument();
  });

  it('names the file when one of the sixteen is malformed', async () => {
    await cache('state/charts/2026-08-08--power/chart.json', '{ not json', 'c1');

    render(<ChartPane item={['2026-08-08--power']} onNavigate={nav}  read={read} />);

    expect(await screen.findByText('this file is not readable json')).toBeInTheDocument();
    expect(screen.getByText('state/charts/2026-08-08--power/chart.json')).toBeInTheDocument();
  });

  it('says which chart has not been synced rather than drawing nothing', async () => {
    render(<ChartPane item={['2026-08-08--power']} onNavigate={nav}  read={read} />);
    expect(await screen.findByText('this chart has no card in it')).toBeInTheDocument();
  });
});

describe('canon', () => {
  it('lists the documents, then their days', async () => {
    const { rerender } = render(<CanonPane item={[]} onNavigate={nav}  read={read} />);
    expect(await screen.findByText('marks-sea-change')).toBeInTheDocument();

    rerender(<CanonPane item={['marks-sea-change']} onNavigate={nav}  read={read} />);
    expect(await screen.findByText('Position size')).toBeInTheDocument();
    expect(screen.getByText('day 2 · Sea Change')).toBeInTheDocument();
  });

  it('renders a day from its text, never from the email html it also carries', async () => {
    const { container } = render(<CanonPane item={['marks-sea-change', '2']} onNavigate={nav}  read={read} />);

    expect(await screen.findByText(/Conviction is expressed in sizing/)).toBeInTheDocument();
    expect(container.textContent).not.toContain('THIS MUST NOT RENDER');
    expect(screen.getByText('day 2/2')).toBeInTheDocument();
    expect(screen.getByText('§“sizing as speech”')).toBeInTheDocument();
  });

  it('says how much of a course has arrived, not how long it will be', async () => {
    render(<CanonPane item={[]} onNavigate={nav} read={read} />);
    await screen.findByText('marks-sea-change');

    // Four declared, one written. The finished course just says its length.
    expect(screen.getByText('1 of 4 days')).toBeInTheDocument();
    expect(screen.getByText('2 days')).toBeInTheDocument();
  });

  it('opens the days that have arrived and leaves the rest as outline', async () => {
    render(<CanonPane item={['dalio-changing-world-order']} onNavigate={nav} read={read} />);
    await screen.findByText('A cycle comes back');

    // Day one is a door.
    fireEvent.click(screen.getByText('A cycle comes back'));
    expect(nav).toHaveBeenCalledWith('canon', ['dalio-changing-world-order', '1']);

    // The rest are the map. Visible, titled, and not openable — a course
    // arrives a day at a time and that is the point of it.
    nav.mockClear();
    expect(screen.getAllByText(/not yet/)).toHaveLength(3);
    fireEvent.click(screen.getByText('The big cycle'));
    expect(nav).not.toHaveBeenCalled();
  });

  it('says a day has not arrived rather than blaming this device', async () => {
    render(<CanonPane item={['dalio-changing-world-order', '3']} onNavigate={nav} read={read} />);

    expect(await screen.findByText(/day 3 has not arrived yet/)).toBeInTheDocument();
    expect(screen.getByText(/the course is at day 1 of 4/)).toBeInTheDocument();
    expect(screen.queryByText(/has not been synced to this device/)).not.toBeInTheDocument();
  });

  it('will not walk forward past the last day that exists', async () => {
    render(<CanonPane item={['dalio-changing-world-order', '1']} onNavigate={nav} read={read} />);

    await screen.findByText(/Orders are mortal/);
    // The syllabus knows about day four. Day two does not exist yet.
    expect(screen.getByRole('button', { name: 'next →' })).toBeDisabled();
  });

  it('stops the ticker at both ends of the document', async () => {
    render(<CanonPane item={['marks-sea-change', '2']} onNavigate={nav}  read={read} />);

    await screen.findByText('day 2/2');
    expect(screen.getByRole('button', { name: 'next →' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '← previous' })).not.toBeDisabled();
  });
});

describe('essays', () => {
  it('lists by title, then renders one with its citation strip', async () => {
    const { rerender } = render(<EssayPane item={[]} onNavigate={nav}  read={read} />);
    expect(await screen.findByText('The Profit Is the Wire')).toBeInTheDocument();

    rerender(<EssayPane item={['2026-07-07--profit-is-the-wire']} onNavigate={nav}  read={read} />);
    expect(await screen.findByText(/The backlog was the size of a country/)).toBeInTheDocument();
    expect(screen.getByText(/Denmark’s GDP/)).toBeInTheDocument();
    // The title is printed once, not twice.
    expect(screen.getAllByText('The Profit Is the Wire')).toHaveLength(1);
  });
});

describe('citations, from every surface', () => {
  it('taps the tape’s evidence into the entry it quotes, at the span', async () => {
    render(<TapePane item={[]} onNavigate={nav}  read={read} />);
    await screen.findByText(/2026-W34/);

    fireEvent.click(screen.getByRole('button', { name: '2026-08-13--yen-carry' }));

    expect(nav).toHaveBeenCalledWith('raw', [
      '2026-08-13--yen-carry',
      'prose',
      'may have spent',
    ]);
  });

  it('taps a chart’s entries into whole documents — they name no span', async () => {
    render(<ChartPane item={[]} onNavigate={nav}  read={read} />);
    await screen.findByText(/Three unlisted firms/);

    fireEvent.click(screen.getByRole('button', { name: '2026-06-10--lex-making-ai-pay' }));

    expect(nav).toHaveBeenCalledWith('raw', ['2026-06-10--lex-making-ai-pay']);
  });

  it('taps a canon mark, inline and in the footer, into the lesson’s own source', async () => {
    render(<CanonPane item={['marks-sea-change', '2']} onNavigate={nav}  read={read} />);
    await screen.findByText(/Conviction is expressed in sizing/);

    const landing = ['raw', ['2022-12-01--marks-sea-change', 'prose', 'sizing as speech']];

    fireEvent.click(screen.getByRole('button', { name: '§“sizing as speech”' }));
    expect(nav).toHaveBeenCalledWith(...landing);

    nav.mockClear();
    fireEvent.click(screen.getByRole('button', { name: '§sizing as speech' }));
    expect(nav).toHaveBeenCalledWith(...landing);
  });

  it('leaves a canon mark inert when the lesson names no source', async () => {
    await cache(
      'state/canon/lessons/marks-sea-change/day-02.json',
      JSON.stringify({ ...DAY_TWO, entry: undefined }),
      'd2'
    );
    await cache(
      'state/canon/lessons/marks-sea-change/syllabus.json',
      JSON.stringify({ ...SYLLABUS, entry: undefined }),
      's1'
    );

    render(<CanonPane item={['marks-sea-change', '2']} onNavigate={nav}  read={read} />);
    await screen.findByText(/Conviction is expressed in sizing/);

    // The mark is still drawn — it is just not a button that goes nowhere.
    expect(screen.getByText('§“sizing as speech”')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '§“sizing as speech”' })).toBeNull();
  });

  it('opens an essay’s footnote as a popover first, then the source', async () => {
    render(<EssayPane item={['2026-07-07--profit-is-the-wire']} onNavigate={nav}  read={read} />);
    await screen.findByText(/The backlog was the size of a country/);

    fireEvent.click(screen.getByRole('button', { name: 'Source for note 1' }));

    // Which document, in the corpus's own words, before committing to leave.
    expect(screen.getByText('The backlog is the size of a small country.')).toBeInTheDocument();
    // The popover names the span; so does the strip at the foot.
    expect(screen.getAllByText('§Denmark’s GDP')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'open source →' }));
    expect(nav).toHaveBeenCalledWith('raw', ['2025-09-16--oracle', 'prose', 'Denmark’s GDP']);
  });

  it('taps the essay’s strip into the same place as its marker', async () => {
    render(<EssayPane item={['2026-07-07--profit-is-the-wire']} onNavigate={nav}  read={read} />);
    await screen.findByText(/The backlog was the size of a country/);

    fireEvent.click(screen.getByRole('button', { name: '2025-09-16--oracle' }));

    expect(nav).toHaveBeenCalledWith('raw', ['2025-09-16--oracle', 'prose', 'Denmark’s GDP']);
  });
});

describe('where a citation lands', () => {
  beforeEach(async () => {
    await cache('raw/2026-08-21--lex-asia/2026-08-21--lex-asia.md', ENTRY, 'r1');
    await cache('raw/2026-08-21--lex-asia/figures.md', FIGURES, 'f1');
    await cache('raw/2026-08-18--macro/2026-08-18--macro.md', ENTRY, 'r2');
  });

  it('marks the block that carries the span', async () => {
    const { container } = render(
      <RawPane
        item={['2026-08-21--lex-asia', 'prose', 'Insurers Prudential and AIA']}
        onNavigate={nav}
       read={read} />
    );
    await screen.findByText(/Insurers Prudential and AIA/);

    const landed = container.querySelector('[data-cite-mark]');
    expect(landed?.textContent).toContain('Insurers Prudential and AIA');
    expect(screen.queryByText('§ not found — opened at top')).toBeNull();
  });

  it('opens the figures twin when the citation points there', async () => {
    const { container } = render(
      <RawPane item={['2026-08-21--lex-asia', 'figures', 'Type: branding']} onNavigate={nav}  read={read} />
    );

    expect(await screen.findByText(/branding/)).toBeInTheDocument();
    expect(container.querySelector('[data-cite-mark]')?.textContent).toContain('branding');
  });

  it('opens at the top and says why, rather than being a dead tap', async () => {
    const { container } = render(
      <RawPane
        item={['2026-08-21--lex-asia', 'prose', 'a sentence from another entry entirely']}
        onNavigate={nav}
       read={read} />
    );

    expect(await screen.findByText('§ not found — opened at top')).toBeInTheDocument();
    // The entry the reader asked for is still the entry they got.
    expect(screen.getByText(/Insurers Prudential and AIA/)).toBeInTheDocument();
    expect(container.querySelector('[data-cite-mark]')).toBeNull();
  });

  it('says so when the citation names figures the entry does not have', async () => {
    render(<RawPane item={['2026-08-18--macro', 'figures', 'anything']} onNavigate={nav}  read={read} />);

    expect(await screen.findByText('no figures in this entry — opened the prose')).toBeInTheDocument();
  });

  it('lets the toggle override the file the route chose', async () => {
    render(
      <RawPane item={['2026-08-21--lex-asia', 'figures', 'Type: branding']} onNavigate={nav}  read={read} />
    );
    await screen.findByText(/branding/);

    fireEvent.click(screen.getByRole('button', { name: 'prose' }));
    expect(await screen.findByText(/Insurers Prudential and AIA/)).toBeInTheDocument();
  });
});

describe('the source reader', () => {
  it('fetches an entry the first time it is opened, and caches it', async () => {
    mocks.getBlob.mockImplementation((_token: string, sha: string) =>
      Promise.resolve(sha === 'r1' ? ENTRY : FIGURES)
    );

    render(<RawPane item={['2026-08-21--lex-asia']} onNavigate={nav}  read={read} />);

    expect(await screen.findByText('Asia’s rising riches protect insurers')).toBeInTheDocument();
    expect(mocks.getBlob).toHaveBeenCalledTimes(2);
    await waitFor(async () =>
      expect(await getCachedContent('raw/2026-08-21--lex-asia/2026-08-21--lex-asia.md')).toBeDefined()
    );
  });

  it('reads from cache on the second open, with no request at all', async () => {
    await cache('raw/2026-08-21--lex-asia/2026-08-21--lex-asia.md', ENTRY, 'r1');
    await cache('raw/2026-08-21--lex-asia/figures.md', FIGURES, 'f1');

    render(<RawPane item={['2026-08-21--lex-asia']} onNavigate={nav}  read={read} />);

    expect(await screen.findByText(/Insurers Prudential and AIA/)).toBeInTheDocument();
    expect(mocks.getBlob).not.toHaveBeenCalled();
  });

  it('offers the figure reads only for an entry that has them', async () => {
    await cache('raw/2026-08-21--lex-asia/2026-08-21--lex-asia.md', ENTRY, 'r1');
    await cache('raw/2026-08-21--lex-asia/figures.md', FIGURES, 'f1');
    await cache('raw/2026-08-18--macro/2026-08-18--macro.md', ENTRY, 'r2');

    const { rerender } = render(<RawPane item={['2026-08-21--lex-asia']} onNavigate={nav}  read={read} />);
    const toggle = await screen.findByRole('button', { name: 'figures' });

    fireEvent.click(toggle);
    expect(await screen.findByText('page-0001.png')).toBeInTheDocument();

    rerender(<RawPane item={['2026-08-18--macro']} onNavigate={nav}  read={read} />);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'figures' })).toBeNull());
  });

  it('says an entry has not been downloaded rather than rendering an empty page', async () => {
    mocks.getBlob.mockRejectedValue(new GitHubError('offline', 0, 'network'));

    render(<RawPane item={['2026-08-18--macro']} onNavigate={nav}  read={read} />);

    expect(await screen.findByText('offline — this one has not been downloaded yet')).toBeInTheDocument();
  });

  it('names an entry the corpus does not have', async () => {
    render(<RawPane item={['2026-01-01--not-a-thing']} onNavigate={nav}  read={read} />);

    expect(await screen.findByText('the corpus has no entry by that name')).toBeInTheDocument();
    expect(
      screen.getByText('raw/2026-01-01--not-a-thing/2026-01-01--not-a-thing.md')
    ).toBeInTheDocument();
  });
});

describe('marking read', () => {
  /** Tap the affordance at the foot of whatever is on screen. */
  function tap(): void {
    fireEvent.click(screen.getByRole('button', { name: 'mark read' }));
  }

  it('keys the tape by its window, because the tape is published once a week', async () => {
    render(<TapePane item={[]} onNavigate={nav} read={read} />);
    await screen.findByText(/2026-W34/);

    tap();
    expect(mark).toHaveBeenCalledWith('tape:2026-W34');
  });

  it('keys a chart by the id in the address', async () => {
    render(<ChartPane item={['2026-08-09--rails']} onNavigate={nav} read={read} />);
    await screen.findByText(/Three unlisted firms/);

    tap();
    expect(mark).toHaveBeenCalledWith('chart:2026-08-09--rails');
  });

  it('keys a canon lesson by its document and day', async () => {
    render(<CanonPane item={['marks-sea-change', '2']} onNavigate={nav} read={read} />);
    await screen.findByText(/canon · marks-sea-change/);

    tap();
    expect(mark).toHaveBeenCalledWith('canon:marks-sea-change/2');
  });

  it('keys an essay by its slug', async () => {
    render(
      <EssayPane item={['2026-07-07--profit-is-the-wire']} onNavigate={nav} read={read} />
    );
    await screen.findByText('essay');

    tap();
    expect(mark).toHaveBeenCalledWith('essay:2026-07-07--profit-is-the-wire');
  });

  it('gives the source reader the same key the Library row carries', async () => {
    mocks.getBlob.mockResolvedValue('# Lex Asia\n\nBeijing taxes offshore savings.');
    render(<RawPane item={['2026-08-21--lex-asia']} onNavigate={nav} read={read} />);
    await screen.findByText('Lex Asia');

    tap();
    // The Library marks `raw:<slug>` too — one entry, one record, so reading
    // it here turns the dot there.
    expect(mark).toHaveBeenCalledWith('raw:2026-08-21--lex-asia');
  });

  it('offers nothing to mark on a list: a list is not a thing that was read', async () => {
    render(<CanonPane item={[]} onNavigate={nav} read={read} />);
    await screen.findByText('marks-sea-change');

    expect(screen.queryByRole('button', { name: 'mark read' })).not.toBeInTheDocument();
  });
});
