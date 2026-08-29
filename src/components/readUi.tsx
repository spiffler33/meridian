import { useState } from 'react';

import type { ReadableItem } from '../lib/readState';

/**
 * The reading pane's shared furniture.
 *
 * Small pieces, in one place because five surfaces draw the same card, the
 * same kicker and the same source line, and the surfaces should differ in what
 * they say rather than in how they look.
 */

export function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-4 rounded border border-border bg-bg-card px-4 pb-4 pt-4">
      {children}
    </div>
  );
}

export function Kicker({ children, tone }: { children: React.ReactNode; tone?: 'ice' }) {
  return (
    <div
      className={`mb-2 text-2xs uppercase tracking-label ${
        tone === 'ice' ? 'text-cite' : 'text-accent'
      }`}
    >
      {children}
    </div>
  );
}

export function Headline({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-read text-lg font-bold tracking-[-0.01em] text-text">
      {children}
    </h2>
  );
}

/**
 * The name of a section inside a card — "why it's interesting", "table talk".
 *
 * The published edition sets these as headings. Here they are instrument type
 * rather than reading type on purpose: they label the prose, they are not part
 * of it, and a serif heading every two paragraphs would make one chart read as
 * four documents.
 */
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5 mt-5 text-2xs uppercase tracking-label text-text-muted">
      {children}
    </div>
  );
}

/**
 * A link out of the corpus.
 *
 * Opens in the browser rather than in this window: on the phone this app is a
 * home-screen PWA with no address bar, so a same-window navigation to a
 * publication strands the owner outside the app with no way back.
 */
export function OutLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-cite underline underline-offset-2"
    >
      {children}
    </a>
  );
}

export function SrcLine({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3.5 border-t border-border pt-3 text-2xs leading-relaxed text-text-muted">
      {children}
    </div>
  );
}

export function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-2.5 font-read text-sm italic text-text-secondary">{children}</p>
  );
}

/**
 * A citation.
 *
 * Live wherever the mark could be placed: tapping it opens the source prose at
 * the span it names. Inert — a plain span — where the corpus gave a mark this
 * app cannot resolve, because a mark that is visibly just a mark is a better
 * answer than a button that goes nowhere.
 *
 * The label elides rather than wraps or overflows. Some of what the corpus
 * cites is a whole clause; the chip says as much of it as the column has room
 * for and carries the rest in its title, and the footer says all of it.
 */
const CITE_SHAPE =
  'mx-px inline-block truncate rounded border border-cite-rim px-2 pb-0.5 pt-px align-[-0.2em] font-mono text-2xs text-cite';

/** Inline it yields to the sentence; on its own line it takes the column. */
const CITE_WIDTH = { inline: 'max-w-[24ch] sm:max-w-[52ch]', wide: 'max-w-full' };

export function Cite({
  children,
  onClick,
  title,
  wide,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  title?: string;
  wide?: boolean;
}) {
  const shape = `${CITE_SHAPE} ${wide ? CITE_WIDTH.wide : CITE_WIDTH.inline}`;
  if (!onClick) {
    return (
      <span className={shape} title={title}>
        {children}
      </span>
    );
  }
  return (
    <button type="button" onClick={onClick} title={title} className={`${shape} hover:border-cite`}>
      {children}
    </button>
  );
}

/**
 * One hairline of explanation above the thing it is about. Not an error — the
 * document is right there — but not silence either: a reader who asked to land
 * on a sentence and landed at the top is owed the reason.
 */
export function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-3 border-l border-cite-rim pl-2 text-2xs leading-relaxed text-text-muted">
      {children}
    </div>
  );
}

/** Inline, quiet, and gone the moment the answer arrives. Never a spinner. */
export function Pending({ what }: { what: string }) {
  return <div className="py-2 text-2xs text-text-muted">reading {what}…</div>;
}

/**
 * A failure names what failed. A surface that renders nothing and says nothing
 * is indistinguishable from a corpus that has nothing in it.
 */
export function Failed({ what, detail }: { what: string; detail?: string | null }) {
  return (
    <div className="rounded border border-border bg-bg-card px-4 py-4">
      <div className="text-2xs text-error">{what}</div>
      {detail && <div className="mt-1 break-all text-2xs text-text-muted">{detail}</div>}
    </div>
  );
}

