/**
 * Citations, resolved.
 *
 * Every claim on every surface carries a source mark, and the whole point of
 * this pane over the email edition is that the mark is a tap rather than a
 * footnote nobody can follow. This module is the one place that turns a mark
 * into somewhere to go.
 *
 * Three grammars arrive from the corpus and one target leaves. The caller
 * always knows which grammar it is holding — a chart's `entries[]` is a list
 * of slugs, a canon lesson's `citations[]` is a list of phrases into that
 * lesson's own entry — so the grammar is named at the call rather than
 * guessed from the string. Guessing is what makes a resolver quietly wrong
 * on the one citation that reads like the other kind.
 *
 * The § target is a **span of text**, not a heading. The corpus quotes
 * sentences ("may have spent more than $95bn"), table rows, and sometimes a
 * heading — all of them are just runs of characters in the source document,
 * so all of them are found the same way: normalise, then look for the span.
 * Measured against the whole corpus, all 738 citations land.
 */

import { inlineText, type Block } from './markdown';

/** Which file inside an entry's directory the citation points into. */
export type SourceFile = 'prose' | 'figures';

export interface CitationTarget {
  /** The entry directory's name, which is also the prose file's name. */
  slug: string;
  file: SourceFile;
  /** The span to open at, where the citation names one. */
  phrase: string | null;
}

/**
 * The three shapes the corpus actually commits.
 *
 * - `path` — tape evidence and essay footnote definitions:
 *   `raw/<slug>/<slug>.md §"a quoted span"`, sometimes `figures.md`.
 * - `phrase` — the canon's inline `[§“…”]` marks and its `citations[]`
 *   footer, which name a span but no document: the document is the lesson's
 *   own `entry`.
 * - `slug` — a chart's `entries[]`, which name a document but no span.
 */
export type Citation =
  | { grammar: 'path'; source: string }
  | { grammar: 'phrase'; entry: string; phrase: string }
  | { grammar: 'slug'; slug: string };

const RAW_PREFIX = 'raw/';
const FIGURES_FILE = 'figures.md';
const SECTION = '§';

/** Straight and curly, because the tape writes one and the canon the other. */
const CLOSING_QUOTE: Record<string, string> = { '"': '"', '“': '”' };

/** Typography NFKC leaves alone. A scrape and a summary rarely agree on these. */
const QUOTE_FOLD: Record<string, string> = {
  '“': '"',
  '”': '"',
  '‘': "'",
  '’': "'",
  '′': "'",
  '″': '"',
};

/**
 * `raw/<slug>/<file>` → where that is. A bare slug is an address too: the
 * charts list their sources that way. Anything with no first segment at all
 * is not an address, and the caller's fallback gets its turn.
 */
function parseAddress(address: string): { slug: string; file: SourceFile } | null {
  const trimmed = address.trim();
  const body = trimmed.startsWith(RAW_PREFIX) ? trimmed.slice(RAW_PREFIX.length) : trimmed;
  const segments = body.split('/').filter(Boolean);
  const slug = segments[0];
  if (slug === undefined) return null;
  return { slug, file: segments[1] === FIGURES_FILE ? 'figures' : 'prose' };
}

/**
 * The span a `§` names.
 *
 * The closing quote is the **last** one in the run, not the first: the corpus
 * quotes prose, and prose contains quotes — `§"40% of railroad capitalization
 * represented "water", or securities issued in excess"` is one span, not
 * three. An unquoted remainder is taken whole; that is what the canon's
 * `citations[]` entries are.
 */
function parsePhrase(source: string): string | null {
  const body = source.trim();
  const opener = body[0];
  if (opener === undefined) return null;

  const closer = CLOSING_QUOTE[opener];
  if (closer === undefined) return body;

  const end = body.lastIndexOf(closer);
  const phrase = (end > 0 ? body.slice(1, end) : body.slice(1)).trim();
  return phrase.length > 0 ? phrase : null;
}

