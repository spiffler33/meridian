/**
 * The markdown tree, drawn.
 *
 * Nothing here is handed a string to interpret — every node arrives as data
 * from markdown.ts and leaves as an element. The corpus is full of scraped
 * page chrome, so a document that contains markup renders those characters
 * rather than acting on them, by construction rather than by sanitising.
 *
 * The two source marks a document can carry — `[§"…"]` and `[^n]` — are live
 * when the caller says where they point, and inert characters when it does
 * not. That is one prop, not a mode: the renderer never guesses which
 * document it is inside.
 */

import { useEffect, useRef, useState } from 'react';

import { Cite } from './readUi';
import { resolveCitation, type CitationTarget } from '../lib/citations';
import type { Block, Inline } from '../lib/markdown';

/**
 * Where this document's inline marks point.
 *
 * `entry` answers the canon's marks, which name a span but no document — the
 * document is the lesson's own source. `footnotes` answers an essay's, whose
 * definitions sit at the foot of the same file and carry the whole address.
 */
export interface CiteLinks {
  entry?: string | null;
  footnotes?: Map<string, string>;
  /** The library's one-line gist for a slug, where it has one. */
  gist?: (slug: string) => string | null;
  onOpen: (target: CitationTarget) => void;
}

const HEADING_CLASS: Record<number, string> = {
  1: 'mt-6 font-read text-[18px] font-bold leading-[1.35] text-sp-ink',
  2: 'mt-5 font-read text-[16px] font-bold leading-[1.4] text-sp-ink',
  3: 'mt-4 font-read text-[15px] font-semibold leading-[1.4] text-sp-ink',
};

function headingClass(level: number): string {
  return HEADING_CLASS[level] ?? 'mt-4 font-read text-[14px] font-semibold text-sp-muted';
}

function Nodes({ nodes, links }: { nodes: Inline[]; links?: CiteLinks }) {
  return (
    <>
      {nodes.map((node, index) => {
        switch (node.kind) {
          case 'text':
            return <span key={index}>{node.text}</span>;
          case 'strong':
            return (
              <strong key={index} className="font-semibold text-sp-ink">
                <Nodes nodes={node.children} links={links} />
              </strong>
            );
          case 'em':
            return (
              <em key={index}>
                <Nodes nodes={node.children} links={links} />
              </em>
            );
          case 'code':
            return (
              <code key={index} className="rounded bg-sp-panel2 px-1 font-mono text-[13px]">
                {node.text}
              </code>
            );
          case 'link':
            return (
              <a
                key={index}
                href={node.href}
                target="_blank"
                rel="noreferrer noopener"
                className="text-sp-ice underline underline-offset-2"
              >
                <Nodes nodes={node.children} links={links} />
              </a>
            );
          case 'footnote':
            return <FootnoteMark key={index} label={node.label} links={links} />;
          case 'cite':
            return <CiteMark key={index} label={node.label} links={links} />;
          case 'figure':
            // The image files are gitignored and were never pushed. What the
            // figure showed is read out in the entry's figures.md instead.
            return (
              <span key={index} className="font-mono text-[10px] text-sp-faint">
                [figure{node.alt ? ` · ${node.alt}` : ''}]
              </span>
            );
        }
      })}
    </>
  );
}

/**
 * A `[§"…"]` mark. The canon writes these into its prose; they name a span in
 * the lesson's own source entry, which is what `links.entry` supplies.
 */
function CiteMark({ label, links }: { label: string; links?: CiteLinks }) {
  const target =
    links?.entry == null
      ? null
      : resolveCitation({ grammar: 'phrase', entry: links.entry, phrase: label });
  if (target === null || links === undefined) return <Cite title={label}>§{label}</Cite>;
  return (
    <Cite title={`${target.slug}${target.phrase ? ` §${target.phrase}` : ''}`} onClick={() => links.onOpen(target)}>
      §{label}
    </Cite>
  );
}

/**
 * A `[^n]` mark: the popover first, the source second.
 *
 * The marker is a few pixels wide and the thing it points at is a document —
 * so the tap in between says which document, in one line, before committing
 * the reader to leaving the essay. Tapping outside closes it, because on a
 * phone the marker is too small to have to find again.
 */
