/**
 * The view boundary.
 *
 * Three things have to be true or it is worse than nothing: the shell must
 * survive the crash, changing view must clear it, and the error's own words
 * must never reach the screen. The last one is the secrets fence — anything
 * thrown near a token could be carrying one.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { ViewBoundary } from './ViewBoundary';

const SECRET = 'github_pat_11ABCDEFG_this_should_never_be_rendered';

function Boom(): never {
  throw new Error(`request failed with ${SECRET}`);
}

/** React logs a caught error itself; the test is not about that noise. */
function quietly(run: () => void): void {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    run();
  } finally {
    spy.mockRestore();
  }
}

afterEach(cleanup);

describe('a view that throws while rendering', () => {
  it('leaves the shell standing and says which view died', () => {
    quietly(() => {
      render(
        <div>
          <nav>the nav rail</nav>
          <ViewBoundary view="tower">
            <Boom />
          </ViewBoundary>
        </div>
      );
    });

    expect(screen.getByText('the tower view stopped working')).toBeInTheDocument();
    expect(screen.getByText('the nav rail')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'reload' })).toBeInTheDocument();
  });

  it('never puts the error on screen', () => {
    let body = '';
    quietly(() => {
      const { container } = render(
        <ViewBoundary view="read">
          <Boom />
        </ViewBoundary>
      );
      body = container.textContent ?? '';
    });

    expect(body).not.toContain(SECRET);
    expect(body).not.toContain('request failed');
  });

  it('clears when the view changes, rather than latching for the session', () => {
    // The key is what does this: without it the fallback outlives the view it
    // was raised for and every other tab is dead too.
    const { rerender } = render(
      <ViewBoundary key="tower" view="tower">
        <div>a view that works</div>
      </ViewBoundary>
    );

    quietly(() => {
      rerender(
        <ViewBoundary key="tower" view="tower">
          <Boom />
        </ViewBoundary>
      );
    });
    expect(screen.getByText('the tower view stopped working')).toBeInTheDocument();

    rerender(
      <ViewBoundary key="read" view="read">
        <div>the read view</div>
      </ViewBoundary>
    );
    expect(screen.getByText('the read view')).toBeInTheDocument();
    expect(screen.queryByText('the tower view stopped working')).not.toBeInTheDocument();
  });

  it('renders the view untouched when nothing throws', () => {
    render(
      <ViewBoundary view="year">
        <div>the year view</div>
      </ViewBoundary>
    );

    expect(screen.getByText('the year view')).toBeInTheDocument();
  });
});
