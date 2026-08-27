/**
 * Life Calendar - Main App Component
 *
 * "Frictionless. Track, reflect, see patterns."
 * Terminal meets journal - clean, fast, keyboard-first.
 */

import { useCallback, useState } from 'react';

import { AppProvider } from './store/AppContext';
import { ThemeProvider } from './store/ThemeContext';
import { Layout } from './components/Layout';
import { ViewBoundary } from './components/ViewBoundary';
import { useNavigation } from './hooks/useNavigation';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useCalendar } from './hooks/useCalendar';
import TowerView from './views/TowerView';
import { HabitsView } from './views/HabitsView';
import { YearView } from './views/YearView';
import { ReadView } from './views/ReadView';
import { SettingsView } from './views/SettingsView';

function AppContent() {
  const nav = useNavigation();

  // Mounted here rather than in a view: the calendar mirror is what the day is
  // planned against, so it refreshes when the app opens and on every focus,
  // whichever pane happens to be showing. One instance, passed down — two
  // hooks would mean two cache reads and two copies of the same state.
  const calendar = useCalendar();

  // Whether the week lens on the Year view is open. Held here rather than in
  // the view because `w` opens it from anywhere, and deliberately out of the
  // hash: it is a look at the year, not an address.
  const [weekOpen, setWeekOpen] = useState(false);
  const openWeek = useCallback(() => {
    setWeekOpen(true);
    nav.setView('year');
  }, [nav]);

  // Keyboard shortcuts
  useKeyboardShortcuts({
    onViewChange: nav.setView,
    onGoToToday: nav.goToToday,
    onPreviousDay: nav.goToPreviousDay,
    onNextDay: nav.goToNextDay,
    onOpenWeek: openWeek,
  });

  const handleHabitsDateSelect = (date: string) => {
    nav.setSelectedDate(date);
    nav.setView('habits');
  };

  const renderView = () => {
    switch (nav.view) {
      case 'tower':
        return <TowerView mirror={calendar.mirror} />;
      case 'habits':
        return (
          <HabitsView
            selectedDate={nav.selectedDate}
            onPrevious={nav.goToPreviousDay}
            onNext={nav.goToNextDay}
            onDateSelect={nav.setSelectedDate}
          />
        );
      case 'year':
        return (
          <YearView
            selectedYear={nav.selectedYear}
            onYearChange={nav.setSelectedYear}
            onDateSelect={handleHabitsDateSelect}
            mirror={calendar.mirror}
            selectedDate={nav.selectedDate}
            weekOpen={weekOpen}
            onWeekOpenChange={setWeekOpen}
            onPreviousWeek={nav.goToPreviousWeek}
            onNextWeek={nav.goToNextWeek}
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
