/**
 * The step pair: back one, forward one.
 *
 * Several surfaces walk a sequence — a day, a week, a year — and each had grown
 * its own copy of these two glyphs. One pair, so the target size, the hover and
 * the labels cannot drift apart between pages.
 *
 * `label` names the unit rather than the button: a screen reader hears
 * "previous day", which is what the arrow actually does. Anything that belongs
 * *between* the two arrows — a date picker, say — comes in as children.
 */

import type { ReactNode } from 'react';

export function StepNav({
  onPrev,
  onNext,
  label,
  children,
}: {
  onPrev: () => void;
  onNext: () => void;
  label: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-1">
      <button
        onClick={onPrev}
        aria-label={`previous ${label}`}
        className="p-2 text-text-muted transition-colors hover:text-text"
      >
        ‹
      </button>

      {children}

      <button
        onClick={onNext}
        aria-label={`next ${label}`}
        className="p-2 text-text-muted transition-colors hover:text-text"
      >
        ›
      </button>
    </div>
  );
}
