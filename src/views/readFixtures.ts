/**
 * Read view fixtures.
 *
 * Sample content, standing in for the newsletters repo until transport lands
 * (docs/PLAN_READING_PANE.md, phase 2). It mirrors reading-pane-mockup.html so
 * the shell can be judged on how it reads, with no token and no network.
 *
 * These shapes are the mockup's shapes, not the repo's: the committed files
 * define the real ones, and phase 3 renders from those. Nothing here should be
 * mistaken for a schema.
 */

/** A run of prose: text, with citation chips and footnote marks sitting in it. */
export type Segment = string | { cite: string } | { fn: number };

export interface TapeCard {
  id: string;
  kicker: string;
  headline: string;
  prose: Segment[][];
  srcCount: string;
  cites: string[];
}

export interface ChartBar {
  label: string;
  value: string;
  /** Fill width as a percentage of the track. */
  percent: number;
  tone: 'amber' | 'green' | 'ice';
}

export interface ChartCard {
  id: string;
  kicker: string;
  headline: string;
  bars: ChartBar[];
  note: string;
  cites: string[];
}

export interface CanonDay {
  doc: string;
  day: number;
  of: number;
  kicker: string;
  headline: string;
  prose: Segment[][];
  citations: string;
}

export interface EssayCard {
  slug: string;
  kicker: string;
  headline: string;
  subtitle: string;
  prose: Segment[][];
  footnotes: string;
}

export interface LibraryRow {
  slug: string;
  date: string;
  title: string;
  gist: string;
  /** Seed state only. Phase 5 folds this from `readItem` events. */
  read: boolean;
}

export const TAPE_CARDS: TapeCard[] = [
  {
    id: '2026-w34',
    kicker: 'Tape wk 34 · 30 entries · lead theme',
    headline: "Term premium does the tightening the Fed won't",
    prose: [
      [
        "Long-end yields grinding higher while the front end sits still — the sample week's tape reads as duration repricing, not inflation repricing. Three sources land on the same mechanism from different doors.",
      ],
    ],
    srcCount: '4 entries',
    cites: ['raw/2026-08-18--sample-macro §"the long end"', '+3'],
  },
  {
    id: '2026-w34-second',
    kicker: 'Second theme',
    headline: 'Capex cycle vs. cash-flow discipline — the sample argument',
    prose: [
      [
        'Placeholder card copy. Real cards render from state/tape.json — headline, kicker, note, srcline — exactly as committed.',
      ],
    ],
    srcCount: '3 entries',
    cites: ['raw/2026-08-20--sample-entry §"capex"'],
  },
];

export const CHART_CARD: ChartCard = {
  id: '2026-08-21--sample-power',
  kicker: 'Chart · sample hook',
  headline: "Who's actually paying up for power (sample data)",
  bars: [
    { label: 'Utilities capex', value: '+86%', percent: 86, tone: 'amber' },
    { label: 'Hyperscalers', value: '+64%', percent: 64, tone: 'green' },
    { label: 'Grid storage', value: '+41%', percent: 41, tone: 'ice' },
    { label: 'Residential', value: '+12%', percent: 12, tone: 'ice' },
  ],
  note: 'Bars draw from chart.json → bars[] as real SVG/DOM — the value sits outside the bar, a habit worth keeping even where no mail client can strip the fill.',
  cites: ['raw/2026-08-21--sample-power §"capex table"'],
};

export const CANON_DAY: CanonDay = {
  doc: 'risk-memos',
  day: 4,
  of: 9,
  kicker: 'canon · risk-memos (1996)',
  headline: 'Position size is the only opinion that compounds',
  prose: [
    [
      'The sample lesson renders from the committed day-NN.json text — never the email HTML. Conviction, the memo argues, is expressed in sizing, not in commentary ',
      { cite: '§"sizing as speech"' },
      ". The rest of the day's prose flows at reading measure, serif, 16px, 1.68 line-height — the ergonomics your emails already fought Gmail for.",
    ],
    [
      'Every claim keeps its inline citation, and every citation is now a tap-through into the source prose ',
      { cite: '§"the 1996 postmortem"' },
      ' — the one thing the email surface structurally could not do.',
    ],
  ],
  citations: 'citations → raw/1996--risk-memos §"sizing as speech" · §"the 1996 postmortem"',
};

export const ESSAY_CARD: EssayCard = {
  slug: 'the-tape-doesnt-care',
  kicker: 'Essay · 1,840 words',
  headline: "The tape doesn't care about your macro view (sample)",
  subtitle: 'A sample subtitle sits here, muted, one line.',
  prose: [
    [
      'Essays render from wiki/essays/*.md with footnotes intact',
      { fn: 1 },
      ' — each marker resolves through the .citations.json sidecar into the stacks',
      { fn: 2 },
      ', popover first, full click-through second.',
    ],
  ],
  footnotes: '[1] raw/2026-07-30--sample §"flows vs views"   [2] raw/2026-08-02--sample §"positioning data"',
};

export const LIBRARY_ROWS: LibraryRow[] = [
  {
    slug: '2026-08-22--sample-power',
    date: '2026-08-22',
    title: 'Sample newsletter — the power buildout',
    gist: 'One-line gist from state/gists.md renders here, clamped to a single line.',
    read: false,
  },
  {
    slug: '2026-08-21--sample-rates',
    date: '2026-08-21',
    title: 'Sample transcript — rates panel',
    gist: 'Term premium, issuance calendar, and the sample argument about duration.',
    read: false,
  },
  {
    slug: '2026-08-20--sample-entry',
    date: '2026-08-20',
    title: 'Sample note — capex discipline',
    gist: "Cash-flow discipline vs. growth capex, the sample week's second theme.",
    read: false,
  },
  {
    slug: '2026-08-19--sample-em',
    date: '2026-08-19',
    title: 'Sample letter — EM currencies',
    gist: 'A sample gist line about carry, positioning, and the dollar.',
    read: false,
  },
  {
    slug: '2026-08-18--sample-macro',
    date: '2026-08-18',
    title: 'Sample macro letter — the long end',
    gist: 'Already read — dot dark, title quiet, checkmark green.',
    read: true,
  },
];
