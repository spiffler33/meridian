/**
 * Claude API Service
 *
 * Client-side integration with Claude API for daily insights.
 * The API key lives in the IndexedDB `meta` store: device-local, and the one
 * store that is never journalled, so it cannot reach the data repo.
 */

import type { HistoricalAnalytics, HabitAnalytics } from '../utils/analytics';
import { deleteMeta, getMeta, setMeta } from '../lib/db';

// Local cache to avoid repeated reads
let cachedApiKey: string | null = null;

export type AiTone = 'stoic' | 'friendly' | 'wise';

export interface PersonalizationOptions {
  tone: AiTone;
  personalContext?: string;
}

const TONE_INSTRUCTIONS: Record<AiTone, string> = {
  stoic: 'You are a stoic, Naval Ravikant-inspired life coach. Minimal words. Focus on leverage and compound effects.',
  friendly: 'You are a warm, supportive coach. Acknowledge struggles. Focus on leverage with encouragement.',
  wise: 'You are a thoughtful friend who happens to be wise. Conversational tone. Share insights like with a close friend.',
};

export async function saveApiKey(key: string): Promise<void> {
  await setMeta('claudeApiKey', key);
  cachedApiKey = key.length > 0 ? key : null;
}

export async function loadApiKey(): Promise<string> {
  if (cachedApiKey !== null) return cachedApiKey;

  const stored = await getMeta<string>('claudeApiKey', '');
  // Only a real key is cached. Caching the empty string turned "no key yet"
  // into a permanent answer: one saved in another tab would never be read.
  if (stored.length > 0) cachedApiKey = stored;
  return stored;
}

export async function clearApiKey(): Promise<void> {
  await deleteMeta('claudeApiKey');
  cachedApiKey = null;
}

// Drop the cached key so the next read goes back to the store
export function clearApiKeyCache(): void {
  cachedApiKey = null;
}

interface HabitData {
  name: string;
  completed: boolean;
  streak: number;
}

interface DayInsightRequest {
  habits: HabitData[];
  tasksCompleted: number;
  totalTasks: number;
  daysUntilEndOfYear: number;
  reflection?: string;
}

export interface EnhancedInsightRequest extends DayInsightRequest {
  analytics: HistoricalAnalytics;
  personalization?: PersonalizationOptions;
}

/**
 * Generate a personalized daily insight using Claude
 */
export async function generateDailyInsight(data: DayInsightRequest): Promise<string> {
  const apiKey = await loadApiKey();
  if (!apiKey) {
    throw new Error('No API key configured');
  }

  const habitSummary = data.habits
    .map(h => `${h.name}: ${h.completed ? '✓' : '✗'}${h.streak > 0 ? ` (${h.streak}d streak)` : ''}`)
    .join('\n');

  const prompt = `You are a stoic, Naval Ravikant-inspired life coach. Be extremely brief (2-3 sentences max). No fluff, no emojis. Give one sharp insight based on this data:

Habits today:
${habitSummary}

Tasks: ${data.tasksCompleted}/${data.totalTasks}
Days left this year: ${data.daysUntilEndOfYear}
${data.reflection ? `Reflection: "${data.reflection}"` : ''}

Give one actionable insight. Focus on leverage, compound effects, or what matters most today. Be direct.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-3-haiku-20240307',
      max_tokens: 150,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: `HTTP ${response.status}` } }));
    throw new Error(error.error?.message || `API request failed (${response.status})`);
  }

  const result = await response.json();
  return result.content[0]?.text || 'No insight generated.';
}

/**
 * Format trend as arrow symbol
 */
function formatTrend(trend: 'up' | 'down' | 'stable'): string {
  if (trend === 'up') return '↑';
  if (trend === 'down') return '↓';
  return '→';
}

/**
 * Format day-of-week rates compactly
 */
function formatDowRates(rates: Record<string, number>): string {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return days.map(d => `${d}:${rates[d] || 0}`).join(' ');
}

/**
 * Format habit analytics for prompt (token-efficient)
 */
function formatHabitAnalytics(habits: HabitAnalytics[]): string {
  return habits
    .map(h => {
      const trend = formatTrend(h.trend);
      const dow = formatDowRates(h.dayOfWeekRates);
      return `• ${h.name}: ${h.completionRate}% (${trend}) streak:${h.currentStreak}d best:${h.bestStreak}d | ${dow}`;
    })
    .join('\n');
}

/**
 * Format analytics section for prompt
 */
function formatAnalyticsPrompt(analytics: HistoricalAnalytics): string {
  const sections: string[] = [];

  // Habit performance
  sections.push(`Habit Performance (${analytics.periodDays}d):\n${formatHabitAnalytics(analytics.habits)}`);

  // Correlations (if any)
  if (analytics.correlations.length > 0) {
    const corrLines = analytics.correlations
      .map(c => `• ${c.habitA} + ${c.habitB}: ${c.correlation}%`)
      .join('\n');
    sections.push(`Correlations (habits done together):\n${corrLines}`);
  }

  // Day patterns
  const dp = analytics.dayPatterns;
  sections.push(
    `Weekly Pattern:\n• Best: ${dp.bestDay}, Worst: ${dp.worstDay}\n• Weekdays: ${dp.weekdayAvg}% vs Weekends: ${dp.weekendAvg}%`
  );

  // Recent reflections
  if (analytics.recentReflections.length > 0) {
    const reflections = analytics.recentReflections.map(r => `• "${r}"`).join('\n');
    sections.push(`Recent reflections:\n${reflections}`);
  }

  return sections.join('\n\n');
}

/**
 * Generate enhanced insight with historical analytics
 */
export async function generateEnhancedInsight(data: EnhancedInsightRequest): Promise<string> {
  const apiKey = await loadApiKey();
  if (!apiKey) {
    throw new Error('No API key configured');
  }

  const habitSummary = data.habits
    .map(h => `${h.name}: ${h.completed ? '✓' : '✗'}${h.streak > 0 ? ` (${h.streak}d)` : ''}`)
    .join(', ');

  const analyticsSection = formatAnalyticsPrompt(data.analytics);

  // Get tone instruction (default to stoic)
  const tone = data.personalization?.tone || 'stoic';
  const toneInstruction = TONE_INSTRUCTIONS[tone];

  // Build personal context section if available
  const personalContextSection = data.personalization?.personalContext
    ? `\nABOUT THIS PERSON:\n${data.personalization.personalContext}\n`
    : '';

  const prompt = `${toneInstruction} Be extremely brief (2-3 sentences max). No fluff, no emojis.
${personalContextSection}
TODAY:
Habits: ${habitSummary}
Tasks: ${data.tasksCompleted}/${data.totalTasks}
Days left this year: ${data.daysUntilEndOfYear}
${data.reflection ? `Reflection: "${data.reflection}"` : ''}

HISTORICAL ANALYTICS:
${analyticsSection}

Based on both today's status AND the historical patterns, give one sharp insight. Look for:
- Day-of-week patterns (best/worst days)
- Habit correlations (which habits cluster)
- Trends (improving/declining habits)
- Weekend vs weekday differences

Focus on leverage and what action today would have compound effects. Be direct.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-3-haiku-20240307',
      max_tokens: 200,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: `HTTP ${response.status}` } }));
    throw new Error(error.error?.message || `API request failed (${response.status})`);
  }

  const result = await response.json();
  return result.content[0]?.text || 'No insight generated.';
}
