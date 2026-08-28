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

import { Layout } from './Layout';

vi.mock('./BackupStatus', () => ({ BackupStatus: () => null }));

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
