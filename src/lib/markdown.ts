/**
 * The corpus's markdown, parsed to a tree.
 *
 * A small subset, because the corpus is machine-written and only uses a small
 * subset: frontmatter, headings, paragraphs, quotes, lists, rules, fenced
 * code, pipe tables, and inline emphasis, code, links, images, footnote marks
 * and citation marks. That is everything the entries, the figure reads and the
 * essays actually contain.
 *
 * Two deliberate properties.
 *
 * It is a character scanner, not a set of patterns. Markdown is a machine
 * format and could arguably be matched, but the house rule is that shipped
 * logic does not lean on patterns, and a scanner is also the only version of
 * this that stays honest when a document does something unexpected: an unknown
 * construct falls through to text rather than half-matching.
 *
 * And it produces a tree, never HTML. Nothing downstream is handed a string to
 * interpret, so HTML in the source — and the corpus is full of scraped page
 * chrome — renders as the characters it is. That is what "passthrough
 * disabled" means here: there is no passthrough to disable.
 */

/** How deep an ATX heading can go before the hashes are just text. */
const MAX_HEADING_LEVEL = 6;
const FENCE = '```';
const RULE = '---';

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; children: Inline[] }
  | { kind: 'em'; children: Inline[] }
  | { kind: 'code'; text: string }
  | { kind: 'link'; href: string; children: Inline[] }
  /** `[^12]` — resolved against the document's own footnote definitions. */
  | { kind: 'footnote'; label: string }
  /** `[§"heading"]` — the canon's inline source mark. */
  | { kind: 'cite'; label: string }
  /** An image reference. The repo has no image files; only the alt survives. */
  | { kind: 'figure'; alt: string };

export type Block =
  | { kind: 'heading'; level: number; children: Inline[] }
  | { kind: 'paragraph'; children: Inline[] }
  | { kind: 'quote'; children: Inline[] }
  | { kind: 'list'; ordered: boolean; items: Inline[][] }
  | { kind: 'rule' }
  | { kind: 'code'; text: string }
  | { kind: 'table'; header: Inline[][] | null; rows: Inline[][][] };

export interface Footnote {
  label: string;
  children: Inline[];
}

export interface MarkdownDoc {
  /** From the frontmatter, where there is one. The entries carry their real title there. */
  title: string | null;
  blocks: Block[];
  footnotes: Footnote[];
}

// ---------------------------------------------------------------------------
// Inline
// ---------------------------------------------------------------------------

