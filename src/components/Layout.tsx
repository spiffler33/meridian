/**
 * Layout
 *
 * Minimal shell. Nav tabs at top.
 */

import { useState, useEffect } from 'react';
import type { ViewType } from '../types';
import { isToday } from '../utils/dates';
import { BackupStatus } from './BackupStatus';

interface LayoutProps {
  currentView: ViewType;
  selectedDate: string;
  onViewChange: (view: ViewType) => void;
  onTodayClick: () => void;
  children: React.ReactNode;
}

interface NavItemProps {
  label: string;
  shortcut: string;
  isActive: boolean;
  onClick: () => void;
}

function NavItem({ label, shortcut, isActive, onClick }: NavItemProps) {
  return (
    <button
      onClick={onClick}
      className={`
        px-2 sm:px-3 py-2 text-sm transition-colors
        ${isActive
          ? 'text-accent'
          : 'text-text-muted hover:text-text'
        }
      `}
      aria-label={label}
    >
      <span>{label}</span>
      {shortcut && (
        <span className="ml-1 text-xs opacity-40 hidden sm:inline">[{shortcut}]</span>
      )}
    </button>
  );
}

const MERIDIAN_SYMBOLS = ['◐', '☉', '│', '✦', '◉'];

export function Layout({
  currentView,
  selectedDate,
  onViewChange,
  onTodayClick,
  children,
}: LayoutProps) {
  const [symbolIndex, setSymbolIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setSymbolIndex(i => (i + 1) % MERIDIAN_SYMBOLS.length);
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  // Show "back to today" when viewing a past date on the day view
  const showTodayButton = currentView === 'habits' && !isToday(selectedDate);

  return (
    <div className="min-h-screen flex flex-col bg-bg text-text">
      {/* Header */}
      <header className="border-b border-border">
        <div className="max-w-content mx-auto px-4">
          <div className="flex items-center justify-between h-12">
            {/* The mark is the way into settings. A tab called "settings"
                sits in the rail claiming to be a place you go, when it is a
                drawer you open twice a year — and the rail is for the places
                the day actually runs through. */}
            <button
              onClick={() => onViewChange('settings')}
              aria-label="Settings"
              aria-current={currentView === 'settings' ? 'page' : undefined}
              className={`text-lg transition-colors ${
                currentView === 'settings'
                  ? 'text-accent'
                  : 'text-text-secondary opacity-50 hover:opacity-100'
              }`}
            >
              {MERIDIAN_SYMBOLS[symbolIndex]}
            </button>

            <nav className="flex items-center">
              <NavItem
                label="tower"
                shortcut="t"
                isActive={currentView === 'tower'}
                onClick={() => onViewChange('tower')}
              />
              <NavItem
                label="habits"
                shortcut="h"
                isActive={currentView === 'habits'}
                onClick={() => onViewChange('habits')}
              />
              <NavItem
                label="year"
                shortcut="y"
                isActive={currentView === 'year'}
                onClick={() => onViewChange('year')}
              />
              <NavItem
                label="read"
                shortcut="r"
                isActive={currentView === 'read'}
                onClick={() => onViewChange('read')}
              />
            </nav>
          </div>
        </div>
      </header>

      {/* Back to today */}
      {showTodayButton && (
        <div className="border-b border-border">
          <div className="max-w-content mx-auto px-4 py-2">
            <button
              onClick={onTodayClick}
              className="text-xs text-text-muted hover:text-accent transition-colors"
            >
              ← today
            </button>
          </div>
        </div>
      )}

      {/* Main */}
      <main className="flex-1">
        <div className="max-w-content mx-auto px-4 py-6">
          {children}
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
        <div className="max-w-content mx-auto px-4 py-2">
          <BackupStatus />
        </div>
      </footer>
    </div>
  );
}
