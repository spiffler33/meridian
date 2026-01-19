/**
 * AI Service - Claude API Integration via Supabase Edge Function
 *
 * Parses natural language into structured tower items.
 * Calls Edge Function to avoid CORS and keep API key server-side.
 */

import { supabase } from './supabase';
import type { TowerItemInput } from './data';

/**
 * Parsed result from AI with confidence indicator
 */
export interface ParsedTowerItem {
  text: string;
  status: 'active' | 'waiting' | 'someday';
  waitingOn?: string;
  expectsBy?: string;
  effort?: 'quick' | 'medium' | 'deep';
  isEvent?: boolean;  // false = action, true = event
}

/**
 * Parse user input into structured tower items (can return multiple from one brain dump)
 *
 * Design: Trust Claude for rambling/messy input, or save as-is.
 * Calls Supabase Edge Function to avoid CORS and keep API key secure.
 */
export async function parseTowerInput(userInput: string): Promise<ParsedTowerItem[]> {
  const trimmed = userInput.trim();

  try {
    // Call Edge Function (handles Claude API server-side)
    const { data, error } = await supabase.functions.invoke('parse-task', {
      body: { input: userInput },
    });

    if (error) {
      console.error('Edge function error:', error);
      return [{ text: trimmed, status: 'active' }];
    }

    if (data.error) {
      console.log('Parse service error:', data.error);
      return [{ text: trimmed, status: 'active' }];
    }

    console.log('Parsed results:', data);

    // Handle array of items
    const items = data.items || [data];
    return items.map((item: unknown) => validateParsedItem(item, trimmed));
  } catch (err) {
    console.error('AI parsing failed:', err);
    return [{ text: trimmed, status: 'active' }];
  }
}

/**
 * Validate and sanitize parsed item
 */
function validateParsedItem(parsed: unknown, fallbackText: string): ParsedTowerItem {
  const result: ParsedTowerItem = {
    text: fallbackText.trim(),
    status: 'active',
    isEvent: false,
  };

  if (typeof parsed !== 'object' || parsed === null) {
    return result;
  }

  const p = parsed as Record<string, unknown>;

  // Text
  if (typeof p.text === 'string' && p.text.trim()) {
    result.text = p.text.trim();
  }

  // Status
  if (p.status === 'active' || p.status === 'waiting' || p.status === 'someday') {
    result.status = p.status;
  }

  // WaitingOn (only if status is waiting)
  if (result.status === 'waiting' && typeof p.waitingOn === 'string' && p.waitingOn.trim()) {
    result.waitingOn = p.waitingOn.trim();
  }

  // ExpectsBy (validate date format)
  if (typeof p.expectsBy === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.expectsBy)) {
    result.expectsBy = p.expectsBy;
  }

  // Effort
  if (p.effort === 'quick' || p.effort === 'medium' || p.effort === 'deep') {
    result.effort = p.effort;
  }

  // isEvent (default to false)
  if (typeof p.isEvent === 'boolean') {
    result.isEvent = p.isEvent;
  } else {
    result.isEvent = false;
  }

  return result;
}

/**
 * Generate "Why this?" explanation for a tower item
 * Uses thoughtful fallback logic - no AI needed for this
 */
export function explainWhyThis(
  item: { text: string; createdAt: string; expectsBy?: string; effort?: string; lastTouched: string; isEvent?: boolean },
  queuePosition: number
): string {
  return generateFallbackExplanation({ text: item.text, createdAt: item.createdAt, expectsBy: item.expectsBy, isEvent: item.isEvent }, queuePosition);
}

/**
 * Fallback explanation when AI is unavailable - more thoughtful
 */
function generateFallbackExplanation(
  item: { text: string; createdAt: string; expectsBy?: string; isEvent?: boolean },
  queuePosition: number
): string {
  const today = new Date();
  const created = new Date(item.createdAt);
  const daysOld = Math.floor((today.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));

  // Event-specific explanations
  if (item.isEvent && item.expectsBy) {
    const deadline = new Date(item.expectsBy);
    const daysUntil = Math.ceil((deadline.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    if (daysUntil < 0) {
      return `This was ${Math.abs(daysUntil)} day${Math.abs(daysUntil) === 1 ? '' : 's'} ago. Did you miss it, or should this be cleared?`;
    }
    if (daysUntil === 0) {
      return 'Happening today. This is your reminder.';
    }
    if (daysUntil === 1) {
      return 'Tomorrow. Heads up so you can prepare.';
    }
    return `Coming up in ${daysUntil} days. Showing early so it doesn't surprise you.`;
  }

  // Deadline-based reasoning
  if (item.expectsBy) {
    const deadline = new Date(item.expectsBy);
    const daysUntil = Math.ceil((deadline.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (daysUntil < 0) {
      return `This was expected ${Math.abs(daysUntil)} day${Math.abs(daysUntil) === 1 ? '' : 's'} ago. The longer it waits, the harder the conversation becomes.`;
    }
    if (daysUntil === 0) {
      return 'Expected today. Better to act while the context is fresh.';
    }
    if (daysUntil === 1) {
      return 'Due tomorrow. Handling it now means one less thing weighing on you.';
    }
    if (daysUntil <= 3) {
      return `Due in ${daysUntil} days. Early action prevents last-minute stress.`;
    }
  }

  // Age-based reasoning
  if (daysOld === 0) {
    if (queuePosition === 0) {
      return 'Fresh capture. Strike while the intent is clear.';
    }
    return 'Added today. Still has momentum from when you captured it.';
  }

  if (daysOld === 1) {
    return 'From yesterday. The gap between intention and action is still small.';
  }

  if (daysOld <= 3) {
    return `Waiting ${daysOld} days. Each day it sits, the activation energy grows.`;
  }

  if (daysOld <= 7) {
    return `A week-old open loop. Your brain is spending cycles remembering this exists.`;
  }

  return `${daysOld} days in limbo. Either do it, delegate it, or delete it.`;
}

/**
 * Convert ParsedTowerItem to TowerItemInput
 */
export function toTowerItemInput(parsed: ParsedTowerItem): TowerItemInput {
  return {
    text: parsed.text,
    status: parsed.status,
    waitingOn: parsed.waitingOn,
    expectsBy: parsed.expectsBy,
    effort: parsed.effort,
    isEvent: parsed.isEvent,
  };
}