export function parseInline(source: string): Inline[] {
  const nodes: Inline[] = [];
  let plain = '';
  let i = 0;

  const flush = () => {
    if (plain.length > 0) {
      nodes.push({ kind: 'text', text: plain });
      plain = '';
    }
  };

  while (i < source.length) {
    const char = source[i];

    if (char === '*' && source[i + 1] === '*') {
      const close = source.indexOf('**', i + 2);
      if (close !== -1 && close > i + 2) {
        flush();
        nodes.push({ kind: 'strong', children: parseInline(source.slice(i + 2, close)) });
        i = close + 2;
        continue;
      }
    }

    if (char === '*') {
      const close = source.indexOf('*', i + 1);
      if (close !== -1 && close > i + 1) {
        flush();
        nodes.push({ kind: 'em', children: parseInline(source.slice(i + 1, close)) });
        i = close + 1;
        continue;
      }
    }

    if (char === '`') {
      const close = source.indexOf('`', i + 1);
      if (close !== -1) {
        flush();
        nodes.push({ kind: 'code', text: source.slice(i + 1, close) });
        i = close + 1;
        continue;
      }
    }

    if (char === '!' && source[i + 1] === '[') {
      const alt = source.indexOf(']', i + 2);
      if (alt !== -1 && source[alt + 1] === '(') {
        const end = source.indexOf(')', alt + 2);
        if (end !== -1) {
          flush();
          nodes.push({ kind: 'figure', alt: source.slice(i + 2, alt) });
          i = end + 1;
          continue;
        }
      }
    }

    if (char === '[') {
      const close = source.indexOf(']', i + 1);
      if (close !== -1) {
        if (source[i + 1] === '^') {
          flush();
          nodes.push({ kind: 'footnote', label: source.slice(i + 2, close) });
          i = close + 1;
          continue;
        }
        if (source[i + 1] === '§') {
          flush();
          nodes.push({ kind: 'cite', label: source.slice(i + 2, close).trim() });
          i = close + 1;
          continue;
        }
        if (source[close + 1] === '(') {
          const end = source.indexOf(')', close + 2);
          if (end !== -1) {
            flush();
            nodes.push({
              kind: 'link',
              href: source.slice(close + 2, end),
              children: parseInline(source.slice(i + 1, close)),
            });
            i = end + 1;
            continue;
          }
        }
      }
    }

    plain += char;
    i += 1;
  }

  flush();
  return nodes;
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

function headingLevel(line: string): number {
  let level = 0;
  while (level < line.length && line[level] === '#') level += 1;
  if (level === 0 || level > MAX_HEADING_LEVEL) return 0;
  return line[level] === ' ' ? level : 0;
}

function listMarker(line: string): { ordered: boolean; content: string } | null {
  if (line.startsWith('- ') || line.startsWith('* ')) {
    return { ordered: false, content: line.slice(2) };
  }
  let digits = 0;
  while (digits < line.length && line[digits] >= '0' && line[digits] <= '9') digits += 1;
  if (digits > 0 && line[digits] === '.' && line[digits + 1] === ' ') {
    return { ordered: true, content: line.slice(digits + 2) };
  }
  return null;
}

/** `[^12]: raw/… §"…"` at the start of a line. */
function footnoteDefinition(line: string): Footnote | null {
  if (!line.startsWith('[^')) return null;
  const close = line.indexOf(']: ', 2);
  if (close === -1) return null;
  return { label: line.slice(2, close), children: parseInline(line.slice(close + 3)) };
}

function isRule(line: string): boolean {
  if (line.length < 3) return false;
  for (const char of line) if (char !== '-') return false;
  return true;
}

/** `|---|:--:|` — the row that turns the line above it into a header. */
function isDelimiterRow(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) return false;
  let sawDash = false;
  for (const char of trimmed) {
    if (char === '-') sawDash = true;
    else if (char !== '|' && char !== ':' && char !== ' ') return false;
  }
  return sawDash;
}

function splitRow(line: string): Inline[][] {
  let body = line.trim();
  if (body.startsWith('|')) body = body.slice(1);
  if (body.endsWith('|')) body = body.slice(0, -1);
  return body.split('|').map(cell => parseInline(cell.trim()));
}

function startsBlock(line: string): boolean {
  return (
    line.length === 0 ||
    headingLevel(line) > 0 ||
    line.startsWith('> ') ||
    line.startsWith(FENCE) ||
    line.trim().startsWith('|') ||
    isRule(line) ||
    listMarker(line) !== null
  );
}

/**
 * The frontmatter's title, and nothing else from it.
 *
 * A key is a line that starts in the first column and carries `: `; a line
 * that starts with a space continues the key above it, which is how a long
 * title arrives wrapped. Quotes around the value are the emitter's, not the
 * title's.
 */
function frontmatterTitle(lines: readonly string[]): string | null {
  let title: string | null = null;
  for (const line of lines) {
    if (line.startsWith(' ') || line.startsWith('\t')) {
      if (title !== null) title = `${title} ${line.trim()}`;
      continue;
    }
    if (title !== null) break;
    const cut = line.indexOf(': ');
    if (cut === -1) continue;
    if (line.slice(0, cut) === 'title') title = line.slice(cut + 2).trim();
  }
  if (title === null) return null;
  const quote = title[0];
  if ((quote === '"' || quote === "'") && title.endsWith(quote) && title.length > 1) {
    return title.slice(1, -1);
  }
  return title;
}