/** One resolver. Three grammars in, one target out — or null, never a throw. */
export function resolveCitation(citation: Citation): CitationTarget | null {
  if (citation.grammar === 'slug') {
    const place = parseAddress(citation.slug);
    return place === null ? null : { ...place, phrase: null };
  }

  if (citation.grammar === 'phrase') {
    const place = parseAddress(citation.entry);
    return place === null ? null : { ...place, phrase: parsePhrase(citation.phrase) };
  }

  const mark = citation.source.indexOf(SECTION);
  const place = parseAddress(mark === -1 ? citation.source : citation.source.slice(0, mark));
  if (place === null) return null;
  return {
    ...place,
    phrase: mark === -1 ? null : parsePhrase(citation.source.slice(mark + SECTION.length)),
  };
}

// ---------------------------------------------------------------------------
// The route
// ---------------------------------------------------------------------------

/**
 * A target as the Read view's item path: `#/read/raw/<slug>[/<file>[/<span>]]`.
 *
 * Positional and fixed in meaning, so the reader never has to work out which
 * segment it is looking at. The span rides in the address rather than in some
 * side channel, which is what makes a citation shareable, reloadable, and
 * survivable across a back button.
 */
export function citationRoute(target: CitationTarget): string[] {
  if (target.phrase !== null) return [target.slug, target.file, target.phrase];
  return target.file === 'figures' ? [target.slug, target.file] : [target.slug];
}

/** The same address, read back. An item path is user input; nothing throws. */
export function routeTarget(item: readonly string[]): CitationTarget | null {
  const slug = item[0];
  if (slug === undefined || slug.length === 0) return null;
  const phrase = item[2];
  return {
    slug,
    file: item[1] === 'figures' ? 'figures' : 'prose',
    phrase: phrase !== undefined && phrase.length > 0 ? phrase : null,
  };
}

// ---------------------------------------------------------------------------
// Finding the span
// ---------------------------------------------------------------------------

function isSpace(char: string): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\f';
}

/**
 * Two runs of text, made comparable.
 *
 * NFKC first, which folds the typographic variants a scrape leaves behind —
 * non-breaking and thin spaces, ligatures, full-width digits — then the curly
 * quotes NFKC leaves alone (the tape writes `'` where the source has `’`),
 * then whitespace runs to one space, because the parser joins a wrapped
 * paragraph's lines, then case.
 *
 * That is a character-level equivalence table and nothing more: no stemming,
 * no fuzzy distance, no rules about what a sentence looks like. A span either
 * is in the document or it is not, and if it is not the reader says so.
 */
export function normalizeForMatch(text: string): string {
  const folded = text.normalize('NFKC');
  let out = '';
  let space = false;
  for (const char of folded) {
    if (isSpace(char)) {
      space = out.length > 0;
      continue;
    }
    if (space) {
      out += ' ';
      space = false;
    }
    out += QUOTE_FOLD[char] ?? char;
  }
  return out.toLowerCase();
}

/** What a block says, with its marks gone — a table's row keeps its pipes. */
export function blockText(block: Block): string {
  switch (block.kind) {
    case 'heading':
    case 'paragraph':
    case 'quote':
      return inlineText(block.children);
    case 'list':
      return block.items.map(inlineText).join(' ');
    case 'code':
      return block.text;
    case 'table': {
      const rows = block.header === null ? block.rows : [block.header, ...block.rows];
      return rows.map(row => row.map(inlineText).join(' | ')).join(' ');
    }
    case 'rule':
      return '';
  }
}

/**
 * Which block carries the span, or -1. First match wins: a phrase repeated in
 * a document is cited once, and the first occurrence is the one the reader
 * scrolling from the top would have reached anyway.
 */
export function findCitedBlock(blocks: readonly Block[], phrase: string): number {
  const wanted = normalizeForMatch(phrase);
  if (wanted.length === 0) return -1;
  for (let index = 0; index < blocks.length; index += 1) {
    if (normalizeForMatch(blockText(blocks[index])).includes(wanted)) return index;
  }
  return -1;
}
