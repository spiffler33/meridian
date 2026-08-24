/**
 * The reading pane's shared furniture.
 *
 * Small pieces, in one place because five surfaces draw the same card, the
 * same kicker and the same source line, and the surfaces should differ in what
 * they say rather than in how they look.
 */

export function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-4 rounded border border-sp-hair bg-sp-panel px-[18px] pb-4 pt-[18px]">
      {children}
    </div>
  );
}

export function Kicker({ children, tone }: { children: React.ReactNode; tone?: 'ice' }) {
  return (
    <div
      className={`mb-2 font-mono text-[9.5px] uppercase tracking-[0.22em] ${
        tone === 'ice' ? 'text-sp-ice' : 'text-sp-amber'
      }`}
    >
      {children}
    </div>
  );
}

export function Headline({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-read text-[18px] font-bold leading-[1.35] tracking-[-0.01em] text-sp-ink">
      {children}
    </h2>
  );
}

export function SrcLine({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-[14px] border-t border-sp-hair pt-3 font-mono text-[10.5px] leading-[1.7] text-sp-faint">
      {children}
    </div>
  );
}

export function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-[10px] font-read text-sm italic leading-[1.6] text-sp-muted">{children}</p>
  );
}

/**
 * A citation, drawn but not yet live: chips become tappable in phase 4, and a
 * button that goes nowhere would be a lie about what this pane can do today.
 */
export function Cite({ children }: { children: React.ReactNode }) {
  return (
    <span className="mx-px whitespace-nowrap rounded-[9px] border border-sp-rim px-[7px] pb-[2px] pt-px align-[0.12em] font-mono text-[10.5px] text-sp-ice">
      {children}
    </span>
  );
}

/** Inline, quiet, and gone the moment the answer arrives. Never a spinner. */
export function Pending({ what }: { what: string }) {
  return <div className="py-2 font-mono text-[10.5px] text-sp-faint">reading {what}…</div>;
}

/**
 * A failure names what failed. A surface that renders nothing and says nothing
 * is indistinguishable from a corpus that has nothing in it.
 */
export function Failed({ what, detail }: { what: string; detail?: string | null }) {
  return (
    <div className="rounded border border-sp-hair bg-sp-panel px-[18px] py-4">
      <div className="font-mono text-[10.5px] text-error">{what}</div>
      {detail && <div className="mt-1 break-all font-mono text-[10.5px] text-sp-faint">{detail}</div>}
    </div>
  );
}

/** A horizontal strip of items — the charts by date, a document's days. */
export function Rail({ children }: { children: React.ReactNode }) {
  return <div className="mb-4 flex gap-2 overflow-x-auto pb-1">{children}</div>;
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
      className={`whitespace-nowrap rounded border px-2 py-1 font-mono text-[10px] tracking-[0.06em] ${
        active
          ? 'border-sp-amber text-sp-ink'
          : 'border-sp-hair text-sp-faint hover:text-sp-muted'
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
      className="mb-3 font-mono text-[10.5px] text-sp-faint hover:text-sp-muted"
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
      className="block w-full border-b border-sp-hair px-[2px] py-[11px] text-left"
    >
      <div className="font-mono text-[10px] tracking-[0.06em] text-sp-faint">{label}</div>
      <div className="font-read text-[15px] font-semibold leading-[1.4] text-sp-ink">{title}</div>
      {detail && (
        <div className="truncate font-read text-[13px] leading-[1.45] text-sp-muted">{detail}</div>
      )}
    </button>
  );
}