/**
 * What every surface carries at its foot, and the Library carries per row.
 *
 * Marking is a deliberate act — opening a document is not reading it, and
 * scrolling past it is not either — so nothing here happens on its own.
 */
export interface SurfaceRead {
  isRead: (key: string) => boolean;
  toggle: (key: string) => void;
  /** Whether this one has left the backlog, and can fold behind the reveal. */
  spent: (item: ReadableItem) => boolean;
}

/**
 * The foot of a surface item: what it is, and one tap to change it.
 *
 * It takes the key rather than the answer, because a caller holding both ends
 * had to mint the same key twice — once to ask and once to toggle — and two
 * mintings of one key are one chance for them to disagree.
 */
export function MarkRead({ read, itemKey }: { read: SurfaceRead; itemKey: string }) {
  const marked = read.isRead(itemKey);
  return (
    <div className="mt-5 flex justify-end border-t border-border pt-3">
      <button
        onClick={() => read.toggle(itemKey)}
        aria-pressed={marked}
        className={`text-2xs uppercase tracking-label ${
          marked ? 'text-settled' : 'text-text-muted hover:text-text-secondary'
        }`}
      >
        {marked ? '✓ read' : 'mark read'}
      </button>
    </div>
  );
}

/** A horizontal strip of items — the charts by date, a document's days. */
export function Rail({ children }: { children: React.ReactNode }) {
  return <div className="mb-4 flex items-center gap-2 overflow-x-auto pb-1">{children}</div>;
}

/**
 * One entry in a list that knows its own backlog: what to draw, and which
 * readable item drawing it stands for. `keep` is for the row the surface is
 * currently showing — a chart marked read while it is open stays on the rail,
 * because folding the thing under the cursor away is a disappearing act.
 */
export interface BacklogRow {
  item: ReadableItem;
  node: React.ReactNode;
  keep?: boolean;
}

/**
 * A list that leads with what is still owed.
 *
 * Everything already read folds behind one muted line at the foot, because a
 * queue that keeps showing what has been dealt with is a list of the past
 * wearing the clothes of a list of the present. The whole corpus is still one
 * tap away, and the tap is a look rather than a setting: it lives in this
 * component and is gone the next time the surface is opened.
 */
export function Backlog({ read, rows }: { read: SurfaceRead; rows: readonly BacklogRow[] }) {
  const [revealed, setRevealed] = useState(false);
  const folds = (row: BacklogRow) => row.keep !== true && read.spent(row.item);
  const done = rows.filter(folds);

  return (
    <>
      {rows.filter(row => !folds(row)).map(row => row.node)}
      {revealed ? done.map(row => row.node) : null}
      {done.length > 0 && (
        <button
          onClick={() => setRevealed(shown => !shown)}
          aria-expanded={revealed}
          className="block whitespace-nowrap px-0.5 py-2.5 text-left text-2xs text-text-muted hover:text-text-secondary"
        >
          · {done.length} read
        </button>
      )}
    </>
  );
}

export function RailItem({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'true' : undefined}
      className={`whitespace-nowrap rounded border px-2 py-1 text-2xs tracking-caps ${
        active
          ? 'border-accent text-text'
          : 'border-border text-text-muted hover:text-text-secondary'
      }`}
    >
      {children}
    </button>
  );
}

export function BackLink({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="mb-3 text-2xs text-text-muted hover:text-text-secondary"
    >
      ← {children}
    </button>
  );
}

/** One row in a list of documents: what it is, and one line about it. */
export function ListRow({
  onClick,
  label,
  title,
  detail,
}: {
  onClick: () => void;
  label: string;
  title: string;
  detail?: string | null;
}) {
  return (
    <button
      onClick={onClick}
      className="block w-full border-b border-border px-0.5 py-3 text-left"
    >
      <div className="text-2xs tracking-caps text-text-muted">{label}</div>
      <div className="font-read text-sm font-semibold text-text">{title}</div>
      {detail && (
        <div className="truncate font-read text-sm text-text-secondary">{detail}</div>
      )}
    </button>
  );
}
