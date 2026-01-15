/**
 * Today View
 *
 * Daily execution view. MITs, habits, reflection.
 * Stoic, minimal, factual.
 * Now with focus prompt, pick-for-me, and 2-min timer.
 */

import { useMemo, useState, useEffect } from 'react';
import { useApp } from '../store/AppContext';
import { DateNavigation } from '../components/DateNavigation';
import { MitSection } from '../components/MitSection';
import { HabitGrid } from '../components/HabitGrid';
import { Reflection } from '../components/Reflection';
import { DailyInspiration } from '../components/DailyInspiration';
import { AiInsight } from '../components/AiInsight';
import { FocusPrompt } from '../components/FocusPrompt';
import { PickForMe } from '../components/PickForMe';
import { TwoMinuteTimer } from '../components/TwoMinuteTimer';
import { isToday } from '../utils/dates';
import type { MitCategory, TodoItem } from '../types';

interface TodayViewProps {
  selectedDate: string;
  onPrevious: () => void;
  onNext: () => void;
  onDateSelect: (date: string) => void;
}

interface PickedTask {
  item: TodoItem;
  category: MitCategory;
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
    setMitFirstStep,
    setFocus,
    setReflection,
    getHabitCount,
    getHabitStreak,
  } = useApp();

  const dayData = getDailyData(selectedDate);
  const habits = state.settings.habits;
  const habitCount = getHabitCount(selectedDate);

  // Focus prompt state - only show for today, only once per session
  const [showFocusPrompt, setShowFocusPrompt] = useState(false);
  const [focusPromptDismissed, setFocusPromptDismissed] = useState(false);

  // Picked task state
  const [pickedTask, setPickedTask] = useState<PickedTask | null>(null);

  // Timer state
  const [timerTask, setTimerTask] = useState<{ name: string; category: MitCategory; id: string } | null>(null);

  // Check if we should show focus prompt
  useEffect(() => {
    if (isToday(selectedDate) && !dayData.focus && !focusPromptDismissed) {
      // Small delay so the page renders first
      const timer = setTimeout(() => setShowFocusPrompt(true), 300);
      return () => clearTimeout(timer);
    } else {
      setShowFocusPrompt(false);
    }
  }, [selectedDate, dayData.focus, focusPromptDismissed]);

  // Calculate streaks for all habits
  const habitStreaks = useMemo(() => {
    const streaks: Record<string, number> = {};
    for (const habit of habits) {
      streaks[habit.id] = getHabitStreak(habit.id, selectedDate);
    }
    return streaks;
  }, [habits, getHabitStreak, selectedDate]);

  const totalMits = dayData.mit.work.length + dayData.mit.self.length + dayData.mit.family.length;
  const completedMits =
    dayData.mit.work.filter(i => i.completed).length +
    dayData.mit.self.filter(i => i.completed).length +
    dayData.mit.family.filter(i => i.completed).length;

  const handleSetFocus = (focus: string) => {
    setFocus(selectedDate, focus);
    setShowFocusPrompt(false);
  };

  const handleSkipFocus = () => {
    setFocusPromptDismissed(true);
    setShowFocusPrompt(false);
  };

  const handlePick = (category: MitCategory, itemId: string) => {
    const items = dayData.mit[category];
    const item = items.find(i => i.id === itemId);
    if (item) {
      setPickedTask({ item, category });
    }
  };

  const handleClearPick = () => {
    setPickedTask(null);
  };

  const handleStartTimer = () => {
    if (pickedTask) {
      setTimerTask({
        name: pickedTask.item.text,
        category: pickedTask.category,
        id: pickedTask.item.id,
      });
    }
  };

  const handleTimerComplete = () => {
    if (timerTask) {
      toggleMit(selectedDate, timerTask.category, timerTask.id);
    }
    setTimerTask(null);
    setPickedTask(null);
  };

  const handleTimerStop = () => {
    setTimerTask(null);
  };

  // Get picked item ID for each category
  const getPickedIdForCategory = (category: MitCategory) => {
    return pickedTask?.category === category ? pickedTask.item.id : null;
  };

  // Show focus prompt
  if (showFocusPrompt) {
    return <FocusPrompt onSetFocus={handleSetFocus} onSkip={handleSkipFocus} />;
  }

  return (
    <div className="space-y-6">
      <DateNavigation
        selectedDate={selectedDate}
        onPrevious={onPrevious}
        onNext={onNext}
        onDateSelect={onDateSelect}
      />

      {/* Daily focus - the ONE thing */}
      {dayData.focus && (
        <div className="bg-accent/10 rounded border border-accent/30 p-4">
          <div className="text-xs text-accent uppercase tracking-wide mb-1">today's focus</div>
          <div className="text-text font-medium">{dayData.focus}</div>
        </div>
      )}

      {/* Daily inspiration */}
      <DailyInspiration selectedDate={selectedDate} />

      {/* Status line + Pick for me */}
      <div className="flex items-center justify-between">
        {(totalMits > 0 || habitCount > 0) && (
          <div className="text-xs text-text-muted font-mono">
            {totalMits > 0 && <span>{completedMits}/{totalMits} tasks</span>}
            {totalMits > 0 && habitCount > 0 && <span className="mx-2">·</span>}
            {habits.length > 0 && <span>{habitCount}/{habits.length} habits</span>}
          </div>
        )}
        <PickForMe
          workItems={dayData.mit.work}
          selfItems={dayData.mit.self}
          familyItems={dayData.mit.family}
          onPick={handlePick}
          onClear={handleClearPick}
          pickedTask={pickedTask}
        />
      </div>

      {/* Start timer button when task is picked */}
      {pickedTask && !timerTask && (
        <button
          onClick={handleStartTimer}
          className="w-full py-3 rounded border border-accent text-accent hover:bg-accent/10 transition-colors text-sm font-medium"
        >
          just 2 minutes → {pickedTask.item.text}
        </button>
      )}

      {/* MITs */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <MitSection
          category="work"
          title="work"
          items={dayData.mit.work}
          pickedItemId={getPickedIdForCategory('work')}
          onAdd={(text, firstStep) => addMit(selectedDate, 'work', text, firstStep)}
          onUpdate={(id, text) => updateMit(selectedDate, 'work', id, text)}
          onDelete={id => deleteMit(selectedDate, 'work', id)}
          onToggle={id => toggleMit(selectedDate, 'work', id)}
          onSetFirstStep={(id, firstStep) => setMitFirstStep(selectedDate, 'work', id, firstStep)}
        />
        <MitSection
          category="self"
          title="self"
          items={dayData.mit.self}
          pickedItemId={getPickedIdForCategory('self')}
          onAdd={(text, firstStep) => addMit(selectedDate, 'self', text, firstStep)}
          onUpdate={(id, text) => updateMit(selectedDate, 'self', id, text)}
          onDelete={id => deleteMit(selectedDate, 'self', id)}
          onToggle={id => toggleMit(selectedDate, 'self', id)}
          onSetFirstStep={(id, firstStep) => setMitFirstStep(selectedDate, 'self', id, firstStep)}
        />
        <MitSection
          category="family"
          title="family"
          items={dayData.mit.family}
          pickedItemId={getPickedIdForCategory('family')}
          onAdd={(text, firstStep) => addMit(selectedDate, 'family', text, firstStep)}
          onUpdate={(id, text) => updateMit(selectedDate, 'family', id, text)}
          onDelete={id => deleteMit(selectedDate, 'family', id)}
          onToggle={id => toggleMit(selectedDate, 'family', id)}
          onSetFirstStep={(id, firstStep) => setMitFirstStep(selectedDate, 'family', id, firstStep)}
        />
      </div>

      {/* Habits */}
      <HabitGrid
        habits={habits}
        completedHabits={dayData.habits}
        streaks={habitStreaks}
        onToggle={habitId => toggleHabit(selectedDate, habitId)}
      />

      {/* Reflection */}
      <Reflection
        value={dayData.reflection}
        onChange={value => setReflection(selectedDate, value)}
      />

      {/* AI Insight */}
      <AiInsight
        selectedDate={selectedDate}
        habits={habits}
        completedHabits={dayData.habits}
        streaks={habitStreaks}
        tasksCompleted={completedMits}
        totalTasks={totalMits}
        reflection={dayData.reflection}
      />

      {/* Two Minute Timer */}
      {timerTask && (
        <TwoMinuteTimer
          taskName={timerTask.name}
          onComplete={handleTimerComplete}
          onStop={handleTimerStop}
        />
      )}
    </div>
  );
}
