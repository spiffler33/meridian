/**
 * Layout Component
 *
 * The main shell of the app containing navigation and view container.
 * Clean, minimal design with tab-based navigation.
 * Mobile-optimized with icon navigation on small screens.
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
  icon: React.ReactNode;
  shortcut: string;
  isActive: boolean;
  onClick: () => void;
}

function NavItem({ label, icon, shortcut, isActive, onClick }: NavItemProps) {
  return (
    <button
      onClick={onClick}
      className={`
        px-3 py-2 text-sm font-medium rounded-lg transition-all
        flex items-center gap-1.5 min-w-[44px] min-h-[44px] justify-center
        ${
          isActive
            ? 'bg-surface-800 text-white'
            : 'text-surface-600 hover:text-surface-800 hover:bg-surface-100 active:bg-surface-200'
        }
      `}
      aria-label={label}
    >
      <span className="sm:hidden">{icon}</span>
      <span className="hidden sm:inline">{label}</span>
      <span className="ml-1 text-xs opacity-50 hidden lg:inline">{shortcut}</span>
    </button>
  );
}

// Simple icons for mobile navigation
const icons = {
  today: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  ),
  week: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
    </svg>
  ),
  year: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
    </svg>
  ),
  settings: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
};

export function Layout({
  currentView,
  selectedDate,
  onViewChange,
  onTodayClick,
  children,
}: LayoutProps) {
  const showTodayButton = currentView !== 'settings' && !isToday(selectedDate);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header / Navigation */}
      <header className="sticky top-0 z-10 bg-surface-50/95 backdrop-blur-sm border-b border-surface-200">
        <div className="max-w-5xl mx-auto px-3 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14">
            {/* Logo / App Name */}
            <div className="flex items-center gap-2">
              <h1 className="text-base sm:text-lg font-semibold text-surface-800 tracking-tight">
                Life Calendar
              </h1>
            </div>

            {/* Navigation Tabs */}
            <nav className="flex items-center gap-0.5 sm:gap-1">
              <NavItem
                label="Today"
                icon={icons.today}
                shortcut="T"
                isActive={currentView === 'today'}
                onClick={() => onViewChange('today')}
              />
              <NavItem
                label="Week"
                icon={icons.week}
                shortcut="W"
                isActive={currentView === 'week'}
                onClick={() => onViewChange('week')}
              />
              <NavItem
                label="Year"
                icon={icons.year}
                shortcut="Y"
                isActive={currentView === 'year'}
                onClick={() => onViewChange('year')}
              />
              <div className="w-px h-6 bg-surface-200 mx-1 sm:mx-2 hidden sm:block" />
              <NavItem
                label="Settings"
                icon={icons.settings}
                shortcut=""
                isActive={currentView === 'settings'}
                onClick={() => onViewChange('settings')}
              />
            </nav>
          </div>
        </div>
      </header>

      {/* Quick "Go to Today" button - shows when viewing a different date */}
      {showTodayButton && (
        <div className="bg-accent-50 border-b border-accent-200">
          <div className="max-w-5xl mx-auto px-3 sm:px-6 lg:px-8 py-2">
            <button
              onClick={onTodayClick}
              className="text-sm text-accent-700 hover:text-accent-800 active:text-accent-900 font-medium py-1"
            >
              &larr; Back to today
            </button>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1">
        <div className="max-w-5xl mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-6 lg:py-8">
          {children}
        </div>
      </main>

      {/* Footer - hidden on mobile to save space */}
      <footer className="hidden sm:block border-t border-surface-200 py-4 text-center text-xs text-surface-400">
        Life Calendar — Shape today on purpose
      </footer>
    </div>
  );
}