function FootnoteMark({ label, links }: { label: string; links?: CiteLinks }) {
  const [open, setOpen] = useState(false);
  const holder = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: Event) => {
      if (!holder.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);

  const definition = links?.footnotes?.get(label);
  const target =
    definition === undefined ? null : resolveCitation({ grammar: 'path', source: definition });

  if (target === null || links === undefined) {
    return <sup className="font-mono text-[10px] text-sp-faint">{label}</sup>;
  }

  const gist = links.gist?.(target.slug) ?? null;

  return (
    <span ref={holder} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen(was => !was)}
        aria-expanded={open}
        aria-label={`Source for note ${label}`}
        className="align-super font-mono text-[10px] text-sp-ice"
      >
        [{label}]
      </button>
      {open && (
        <span className="absolute left-0 top-full z-20 mt-1 block w-[min(22rem,74vw)] rounded border border-sp-rim bg-sp-panel2 p-[10px] text-left shadow-lg">
          <span className="block break-all font-mono text-[10px] text-sp-ice">{target.slug}</span>
          {gist && (
            <span className="mt-[6px] block font-read text-[13px] leading-[1.45] text-sp-muted">
              {gist}
            </span>
          )}
          {target.phrase && (
            <span className="mt-[6px] block font-mono text-[10.5px] leading-[1.5] text-sp-faint">
              §{target.phrase}
            </span>
          )}
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              links.onOpen(target);
            }}
            className="mt-[10px] block font-mono text-[10.5px] text-sp-amber"
          >
            open source →
          </button>
        </span>
      )}
    </span>
  );
}

function Cell({ nodes, head, links }: { nodes: Inline[]; head: boolean; links?: CiteLinks }) {
  const Tag = head ? 'th' : 'td';
  return (
    <Tag
      className={`border border-sp-hair px-2 py-1 text-left align-top font-mono text-[11px] ${
        head ? 'text-sp-muted' : 'text-sp-ink'
      }`}
    >
      <Nodes nodes={nodes} links={links} />
    </Tag>
  );
}

/**
 * A block that a citation landed on, flagged so the reader can be scrolled to
 * it and see it lit. The index is the caller's, taken over the same array it
 * passed in, so nothing here has to know what was searched for.
 */
function landing(
  index: number,
  mark: number | null | undefined,
  base: string
): { className: string; 'data-cite-mark'?: string } {
  return index === mark ? { className: `${base} cite-mark`, 'data-cite-mark': '' } : { className: base };
}

export function Markdown({
  blocks,
  links,
  mark,
}: {
  blocks: Block[];
  links?: CiteLinks;
  mark?: number | null;
}) {
  return (
    <>
      {blocks.map((block, index) => {
        switch (block.kind) {
          case 'heading':
            return (
              <h3 key={index} {...landing(index, mark, headingClass(block.level))}>
                <Nodes nodes={block.children} links={links} />
              </h3>
            );
          case 'paragraph':
            return (
              <p key={index} {...landing(index, mark, 'prose-read mt-3 text-sp-ink')}>
                <Nodes nodes={block.children} links={links} />
              </p>
            );
          case 'quote':
            return (
              <blockquote
                key={index}
                {...landing(
                  index,
                  mark,
                  'prose-read mt-3 border-l border-sp-hair pl-3 italic text-sp-muted'
                )}
              >
                <Nodes nodes={block.children} links={links} />
              </blockquote>
            );
          case 'list':
            return block.ordered ? (
              <ol
                key={index}
                {...landing(index, mark, 'prose-read mt-3 list-decimal pl-5 marker:text-sp-faint')}
              >
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex} className="mt-1">
                    <Nodes nodes={item} links={links} />
                  </li>
                ))}
              </ol>
            ) : (
              <ul
                key={index}
                {...landing(index, mark, 'prose-read mt-3 list-disc pl-5 marker:text-sp-faint')}
              >
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex} className="mt-1">
                    <Nodes nodes={item} links={links} />
                  </li>
                ))}
              </ul>
            );
          case 'rule':
            return <hr key={index} className="my-5 border-sp-hair" />;
          case 'code':
            return (
              <pre
                key={index}
                {...landing(
                  index,
                  mark,
                  'mt-3 overflow-x-auto rounded bg-sp-panel2 p-3 font-mono text-[11px] text-sp-ink'
                )}
              >
                {block.text}
              </pre>
            );
          case 'table':
            // Wide tables scroll in their own box; the page never does.
            return (
              <div key={index} {...landing(index, mark, 'mt-3 overflow-x-auto')}>
                <table className="border-collapse">
                  {block.header && (
                    <thead>
                      <tr>
                        {block.header.map((cell, cellIndex) => (
                          <Cell key={cellIndex} nodes={cell} head links={links} />
                        ))}
                      </tr>
                    </thead>
                  )}
                  <tbody>
                    {block.rows.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {row.map((cell, cellIndex) => (
                          <Cell key={cellIndex} nodes={cell} head={false} links={links} />
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
        }
      })}
    </>
  );
}
