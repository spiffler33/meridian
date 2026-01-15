/**
 * Today View
 *
 * The main daily view showing MITs, habits, and reflection.
 * This is the primary "cockpit" for daily execution.
 */

import { useApp } from '../store/AppContext';
import { DateNavigation } from '../components/DateNavigation';
import { MitSection } from '../components/MitSection';
import { HabitGrid } from '../components/HabitGrid';
import { Reflection } from '../components/Reflection';
import { isToday } from '../utils/dates';

interface TodayViewProps {
  selectedDate: string;
  onPrevious: () => void;
  onNext: () => void;
  onDateSelect: (date: string) => void;
}

// Greeting based on time of day
function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Shape your morning';
  if (hour < 17) return 'Shape your afternoon';
  if (hour < 21) return 'Shape your evening';
  return 'Reflect on today';
}

export function TodayView({ selectedDate, onPrevious, onNext, onDateSelect }: TodayViewProps) {
  const {
    state,
    getDailyData,
    toggleHabit,
    addMit,
    updateMit,
    deleteMit,
    toggleMit,
    setReflection,
    getHabitCount,
  } = useApp();

  const dayData = getDailyData(selectedDate);
  const habits = state.settings.habits;
  const habitCount = getHabitCount(selectedDate);

  // Calculate overall daily progress
  const totalMits = dayData.mit.work.length + dayData.mit.self.length + dayData.mit.family.length;
  const completedMits =
    dayData.mit.work.filter(i => i.completed).length +
    dayData.mit.self.filter(i => i.completed).length +
    dayData.mit.family.filter(i => i.completed).length;

  return (
    <div className="space-y-6">
      {/* Date navigation */}
      <DateNavigation
        selectedDate={selectedDate}
        onPrevious={onPrevious}
        onNext={onNext}
        onDateSelect={onDateSelect}
      />

      {/* Greeting - only show for today */}
      {isToday(selectedDate) && (
        <div className="text-surface-500 text-sm">
          {getGreeting()}
        </div>
      )}

      {/* Quick stats */}
      {(totalMits > 0 || habitCount > 0) && (
        <div className="flex items-center gap-4 text-sm text-surface-500">
          {totalMits > 0 && (
            <span>
              {completedMits}/{totalMits} MITs done
            </span>
          )}
          {habitCount > 0 && (
            <span>
              {habitCount}/{habits.length} habits
            </span>
          )}
        </div>
      )}

      {/* MITs - Three pillars */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <MitSection
          category="work"
          title="Work"
          subtitle="Professional priorities"
          items={dayData.mit.work}
          onAdd={text => addMit(selectedDate, 'work', text)}
          onUpdate={(id, text) => updateMit(selectedDate, 'work', id, text)}
          onDelete={id => deleteMit(selectedDate, 'work', id)}
          onToggle={id => toggleMit(selectedDate, 'work', id)}
        />
        <MitSection
          category="self"
          title="Self / Health"
          subtitle="Personal growth & wellbeing"
          items={dayData.mit.self}
          onAdd={text => addMit(selectedDate, 'self', text)}
          onUpdate={(id, text) => updateMit(selectedDate, 'self', id, text)}
          onDelete={id => deleteMit(selectedDate, 'self', id)}
          onToggle={id => toggleMit(selectedDate, 'self', id)}
        />
        <MitSection
          category="family"
          title="Family"
          subtitle="Relationships & connection"
          items={dayData.mit.family}
          onAdd={text => addMit(selectedDate, 'family', text)}
          onUpdate={(id, text) => updateMit(selectedDate, 'family', id, text)}
          onDelete={id => deleteMit(selectedDate, 'family', id)}
          onToggle={id => toggleMit(selectedDate, 'family', id)}
        />
      </div>

      {/* Habits */}
      <HabitGrid
        habits={habits}
        completedHabits={dayData.habits}
        onToggle={habitId => toggleHabit(selectedDate, habitId)}
      />

      {/* Reflection */}
      <Reflection
        value={dayData.reflection}
        onChange={value => setReflection(selectedDate, value)}
      />
    </div>
  );
}
