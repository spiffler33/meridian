/**
 * Life Calendar - Main App Component
 *
 * "Frictionless. Track, reflect, see patterns."
 * Terminal meets journal - clean, fast, keyboard-first.
 */

import { AppProvider } from './store/AppContext';
import { ThemeProvider } from './store/ThemeContext';
import { Layout } from './components/Layout';
import { ViewBoundary } from './components/ViewBoundary';
import { useNavigation } from './hooks/useNavigation';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import TowerView from './views/TowerView';
import { HabitsView } from './views/HabitsView';
import { WeekView } from './views/WeekView';
import { YearView } from './views/YearView';
import { ReadView } from './views/ReadView';
import { SettingsView } from './views/SettingsView';

function AppContent() {
  const nav = useNavigation();

  // Keyboard shortcuts
  useKeyboardShortcuts({
    onViewChange: nav.setView,
    onGoToToday: nav.goToToday,
    onPreviousDay: nav.goToPreviousDay,
    onNextDay: nav.goToNextDay,
  });

  const handleHabitsDateSelect = (date: string) => {
    nav.setSelectedDate(date);
    nav.setView('habits');
  };

  const renderView = () => {
    switch (nav.view) {
      case 'tower':
        return <TowerView />;
      case 'habits':
        return (
          <HabitsView
            selectedDate={nav.selectedDate}
            onPrevious={nav.goToPreviousDay}
            onNext={nav.goToNextDay}
            onDateSelect={nav.setSelectedDate}
          />
        );
      case 'week':
        return (
          <WeekView
            selectedDate={nav.selectedDate}
            onDateSelect={handleHabitsDateSelect}
            onPreviousWeek={nav.goToPreviousWeek}
            onNextWeek={nav.goToNextWeek}
          />
        );
      case 'year':
        return (
          <YearView
            selectedYear={nav.selectedYear}
            onYearChange={nav.setSelectedYear}
            onDateSelect={handleHabitsDateSelect}
          />
        );
      case 'read':
        return (
          <ReadView
            surface={nav.read.surface}
            item={nav.read.item}
            onSurfaceChange={nav.setReadSurface}
            onNavigate={nav.setReadRoute}
          />
        );
      case 'settings':
        return <SettingsView />;
      default:
        return null;
    }
  };

  return (
    <Layout
      currentView={nav.view}
      selectedDate={nav.selectedDate}
      onViewChange={nav.setView}
      onTodayClick={nav.goToToday}
    >
      {/* Keyed on the view, so changing tab clears a caught error. Without the
          key the fallback latches and the app is stuck on it for the session. */}
      <ViewBoundary key={nav.view} view={nav.view}>
        {renderView()}
      </ViewBoundary>
    </Layout>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AppProvider>
        <AppContent />
      </AppProvider>
    </ThemeProvider>
  );
}
