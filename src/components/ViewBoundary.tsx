/**
 * The one thing standing between a render-time throw and a blank app.
 *
 * Without it a throw anywhere inside a view unmounts the whole tree — nav rail,
 * backup line and all — and the owner is left with a white screen on the site
 * that runs their day. With it the shell survives, the dead view says it is
 * dead, and every other view is one tap away.
 *
 * A class, because only a class can catch a render error; a plain constructor,
 * because `erasableSyntaxOnly` forbids parameter properties.
 *
 * The fallback never renders the error. Anything thrown near a token could
 * carry one, and the secrets fence does not make an exception for a message
 * that happens to be convenient. In development the real thing goes to the
 * console, which is where the boot catch in AppContext already puts it.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ViewBoundaryProps {
  /** What died, in the owner's words — the nav label of the view. */
  view: string;
  children: ReactNode;
}

interface ViewBoundaryState {
  failed: boolean;
}

export class ViewBoundary extends Component<ViewBoundaryProps, ViewBoundaryState> {
  constructor(props: ViewBoundaryProps) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError(): ViewBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    if (import.meta.env.DEV) console.error('View crashed:', error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;

    return (
      <div className="rounded border border-border bg-bg-card px-4 py-3 font-mono text-sm">
        <div className="text-error">the {this.props.view} view stopped working</div>
        <div className="mt-1 text-text-muted">
          nothing was lost — every change is already in the journal. another view is one tap away.
        </div>
        <button
          onClick={() => window.location.reload()}
          className="mt-3 text-text-muted underline underline-offset-2 transition-colors hover:text-accent"
        >
          reload
        </button>
      </div>
    );
  }
}
