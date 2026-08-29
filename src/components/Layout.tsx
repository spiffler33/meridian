/**
 * Layout
 *
 * The shell: a rail across the top, the view in the middle, and a sticky foot
 * that holds whatever the view docks there plus the backup line.
 */

import { useState } from 'react';
import type { ViewType } from '../types';
import { DockContext } from '../hooks/useDock';
import { isToday } from '../utils/dates';
import { BackupStatus } from './BackupStatus';

interface LayoutProps {
  currentView: ViewType;
  selectedDate: string;
  onViewChange: (view: ViewType) => void;
  onTodayClick: () => void;
  children: React.ReactNode;
}

const RAIL: { view: ViewType; label: string; shortcut: string }[] = [
  { view: 'tower', label: 'tower', shortcut: 't' },
  { view: 'pulse', label: 'pulse', shortcut: 'p' },
  { view: 'habits', label: 'habits', shortcut: 'h' },
  { view: 'year', label: 'year', shortcut: 'y' },
  { view: 'read', label: 'read', shortcut: 'r' },
];

function NavItem({
  label,
  shortcut,
  isActive,
  onClick,
}: {
  label: string;
  shortcut: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      aria-current={isActive ? 'page' : undefined}
      className={`px-2 py-2 text-sm transition-colors sm:px-3 ${
        isActive ? 'text-accent' : 'text-text-muted hover:text-text'
      }`}
    >
      <span>{label}</span>
      <span className="ml-1 hidden text-2xs text-text-faint sm:inline">[{shortcut}]</span>
    </button>
  );
}

export function Layout({
  currentView,
  selectedDate,
  onViewChange,
  onTodayClick,
  children,
}: LayoutProps) {
  // The slot a view docks its capture bar into. See `useDock`.
  const [dock, setDock] = useState<HTMLElement | null>(null);

  // Show "back to today" when viewing a past date on the day view
  const showTodayButton = currentView === 'habits' && !isToday(selectedDate);

  return (
    <div className="flex min-h-screen flex-col bg-bg text-text">
      <header className="border-b border-border">
        <div className="mx-auto max-w-content px-4">
          <div className="flex h-12 items-center justify-between">
            {/*
              The mark is the way into settings. A tab called "settings" sits
              in the rail claiming to be a place you go, when it is a drawer
              you open twice a year — and the rail is for the places the day
              actually runs through.

              One glyph, always the same one. It used to cycle through five on
              a sixty-second timer: motion in the corner of every screen,
              carrying no information, in an app whose whole job is to not be
              the thing that annoys you. A mark you cannot recognise is not a
              mark.
            */}
            <button
              onClick={() => onViewChange('settings')}
              aria-label="Settings"
              aria-current={currentView === 'settings' ? 'page' : undefined}
              className={`text-lg transition-colors ${
                currentView === 'settings'
                  ? 'text-accent'
                  : 'text-text-muted hover:text-text'
              }`}
            >
              ◐
            </button>

            <nav className="flex items-center">
              {RAIL.map(item => (
                <NavItem
                  key={item.view}
                  label={item.label}
                  shortcut={item.shortcut}
                  isActive={currentView === item.view}
                  onClick={() => onViewChange(item.view)}
                />
              ))}
            </nav>
          </div>
        </div>
      </header>

      {showTodayButton && (
        <div className="border-b border-border">
          <div className="mx-auto max-w-content px-4 py-2">
            <button
              onClick={onTodayClick}
              className="text-xs text-text-muted transition-colors hover:text-accent"
            >
              ← today
            </button>
          </div>
        </div>
      )}

      {/* Main. The dock provider wraps the views, so a view can render its
          capture bar into the footer below rather than over it. */}
      <main className="flex-1">
        <div className="mx-auto max-w-content px-4 py-6">
          <DockContext.Provider value={dock}>{children}</DockContext.Provider>
        </div>
      </main>

      {/*
        Backup status. Sticky rather than static: as a plain footer at the end
        of a min-h-screen column it sits at the bottom of the year and tower
        views' documents, which on a phone is several screens below the fold —
        the one window into whether the data is safe, permanently off-screen.
        Sticky keeps its own space in the flow, so it still never covers
        content, and the safe-area padding keeps it clear of the iPhone home
        indicator in the installed app.
      */}
      <footer
        className="sticky bottom-0 border-t border-border bg-bg"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {/* The view's own bar, above the backup line and never over it. Empty
            and zero-height on every view that docks nothing. */}
        <div ref={setDock} className="mx-auto max-w-content px-4" />
        <div className="mx-auto max-w-content px-4 py-2">
          <BackupStatus />
        </div>
      </footer>
    </div>
  );
}
