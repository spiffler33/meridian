/**
 * AI Insight Component
 *
 * On-demand Claude-powered daily insight with historical analytics.
 * Analyzes 30-day patterns, correlations, and day-of-week trends.
 */

import { useState, useCallback, useEffect } from 'react';
import { generateEnhancedInsight, loadApiKey } from '../services/claude';
import { useApp } from '../store/AppContext';
import { getMeta, setMeta } from '../lib/db';
import type { HabitDefinition, HabitId, DailyData } from '../types';
import { getDaysUntilEndOfYear } from '../utils/dates';
import { computeHistoricalAnalytics } from '../utils/analytics';

interface AiInsightProps {
  selectedDate: string;
  habits: HabitDefinition[];
  completedHabits: Record<HabitId, boolean>;
  streaks: Record<HabitId, number>;
  tasksCompleted: number;
  totalTasks: number;
  reflection?: string;
  dailyData: Record<string, DailyData>;
}

export function AiInsight({
  selectedDate,
  habits,
  completedHabits,
  streaks,
  tasksCompleted,
  totalTasks,
  reflection,
  dailyData,
}: AiInsightProps) {
  const { profile, updateProfile } = useApp();
  const [insight, setInsight] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showContextPrompt, setShowContextPrompt] = useState(false);
  const [contextInput, setContextInput] = useState('');
  // Null until the store answers: 'false' would be a guess, and a fast click
  // on that guess re-opens a prompt the owner already waved away.
  const [hasSkippedPrompt, setHasSkippedPrompt] = useState<boolean | null>(null);
  const [hasApiKey, setHasApiKey] = useState(false);

  const hasPersonalContext = !!profile?.personal_context;

  // Both answers come out of the IndexedDB `meta` store, so both are promises
  // and one effect asks for both: whether a key is stored at all — testing the
  // promise itself was always true, which is why this panel showed up on
  // devices with no key — and whether the owner already waved the context
  // prompt away. A store that cannot answer leaves each at what it started as.
  useEffect(() => {
    let live = true;
    void Promise.all([
      loadApiKey().then(key => key.length > 0, () => false),
      getMeta<boolean>('skippedContextPrompt', false).then(value => value === true, () => null),
    ]).then(([keyStored, skipped]) => {
      if (!live) return;
      setHasApiKey(keyStored);
      if (skipped !== null) setHasSkippedPrompt(skipped);
    });
    return () => {
      live = false;
    };
  }, []);

  const doGenerate = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const habitData = habits.map(h => ({
        name: h.label,
        completed: completedHabits[h.id] || false,
        streak: streaks[h.id] || 0,
      }));

      // Compute 30-day historical analytics
      const analytics = computeHistoricalAnalytics(dailyData, habits, 30, selectedDate);

      const result = await generateEnhancedInsight({
        habits: habitData,
        tasksCompleted,
        totalTasks,
        daysUntilEndOfYear: getDaysUntilEndOfYear(selectedDate),
        reflection,
        analytics,
        personalization: {
          tone: profile?.ai_tone || 'stoic',
          personalContext: profile?.personal_context || undefined,
        },
      });

      setInsight(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate insight');
    } finally {
      setLoading(false);
    }
  }, [habits, completedHabits, streaks, tasksCompleted, totalTasks, selectedDate, reflection, dailyData, profile?.ai_tone, profile?.personal_context]);

  const handleGenerate = useCallback(() => {
    // First-time: show context prompt if no context and haven't skipped
    if (!insight && !hasPersonalContext && hasSkippedPrompt === false) {
      setShowContextPrompt(true);
      return;
    }
    doGenerate();
  }, [insight, hasPersonalContext, hasSkippedPrompt, doGenerate]);

  const handleSkipContext = () => {
    setHasSkippedPrompt(true);
    // Remembering the choice is a convenience; failing to is not worth an error.
    void setMeta('skippedContextPrompt', true).catch(() => undefined);
    setShowContextPrompt(false);
    doGenerate();
  };

  const handleSaveContext = () => {
    if (contextInput.trim()) {
      updateProfile({ personal_context: contextInput.trim() });
    }
    setShowContextPrompt(false);
    doGenerate();
  };

  if (!hasApiKey) {
    return null;
  }

  // Show context prompt instead of normal UI
  if (showContextPrompt) {
    return (
      <div className="bg-bg-card rounded border border-border p-4">
        <div className="text-xs font-medium text-text-secondary uppercase tracking-caps mb-3">
          ai insight
        </div>
        <div className="space-y-3">
          <div>
            <div className="text-sm text-text mb-1">Want better insights?</div>
            <div className="text-xs text-text-muted">
              Tell me what you are working on - health goals,
              struggles, what matters to you this year.
            </div>
          </div>
          <textarea
            value={contextInput}
            onChange={e => setContextInput(e.target.value)}
            placeholder="health goals, struggles, priorities..."
            className="w-full px-2 py-1.5 font-read text-base rounded border border-border bg-transparent text-text focus:border-accent outline-none resize-none"
            rows={3}
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={handleSkipContext}
              className="px-3 py-1.5 text-xs text-text-muted hover:text-text transition-colors"
            >
              skip for now
            </button>
            <button
              onClick={handleSaveContext}
              className="px-3 py-1.5 text-xs text-accent transition-colors"
            >
              save and get insight
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-bg-card rounded border border-border p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium text-text-secondary uppercase tracking-caps">
          ai insight
        </span>
        <button
          onClick={handleGenerate}
          disabled={loading}
          className="text-xs text-text-muted hover:text-accent disabled:opacity-50 transition-colors"
        >
          {loading ? 'thinking...' : insight ? 'refresh' : 'generate'}
        </button>
      </div>

      {error && (
        <div className="text-xs text-error">{error}</div>
      )}

      {insight && !error && (
        <div className="text-sm text-text-secondary leading-relaxed">
          {insight}
        </div>
      )}

      {!insight && !error && !loading && (
        <div className="text-xs text-text-muted">
          click generate for a personalized insight
        </div>
      )}
    </div>
  );
}
