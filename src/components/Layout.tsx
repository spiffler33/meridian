/**
 * Layout
 *
 * Minimal shell. Nav tabs at top.
 */

import type { ViewType } from '../types';
import { isToday } from '../utils/dates';

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
        px-3 py-2 text-sm transition-colors
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

export function Layout({
  currentView,
  selectedDate,
  onViewChange,
  onTodayClick,
  children,
}: LayoutProps) {
  // Show "back to today" when viewing past dates on habits/week views
  const showTodayButton = (currentView === 'habits' || currentView === 'week') && !isToday(selectedDate);

  return (
    <div className="min-h-screen flex flex-col bg-bg text-text">
      {/* Header */}
      <header className="border-b border-border">
        <div className="max-w-content mx-auto px-4">
          <div className="flex items-center justify-between h-12">
            <span className="text-sm font-medium text-text-secondary">
              calendar
            </span>

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
                label="week"
                shortcut="w"
                isActive={currentView === 'week'}
                onClick={() => onViewChange('week')}
              />
              <NavItem
                label="year"
                shortcut="y"
                isActive={currentView === 'year'}
                onClick={() => onViewChange('year')}
              />
              <span className="w-px h-4 bg-border mx-2" />
              <NavItem
                label="settings"
                shortcut=""
                isActive={currentView === 'settings'}
                onClick={() => onViewChange('settings')}
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
    </div>
  );
}
