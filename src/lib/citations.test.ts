/**
 * The resolver, against the corpus's own strings.
 *
 * Every fixture below is copied out of `spiffler33/newsletters` rather than
 * invented, because the plan's original guess about this grammar — that `§`
 * names a heading — was wrong, and the only defence against guessing again is
 * to test what the files actually say. The awkward ones are all real: a span
 * with quotes inside it, a figures table row that carries pipes, a canon mark
 * in curly quotes, a chart entry that is a bare slug and names no span at all.
 */

import { describe, expect, it } from 'vitest';

import {
  blockText,
  citationRoute,
  findCitedBlock,
  normalizeForMatch,
  resolveCitation,
  routeTarget,
} from './citations';
import { parseMarkdown } from './markdown';

// --- The three grammars, verbatim from the repo ---------------------------

const TAPE_CITATION =
  'raw/2026-08-13--economist-free-exchange-yen-carry/2026-08-13--economist-free-exchange-yen-carry.md §"may have spent more than $95bn"';

const ESSAY_FIGURES =
  'raw/2026-06-30--burry-trading-post-jun-30/figures.md §"1998 Long Term Cap Mgmnt Collapse | Feb 1998 | 330 | +2% | Oct 1998 | 190 | −42% | 7.4"';

const ESSAY_NESTED_QUOTES =
  'raw/2025-12-18--lessons-from-history-railroad-buildout/2025-12-18--lessons-from-history-railroad-buildout.md §"by 1890, 40% of railroad capitalization represented "water", or securities issued in excess of any investment in roadbed, rails, or rolling stock"';

const CANON_ENTRY = 'raw/2020-01-01--dalio-changing-world-order';

describe('the path grammar', () => {
  it('reads the tape’s evidence: an entry, its prose, and a span', () => {
    expect(resolveCitation({ grammar: 'path', source: TAPE_CITATION })).toEqual({
      slug: '2026-08-13--economist-free-exchange-yen-carry',
      file: 'prose',
      phrase: 'may have spent more than $95bn',
    });
  });

  it('reads an essay note that points at the figures twin', () => {
    expect(resolveCitation({ grammar: 'path', source: ESSAY_FIGURES })).toEqual({
      slug: '2026-06-30--burry-trading-post-jun-30',
      file: 'figures',
      phrase: '1998 Long Term Cap Mgmnt Collapse | Feb 1998 | 330 | +2% | Oct 1998 | 190 | −42% | 7.4',
    });
  });

  it('keeps a span that has quotes of its own', () => {
    // The closing quote is the last one, not the first: this is one span.
    const target = resolveCitation({ grammar: 'path', source: ESSAY_NESTED_QUOTES });
    expect(target?.phrase).toBe(
      'by 1890, 40% of railroad capitalization represented "water", or securities issued in excess of any investment in roadbed, rails, or rolling stock'
    );
  });

  it('reads an address with no span as the whole document', () => {
    expect(
      resolveCitation({ grammar: 'path', source: 'raw/2026-08-18--macro/2026-08-18--macro.md' })
    ).toEqual({ slug: '2026-08-18--macro', file: 'prose', phrase: null });
  });
});

describe('the phrase grammar', () => {
  it('reads a canon inline mark, curly quotes and all', () => {
    expect(
      resolveCitation({ grammar: 'phrase', entry: CANON_ENTRY, phrase: '“The Big Cycle”' })
    ).toEqual({
      slug: '2020-01-01--dalio-changing-world-order',
      file: 'prose',
      phrase: 'The Big Cycle',
    });
  });

  it('reads an unquoted footer citation as the span it is', () => {
    const phrase =
      '1) education, 2) competitiveness, 3) technology, 4) economic output, 5) share of world trade, 6) military strength, 7) financial center strength, and 8) reserve currency';
    expect(resolveCitation({ grammar: 'phrase', entry: CANON_ENTRY, phrase })?.phrase).toBe(phrase);
  });

  it('is unresolved when the lesson names no entry', () => {
    expect(resolveCitation({ grammar: 'phrase', entry: '', phrase: 'Introduction' })).toBeNull();
  });
});

describe('the slug grammar', () => {
  it('reads a chart entry as a whole document', () => {
    expect(resolveCitation({ grammar: 'slug', slug: '2026-06-10--lex-making-ai-pay-its-way' })).toEqual(
      { slug: '2026-06-10--lex-making-ai-pay-its-way', file: 'prose', phrase: null }
    );
  });

  it('is unresolved when there is no slug at all', () => {
    expect(resolveCitation({ grammar: 'slug', slug: '   ' })).toBeNull();
  });
});