export function parseMarkdown(source: string): MarkdownDoc {
  const lines = source.split('\n').map(line => (line.endsWith('\r') ? line.slice(0, -1) : line));
  const blocks: Block[] = [];
  const footnotes: Footnote[] = [];
  let title: string | null = null;
  let i = 0;

  if (lines[0] === RULE) {
    let end = 1;
    while (end < lines.length && lines[end] !== RULE) end += 1;
    title = frontmatterTitle(lines.slice(1, end));
    i = end < lines.length ? end + 1 : lines.length;
  }

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim().length === 0) {
      i += 1;
      continue;
    }

    const note = footnoteDefinition(line);
    if (note) {
      footnotes.push(note);
      i += 1;
      continue;
    }

    if (line.startsWith(FENCE)) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith(FENCE)) {
        body.push(lines[i]);
        i += 1;
      }
      // An unclosed fence runs to the end of the document rather than throwing.
      if (i < lines.length) i += 1;
      blocks.push({ kind: 'code', text: body.join('\n') });
      continue;
    }

    const level = headingLevel(line);
    if (level > 0) {
      blocks.push({ kind: 'heading', level, children: parseInline(line.slice(level + 1).trim()) });
      i += 1;
      continue;
    }

    if (isRule(line)) {
      blocks.push({ kind: 'rule' });
      i += 1;
      continue;
    }

    if (line.trim().startsWith('|')) {
      const rows: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(lines[i]);
        i += 1;
      }
      const headed = rows.length > 1 && isDelimiterRow(rows[1]);
      const body = headed ? rows.slice(2) : rows.filter(row => !isDelimiterRow(row));
      blocks.push({
        kind: 'table',
        header: headed ? splitRow(rows[0]) : null,
        rows: body.map(splitRow),
      });
      continue;
    }

    if (line.startsWith('> ') || line === '>') {
      const quoted: string[] = [];
      while (i < lines.length && (lines[i].startsWith('> ') || lines[i] === '>')) {
        quoted.push(lines[i].slice(1).trim());
        i += 1;
      }
      blocks.push({ kind: 'quote', children: parseInline(quoted.join(' ').trim()) });
      continue;
    }

    const marker = listMarker(line);
    if (marker) {
      const items: Inline[][] = [];
      const ordered = marker.ordered;
      while (i < lines.length) {
        const next = listMarker(lines[i]);
        if (!next || next.ordered !== ordered) break;
        items.push(parseInline(next.content));
        i += 1;
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }

    const paragraph: string[] = [];
    while (i < lines.length && !startsBlock(lines[i]) && !footnoteDefinition(lines[i])) {
      paragraph.push(lines[i].trim());
      i += 1;
    }
    blocks.push({ kind: 'paragraph', children: parseInline(paragraph.join(' ')) });
  }

  return { title, blocks, footnotes };
}

/** The plain text of an inline run — what a heading says, with its marks gone. */
export function inlineText(nodes: readonly Inline[]): string {
  let text = '';
  for (const node of nodes) {
    switch (node.kind) {
      case 'text':
      case 'code':
        text += node.text;
        break;
      case 'strong':
      case 'em':
      case 'link':
        text += inlineText(node.children);
        break;
      case 'cite':
      case 'footnote':
      case 'figure':
        break;
    }
  }
  return text;
}

/**
 * The document's blocks with its own title heading dropped, where it repeats
 * the frontmatter title the surface has already put at the top. Printing the
 * same line twice is the sort of thing that reads as a bug.
 */
export function bodyBlocks(doc: MarkdownDoc): Block[] {
  const [first] = doc.blocks;
  if (
    doc.title !== null &&
    first !== undefined &&
    first.kind === 'heading' &&
    inlineText(first.children) === doc.title
  ) {
    return doc.blocks.slice(1);
  }
  return doc.blocks;
}
