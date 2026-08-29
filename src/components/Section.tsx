/**
 * One section: a rule, a label, and what sits under it.
 *
 * A rule rather than a card. A bordered control inside a bordered card inside a
 * bordered section is three frames saying one thing, so the divider does the
 * dividing and the only frames left in the app are the ones a finger has to
 * find. Every page uses this — Tower and Settings first, then Habits and Year,
 * which had been stacking cards and made the two halves look like two apps.
 *
 * `label` is a node rather than a string because a disclosure's label is a
 * button: the heading holds the micro-label styling and the button inside it
 * inherits, so a collapsible section and a plain one are the same object.
 *
 * `aside` is the right-hand end of the label row — a count, a stepper, a
 * "reset". It sits on the rule's own line rather than earning a row of its own.
 */

import type { ReactNode } from 'react';

interface SectionProps {
  label: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}

export function Section({ label, aside, children }: SectionProps) {
  return (
    <section className="border-t border-border pt-4 space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="flex-1 text-xs uppercase tracking-label text-text-muted">{label}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}
