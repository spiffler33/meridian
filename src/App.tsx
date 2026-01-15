/**
 * Life Calendar - Main App Component
 *
 * This is the root component that orchestrates the entire app.
 * It manages navigation state and renders the appropriate view.
 */

import { AppProvider } from './store/AppContext';
import { Layout } from './components/Layout';
import { useNavigation } from './hooks/useNavigation';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { TodayView } from './views/TodayView';
import { WeekView } from './views/WeekView';
import { YearView } from './views/YearView';
import { SettingsView } from './views/SettingsView';

function AppContent() {
  const nav = useNavigation();

  // Set up keyboard shortcuts
  useKeyboardShortcuts({
    onViewChange: nav.setView,
    onGoToToday: nav.goToToday,
    onPreviousDay: nav.goToPreviousDay,
    onNextDay: nav.goToNextDay,
  });

  // Handle clicking a day from week/year view
  const handleDateSelect = (date: string) => {
    nav.setSelectedDate(date);
    nav.setView('today');
  };

  // Render the current view
  const renderView = () => {
    switch (nav.view) {
      case 'today':
        return (
          <TodayView
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
            onDateSelect={handleDateSelect}
            onPreviousWeek={nav.goToPreviousWeek}
            onNextWeek={nav.goToNextWeek}
          />
        );
      case 'year':
        return (
          <YearView
            selectedYear={nav.selectedYear}
            onYearChange={nav.setSelectedYear}
            onDateSelect={handleDateSelect}
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
      {renderView()}
    </Layout>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}
