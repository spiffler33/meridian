/**
 * Tower's arithmetic: what is most urgent, how old a thing is, and what to call
 * a date on it.
 *
 * Lifted out of the view because none of it touches React. `dueLabel` was
 * called `formatDate` here, which shadowed the exported `formatDate` in
 * `./dates` — two different signatures answering to one name in one import
 * graph.
 */

import type { TowerItem } from '../types';

/**
 * Smart sorting for active items using isEvent-aware logic:
 *
 * Priority order:
 * 1. Overdue actions (deadline passed) - MUST do
 * 2. Actions due today - urgent
 * 3. Stale actions (no date) - actionable NOW, sorted by staleness
 * 4. Events TODAY - time-bound reminders
 * 5. Actions due within 3 days - approaching deadlines
 * 6. Events tomorrow - advance notice
 * 7. Actions 4-7 days out
 * 8. Future items (>7 days for actions, >1 day for events)
 *
 * Key insight: Stale actions beat same-day events because actions
 * are immediately actionable, while events are time-bound.
 */
export function sortByUrgency(items: TowerItem[]): TowerItem[] {
  const today = new Date();

  // Helper to get days until date
  const daysUntil = (dateStr: string | undefined): number | null => {
    if (!dateStr) return null;
    const target = new Date(dateStr);
    const diff = target.getTime() - today.getTime();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  };

  // Helper to get staleness (days since last touched)
  const staleness = (item: TowerItem): number => {
    const touched = new Date(item.lastTouched);
    const diff = today.getTime() - touched.getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  };

  // Assign priority bucket to each item
  const getPriority = (item: TowerItem): number => {
    const days = daysUntil(item.expectsBy);
    const isEvent = item.isEvent ?? false;

    // Actions (isEvent: false)
    if (!isEvent) {
      if (days !== null) {
        if (days < 0) return 0;  // Overdue - highest priority
        if (days === 0) return 1;  // Due today
        if (days <= 3) return 4;  // Due soon
        if (days <= 7) return 6;  // This week
        return 7;  // Far future
      }
      return 2;  // No date - stale actions are actionable NOW
    }

    // Events (isEvent: true)
    if (days !== null) {
      if (days <= 0) return 3;  // Event today (or past)
      if (days === 1) return 5;  // Event tomorrow
      return 7;  // Future events hidden
    }
    return 2;  // Event with no date (rare, treat as stale)
  };

  return [...items].sort((a, b) => {
    const priorityA = getPriority(a);
    const priorityB = getPriority(b);

    // Different priority buckets - sort by bucket
    if (priorityA !== priorityB) {
      return priorityA - priorityB;
    }

    // Same bucket - secondary sorting
    const daysA = daysUntil(a.expectsBy);
    const daysB = daysUntil(b.expectsBy);

    // For items with dates, sort by date
    if (daysA !== null && daysB !== null) {
      return daysA - daysB;
    }

    // For no-date items (stale bucket), sort by staleness (older first)
    if (daysA === null && daysB === null) {
      return staleness(b) - staleness(a);  // More stale = higher priority
    }

    // Items with dates before items without
    return daysA !== null ? -1 : 1;
  });
}

export function getAge(timestamp: string): string {
  const now = new Date();
  const created = new Date(timestamp);
  const diffMs = now.getTime() - created.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays <= 0) return 'today';
  if (diffDays === 1) return '1d ago';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return `${Math.floor(diffDays / 30)}mo ago`;
}

export function dueLabel(dateStr: string, isEvent?: boolean): string {
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  const tomorrowStr = new Date(today.getTime() + 86400000).toISOString().split('T')[0];

  if (dateStr === todayStr) return 'today';
  if (dateStr === tomorrowStr) return 'tomorrow';

  const date = new Date(dateStr);
  const day = date.toLocaleDateString('en-US', { weekday: 'short' }).toLowerCase();
  const month = date.toLocaleDateString('en-US', { month: 'short' }).toLowerCase();
  const dayNum = date.getDate();

  // For events, show more context
  if (isEvent) {
    return `${day} ${dayNum} ${month}`;
  }

  return day;
}
