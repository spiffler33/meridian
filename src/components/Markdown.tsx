/**
 * The markdown tree, drawn.
 *
 * Nothing here is handed a string to interpret — every node arrives as data
 * from markdown.ts and leaves as an element. The corpus is full of scraped
 * page chrome, so a document that contains markup renders those characters
 * rather than acting on them, by construction rather than by sanitising.
 */

import { Cite } from './readUi';
import type { Block, Inline } from '../lib/markdown';

const HEADING_CLASS: Record<number, string> = {
  1: 'mt-6 font-read text-[18px] font-bold leading-[1.35] text-sp-ink',
  2: 'mt-5 font-read text-[16px] font-bold leading-[1.4] text-sp-ink',
  3: 'mt-4 font-read text-[15px] font-semibold leading-[1.4] text-sp-ink',
};

function headingClass(level: number): string {
  return HEADING_CLASS[level] ?? 'mt-4 font-read text-[14px] font-semibold text-sp-muted';
}

function Nodes({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((node, index) => {
        switch (node.kind) {
          case 'text':
            return <span key={index}>{node.text}</span>;
          case 'strong':
            return (
              <strong key={index} className="font-semibold text-sp-ink">
                <Nodes nodes={node.children} />
              </strong>
            );
          case 'em':
            return (
              <em key={index}>
                <Nodes nodes={node.children} />
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
                <Nodes nodes={node.children} />
              </a>
            );
          case 'footnote':
            // Inert this phase; phase 4 resolves it into the source prose.
            return (
              <sup key={index} className="font-mono text-[10px] text-sp-ice">
                {node.label}
              </sup>
            );
          case 'cite':
            return <Cite key={index}>§{node.label}</Cite>;
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

function Cell({ nodes, head }: { nodes: Inline[]; head: boolean }) {
  const Tag = head ? 'th' : 'td';
  return (
    <Tag
      className={`border border-sp-hair px-2 py-1 text-left align-top font-mono text-[11px] ${
        head ? 'text-sp-muted' : 'text-sp-ink'
      }`}
    >
      <Nodes nodes={nodes} />
    </Tag>
  );
}

export function Markdown({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((block, index) => {
        switch (block.kind) {
          case 'heading':
            return (
              <h3 key={index} className={headingClass(block.level)}>
                <Nodes nodes={block.children} />
              </h3>
            );
          case 'paragraph':
            return (
              <p key={index} className="prose-read mt-3 text-sp-ink">
                <Nodes nodes={block.children} />
              </p>
            );
          case 'quote':
            return (
              <blockquote
                key={index}
                className="prose-read mt-3 border-l border-sp-hair pl-3 italic text-sp-muted"
              >
                <Nodes nodes={block.children} />
              </blockquote>
            );
          case 'list':
            return block.ordered ? (
              <ol key={index} className="prose-read mt-3 list-decimal pl-5 marker:text-sp-faint">
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex} className="mt-1">
                    <Nodes nodes={item} />
                  </li>
                ))}
              </ol>
            ) : (
              <ul key={index} className="prose-read mt-3 list-disc pl-5 marker:text-sp-faint">
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex} className="mt-1">
                    <Nodes nodes={item} />
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
                className="mt-3 overflow-x-auto rounded bg-sp-panel2 p-3 font-mono text-[11px] text-sp-ink"
              >
                {block.text}
              </pre>
            );
          case 'table':
            // Wide tables scroll in their own box; the page never does.
            return (
              <div key={index} className="mt-3 overflow-x-auto">
                <table className="border-collapse">
                  {block.header && (
                    <thead>
                      <tr>
                        {block.header.map((cell, cellIndex) => (
                          <Cell key={cellIndex} nodes={cell} head />
                        ))}
                      </tr>
                    </thead>
                  )}
                  <tbody>
                    {block.rows.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {row.map((cell, cellIndex) => (
                          <Cell key={cellIndex} nodes={cell} head={false} />
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
