/**
 * The markdown subset.
 *
 * What matters here is what the corpus actually contains: frontmatter that
 * carries the only real title an entry has, footnote definitions that are the
 * essays' citation strip, pipe tables that are the whole content of a figure
 * read, and the canon's inline source marks. Plus the property the renderer
 * depends on — a document that contains markup produces text, not markup,
 * because the parser never emits anything to be interpreted.
 */

import { describe, expect, it } from 'vitest';

import { bodyBlocks, inlineText, parseInline, parseMarkdown } from './markdown';

describe('frontmatter', () => {
  it('takes the title and leaves the rest', () => {
    const doc = parseMarkdown(
      ['---', "date: '2026-08-21'", 'title: Asia’s rising riches', 'tags:', '- ft', '---', '', 'Body.'].join('\n')
    );

    expect(doc.title).toBe('Asia’s rising riches');
    expect(doc.blocks).toHaveLength(1);
  });

  it('joins a title that wrapped onto the next line', () => {
    const doc = parseMarkdown(['---', 'title: A long title that', '  wrapped in the emitter', '---'].join('\n'));
    expect(doc.title).toBe('A long title that wrapped in the emitter');
  });

  it('drops the quotes the emitter added, not the ones the title has', () => {
    expect(parseMarkdown(['---', "title: '2026 in review'", '---'].join('\n')).title).toBe(
      '2026 in review'
    );
  });

  it('has no title where there is no frontmatter', () => {
    expect(parseMarkdown('# Figures\n\nprose').title).toBeNull();
  });
});

describe('blocks', () => {
  it('reads headings, quotes, lists and rules', () => {
    const doc = parseMarkdown(
      ['## The serial', '', 'A paragraph', 'that wrapped.', '', '> A quotation.', '', '- one', '- two', '', '---'].join('\n')
    );

    expect(doc.blocks.map(block => block.kind)).toEqual([
      'heading',
      'paragraph',
      'quote',
      'list',
      'rule',
    ]);
    const paragraph = doc.blocks[1];
    expect(paragraph.kind === 'paragraph' && inlineText(paragraph.children)).toBe(
      'A paragraph that wrapped.'
    );
  });

  it('reads a pipe table with its header', () => {
    const doc = parseMarkdown(
      ['| Year | Level |', '|------|-------|', '| 1998 | 330 |', '| 2000 | 190 |'].join('\n')
    );

    const table = doc.blocks[0];
    expect(table.kind).toBe('table');
    if (table.kind !== 'table') return;
    expect(table.header?.map(inlineText)).toEqual(['Year', 'Level']);
    expect(table.rows).toHaveLength(2);
    expect(table.rows[1].map(inlineText)).toEqual(['2000', '190']);
  });

  it('reads a fenced block as text, not as markdown', () => {
    const doc = parseMarkdown(['```', '# not a heading', '```'].join('\n'));
    expect(doc.blocks[0]).toEqual({ kind: 'code', text: '# not a heading' });
  });

  it('runs an unclosed fence to the end rather than throwing', () => {
    expect(() => parseMarkdown('```\nstill open')).not.toThrow();
  });

  it('drops a leading heading that only repeats the frontmatter title', () => {
    const doc = parseMarkdown(['---', 'title: The Profit Is the Wire', '---', '', '# The Profit Is the Wire', '', 'Body.'].join('\n'));

    expect(doc.blocks[0].kind).toBe('heading');
    expect(bodyBlocks(doc).map(block => block.kind)).toEqual(['paragraph']);
  });
});

describe('footnotes', () => {
  it('collects the definitions into a strip and leaves the marks in the prose', () => {
    const doc = parseMarkdown(
      [
        'Burry mailed out a trade log.[^1]',
        '',
        '[^1]: raw/2026-06-30--burry/2026-06-30--burry.md §"a historically high extension"',
      ].join('\n')
    );

    expect(doc.blocks).toHaveLength(1);
    expect(doc.footnotes).toHaveLength(1);
    expect(doc.footnotes[0].label).toBe('1');
    expect(inlineText(doc.footnotes[0].children)).toContain('§"a historically high extension"');

    const marks = parseInline('Burry mailed out a trade log.[^1]');
    expect(marks[1]).toEqual({ kind: 'footnote', label: '1' });
  });
});

describe('inline', () => {
  it('reads the canon’s source mark as a citation', () => {
    const nodes = parseInline('plus the walkway’s [§“An Incredible Tailwind”]. That image');
    expect(nodes[1]).toEqual({ kind: 'cite', label: '§“An Incredible Tailwind”'.slice(1) });
  });

  it('reads emphasis, code and links', () => {
    const nodes = parseInline('**bold** and *thin* and `code` and [text](https://ft.com)');
    expect(nodes.map(node => node.kind)).toEqual([
      'strong',
      'text',
      'em',
      'text',
      'code',
      'text',
      'link',
    ]);
  });

  it('keeps a lone asterisk as an asterisk', () => {
    expect(parseInline('2 * 3 = 6')).toEqual([{ kind: 'text', text: '2 * 3 = 6' }]);
  });

  it('keeps an image as a marker — the repo has no image files', () => {
    const nodes = parseInline('![](2026-08-21_images/page-0001.png)');
    expect(nodes).toEqual([{ kind: 'figure', alt: '' }]);
  });

  it('produces text, never markup, from a document full of page chrome', () => {
    const nodes = parseInline('<script>alert(1)</script> **and** <b>bold</b>');
    const rendered = nodes.map(node => (node.kind === 'text' ? node.text : node.kind));
    expect(rendered).toContain('<script>alert(1)</script> ');
    expect(rendered).toContain('strong');
  });
});