// --- The address it becomes ------------------------------------------------

describe('the route', () => {
  it('round-trips a span, pipes and quotes included', () => {
    const target = resolveCitation({ grammar: 'path', source: ESSAY_FIGURES })!;
    expect(citationRoute(target)).toEqual([
      '2026-06-30--burry-trading-post-jun-30',
      'figures',
      target.phrase,
    ]);
    expect(routeTarget(citationRoute(target))).toEqual(target);
  });

  it('round-trips a whole-document citation as one segment', () => {
    const target = resolveCitation({ grammar: 'slug', slug: '2026-08-18--macro' })!;
    expect(citationRoute(target)).toEqual(['2026-08-18--macro']);
    expect(routeTarget(citationRoute(target))).toEqual(target);
  });

  it('keeps the figures file when there is no span to carry it', () => {
    const target = { slug: 'a-slug', file: 'figures' as const, phrase: null };
    expect(citationRoute(target)).toEqual(['a-slug', 'figures']);
    expect(routeTarget(citationRoute(target))).toEqual(target);
  });

  it('reads an address with nothing in it as no target, never a throw', () => {
    expect(routeTarget([])).toBeNull();
    expect(routeTarget([''])).toBeNull();
  });
});

// --- Making two runs of text comparable ------------------------------------

describe('normalizeForMatch', () => {
  it('folds the quotes a summary and a scrape disagree about', () => {
    expect(normalizeForMatch('Stripe’s purchase of OpenRouter')).toBe(
      normalizeForMatch("Stripe's purchase of OpenRouter")
    );
    expect(normalizeForMatch('“water”')).toBe(normalizeForMatch('"water"'));
  });

  it('folds the space a wrapped paragraph leaves behind', () => {
    expect(normalizeForMatch('the value of\n  troubled\tloans')).toBe('the value of troubled loans');
  });

  it('folds a non-breaking space, which NFKC turns into a plain one', () => {
    expect(normalizeForMatch('20\u00a0watts')).toBe('20 watts');
    expect(normalizeForMatch('20\u2009watts')).toBe('20 watts');
  });

  it('folds case, and nothing softer than that', () => {
    expect(normalizeForMatch('The DCM Starts')).toBe('the dcm starts');
    // Not a fuzzy match: a different word is a different span.
    expect(normalizeForMatch('capital cycle')).not.toBe(normalizeForMatch('capital cycles'));
  });
});

// --- Finding the span in a document ----------------------------------------

const DOCUMENT = parseMarkdown(
  [
    '---',
    'title: A source entry',
    '---',
    '',
    '# Our Measures of Wealth and Power',
    '',
    'The BoJ’s late-July yen defence',
    'may have spent more than $95bn of reserves.',
    '',
    '- it takes less time and money to copy than invent',
    '',
    '| Episode | Peak | Drawdown |',
    '|---|---|---|',
    '| 1998 Long Term Cap Mgmnt Collapse | Feb 1998 | −42% |',
  ].join('\n')
);

describe('findCitedBlock', () => {
  it('finds a span that a heading happens to be', () => {
    expect(findCitedBlock(DOCUMENT.blocks, 'Our Measures of Wealth and Power')).toBe(0);
  });

  it('finds a span the parser has already unwrapped across two source lines', () => {
    expect(findCitedBlock(DOCUMENT.blocks, 'yen defence may have spent more than $95bn')).toBe(1);
  });

  it('finds a span inside a list item', () => {
    expect(findCitedBlock(DOCUMENT.blocks, 'less time and money to copy')).toBe(2);
  });

  it('finds a table row, whose pipes the citation keeps', () => {
    expect(
      findCitedBlock(DOCUMENT.blocks, '1998 Long Term Cap Mgmnt Collapse | Feb 1998 | −42%')
    ).toBe(3);
  });

  it('says -1 rather than guessing when the document does not contain it', () => {
    expect(findCitedBlock(DOCUMENT.blocks, 'a sentence from another entry entirely')).toBe(-1);
    expect(findCitedBlock(DOCUMENT.blocks, '')).toBe(-1);
  });

  it('reads a rule as nothing at all', () => {
    expect(blockText({ kind: 'rule' })).toBe('');
  });
});
