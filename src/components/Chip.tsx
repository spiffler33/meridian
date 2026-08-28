/**
 * One proposal: what it says, and the way out of it.
 *
 * Quiet by construction — a hairline box, muted mono at the timestamp's size,
 * no fill and no colour. A proposal is not an achievement, and neither of the
 * two pages that show one is a feed: the stream is a ledger, and Tower is a
 * quick page for what needs doing. The only thing that should catch an eye on
 * either is the owner's own line.
 *
 * Two buttons rather than one with a gesture: tapping the words applies, and
 * the `×` beside them drops it. Both are the same weight, because dismissing
 * is not the lesser answer.
 *
 * Shared rather than copied so the two surfaces cannot drift apart — the same
 * proposal is reachable from both, and it must look like the same thing.
 */
export function Chip({
  label,
  onApply,
  onDismiss,
}: {
  label: string;
  onApply: () => void;
  onDismiss: () => void;
}) {
  return (
    <span className="inline-flex items-stretch rounded border border-border">
      <button
        onClick={onApply}
        className="px-2 py-1 font-mono text-xs text-text-muted transition-colors hover:text-text"
      >
        {label}
      </button>
      <button
        onClick={onDismiss}
        aria-label={`dismiss ${label}`}
        className="border-l border-border px-2 py-1 font-mono text-xs text-text-muted transition-colors hover:text-text"
      >
        ×
      </button>
    </span>
  );
}
