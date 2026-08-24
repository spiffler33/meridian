/**
 * ReadView.
 *
 * Every route in the pane's contract has to land on something readable, so
 * this walks all six surfaces and checks each one renders its own content —
 * including raw, which has no tab and arrives only by citation. It also covers
 * the two things the shell owns rather than borrows: the screen adopting the
 * reading palette while the view is mounted and handing it back when it is
 * not, and the instrument answering the library rather than a constant.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { ReadView } from './ReadView';
import { LIBRARY_ROWS } from './readFixtures';

afterEach(cleanup);

function show(surface: Parameters<typeof ReadView>[0]['surface'], item: string[] = []) {
  return render(<ReadView surface={surface} item={item} onSurfaceChange={vi.fn()} />);
}

describe('the surfaces', () => {
  it('renders tape', () => {
    show('tape');
    expect(screen.getByText("Term premium does the tightening the Fed won't")).toBeInTheDocument();
  });

  it('renders chart with the value outside the bar', () => {
    show('chart');
    expect(screen.getByText('Utilities capex')).toBeInTheDocument();
    expect(screen.getByText('+86%')).toBeInTheDocument();
  });

  it('renders canon with its day ticker', () => {
    show('canon');
    expect(screen.getByText('day 4/9')).toBeInTheDocument();
  });

  it('renders an essay with its footnote marks', () => {
    const { container } = show('essay');
    expect(screen.getByText('A sample subtitle sits here, muted, one line.')).toBeInTheDocument();
    expect(container.querySelectorAll('sup')).toHaveLength(2);
  });

  it('renders the library', () => {
    show('library');
    expect(screen.getByText('Sample newsletter — the power buildout')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Mark / })).toHaveLength(LIBRARY_ROWS.length);
  });

  it('renders raw at the entry the route names', () => {
    show('raw', ['2026-08-18--sample-macro']);
    expect(screen.getByText('2026-08-18--sample-macro')).toBeInTheDocument();
  });

  it('renders raw without an entry rather than blank', () => {
    show('raw');
    expect(screen.getByText('No entry named')).toBeInTheDocument();
  });
});

describe('the tab rail', () => {
  it('marks the surface in the URL as the selected tab', () => {
    show('canon');
    expect(screen.getByRole('tab', { name: 'Canon' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Tape' })).toHaveAttribute('aria-selected', 'false');
  });

  it('leaves every tab unselected on a surface that has no tab', () => {
    show('raw');
    for (const tab of screen.getAllByRole('tab')) {
      expect(tab).toHaveAttribute('aria-selected', 'false');
    }
  });

  it('asks the router for the new surface rather than switching on its own', () => {
    const onSurfaceChange = vi.fn();
    render(<ReadView surface="tape" item={[]} onSurfaceChange={onSurfaceChange} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Library' }));

    expect(onSurfaceChange).toHaveBeenCalledWith('library');
  });
});

describe('the reading surface', () => {
  it('adopts the palette while mounted and hands it back on the way out', () => {
    const { unmount } = show('tape');
    expect(document.documentElement.getAttribute('data-surface')).toBe('read');

    unmount();
    expect(document.documentElement.getAttribute('data-surface')).toBeNull();
  });
});

describe('the instrument', () => {
  it('reads the backlog the library is actually carrying', () => {
    show('library');
    const unread = LIBRARY_ROWS.filter(row => !row.read).length;
    expect(screen.getByText(`${unread} unread`)).toBeInTheDocument();
    expect(screen.getByText('Drifting')).toBeInTheDocument();
  });

  it('settles as the backlog is cleared', () => {
    show('library');

    for (const button of screen.getAllByRole('button', { name: /^Mark .* read$/ })) {
      fireEvent.click(button);
    }

    expect(screen.getByText('all read')).toBeInTheDocument();
    expect(screen.getByText('At setpoint')).toBeInTheDocument();
  });

  it('drifts again when an entry is marked unread', () => {
    show('library');
    const alreadyRead = LIBRARY_ROWS.filter(row => row.read).length;

    fireEvent.click(screen.getAllByRole('button', { name: /^Mark .* unread$/ })[0]);

    expect(screen.getByText(`${LIBRARY_ROWS.length - alreadyRead + 1} unread`)).toBeInTheDocument();
  });
});
