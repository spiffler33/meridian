/**
 * The shell's header.
 *
 * Two decisions are pinned here. The rail carries only the places the day runs
 * through — the week became a lens on the year, so it is not one of them — and
 * the mark in the corner is the way into Settings, which is a drawer rather
 * than a destination. Both are navigation the owner reaches for without
 * looking, so both are worth a test rather than a screenshot.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { Dock } from './Dock';
import { Layout } from './Layout';

// A marker rather than null: the dock's whole point is that a view's bar lands
// ABOVE this line instead of underneath it, and that needs something to be
// above. Inert either way — the real one reads IndexedDB.
vi.mock('./BackupStatus', () => ({ BackupStatus: () => <span>backup line</span> }));

afterEach(cleanup);

function show(currentView: Parameters<typeof Layout>[0]['currentView'] = 'tower') {
  const onViewChange = vi.fn();
  render(
    <Layout
      currentView={currentView}
      selectedDate="2026-08-27"
      onViewChange={onViewChange}
      onTodayClick={vi.fn()}
    >
      <div>the view</div>
    </Layout>
  );
  return onViewChange;
}

describe('the mark in the corner', () => {
  it('is the way into settings', () => {
    const onViewChange = show();

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

    expect(onViewChange).toHaveBeenCalledWith('settings');
  });

  it('says so while settings is what is open', () => {
    show('settings');
    expect(screen.getByRole('button', { name: 'Settings' })).toHaveAttribute(
      'aria-current',
      'page'
    );
  });
});

describe('the rail', () => {
  it('carries the four places the day runs through', () => {
    show();
    for (const label of ['tower', 'habits', 'year', 'read']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('has no tab for the week, and none for settings', () => {
    show();
    expect(screen.queryByRole('button', { name: 'week' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'settings' })).toBeNull();
  });

  it('offers pulse, and clicking it opens it', () => {
    const onViewChange = show();

    fireEvent.click(screen.getByRole('button', { name: 'pulse' }));

    expect(onViewChange).toHaveBeenCalledWith('pulse');
  });
});

/**
 * The dock is the fix for a real bug rather than a tidy-up: both capture bars
 * used to be `fixed bottom-0`, which put them underneath the sticky backup
 * footer and sliced their placeholder in half. What makes that impossible now
 * is WHERE the bar renders, so that is what is pinned — the DOM position, not
 * a class name, which could be edited to `fixed` again without failing.
 */
describe('the dock', () => {
  it('renders the bar inside the footer, above the backup line', () => {
    const { container } = render(
      <Layout
        currentView="tower"
        selectedDate="2026-08-27"
        onViewChange={vi.fn()}
        onTodayClick={vi.fn()}
      >
        <Dock>
          <span>what needs doing?</span>
        </Dock>
      </Layout>
    );

    const bar = screen.getByText('what needs doing?');
    const footer = container.querySelector('footer');
    const main = container.querySelector('main');

    expect(footer?.contains(bar)).toBe(true);
    // Not merely "somewhere on the page": inside `main` it would scroll away,
    // and it is the footer that keeps it on screen.
    expect(main?.contains(bar)).toBe(false);
    // Ordered, so the backup line stays the last thing on the screen.
    expect(
      bar.compareDocumentPosition(screen.getByText('backup line')) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });
});
