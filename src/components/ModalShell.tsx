/**
 * Modal Shell
 *
 * The backdrop, the card, the heading and the dismissal that the three pack
 * modals had each written out for themselves.
 *
 * `bg-black/50` keeps its alpha: `black` is a real colour with channels, unlike
 * the theme tokens, where `/opacity` compiles to nothing at all.
 *
 * No shadow — a hairline does the dividing.
 */

import { useRef } from 'react';
import type { ReactNode } from 'react';
import { useDismiss } from '../hooks/useDismiss';

/**
 * The two button tones every one of these modals ends with. Kept beside the
 * shell rather than in a file of their own: two strings do not earn a module.
 */
export const MODAL_DISMISS_BUTTON =
  'px-3 py-1.5 text-sm text-text-secondary hover:text-text transition-colors';

export const MODAL_CONFIRM_BUTTON =
  'px-3 py-1.5 text-sm bg-accent text-bg rounded hover:opacity-90 transition-opacity disabled:opacity-50';

/** A text field. `focus:outline-none` is paid for by the accent border. */
export const MODAL_FIELD =
  'w-full px-3 py-2 bg-bg border border-border rounded text-sm text-text placeholder:text-text-muted focus:border-accent focus:outline-none';

interface ModalShellProps {
  /** The card's one heading. */
  title: string;
  /** What a screen reader announces for the dialog. */
  label: string;
  onClose: () => void;
  /** `md` is the scrolling list; everything else is `sm`. */
  size?: 'sm' | 'md';
  children: ReactNode;
}

export function ModalShell({ title, label, onClose, size = 'sm', children }: ModalShellProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  useDismiss(cardRef, onClose);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div
        ref={cardRef}
        className={`bg-bg-card border border-border rounded p-4 mx-4 w-full flex flex-col max-h-[80vh] overflow-hidden ${
          size === 'md' ? 'max-w-md' : 'max-w-sm'
        }`}
        role="dialog"
        aria-label={label}
      >
        <div className="text-sm font-medium text-text uppercase tracking-caps mb-4">{title}</div>
        {children}
      </div>
    </div>
  );
}
