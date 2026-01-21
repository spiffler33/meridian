/**
 * Data Service Layer
 *
 * Replaces localStorage with Supabase for all data operations.
 * All functions work with the authenticated user and return typed data.
 */

import { supabase } from './supabase';
import type {
  Profile,
  Habit,
  DailyEntry,
  HabitCompletion,
  Task,
  YearTheme,
  TowerItemRow,
  UpdateTables,
  Pack as PackRow,
  PackSession as PackSessionRow,
} from '../types/database';
import type { HabitCategory, MitCategory, TowerStatus, TowerEffort, TowerItem, Pack, PackSession, PackWithCount } from '../types';

// ============================================================================
// Error Handling
// ============================================================================

class DataServiceError extends Error {
  code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'DataServiceError';
    this.code = code;
  }
}

async function getCurrentUserId(): Promise<string> {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) {
    throw new DataServiceError(`Authentication error: ${error.message}`, error.code);
  }
  if (!user) {
    throw new DataServiceError('User not authenticated', 'NOT_AUTHENTICATED');
  }
  return user.id;
}

// ============================================================================
// Input Types
// ============================================================================

export interface HabitInput {
  label: string;
  description?: string | null;
  category: HabitCategory;
  emoji?: string | null;
}

export interface TaskInput {
  date: string;
  category: MitCategory;
  text: string;
  firstStep?: string | null;
}

export interface TowerItemInput {
  text: string;
  status?: TowerStatus;
  waitingOn?: string | null;
  expectsBy?: string | null;
  effort?: TowerEffort | null;
  isEvent?: boolean;
}

// ============================================================================
// Habits
// ============================================================================

/**
 * Get all habits for the current user (non-archived by default)
 */
export async function getHabits(includeArchived = false): Promise<Habit[]> {
  const userId = await getCurrentUserId();

  let query = supabase
    .from('habits')
    .select('*')
    .eq('user_id', userId)
    .order('sort_order', { ascending: true });

  if (!includeArchived) {
    query = query.is('archived_at', null);
  }

  const { data, error } = await query;

  if (error) {
    throw new DataServiceError(`Failed to fetch habits: ${error.message}`, error.code);
  }

  return data || [];
}

/**
 * Create a new habit
 */
export async function createHabit(habit: HabitInput): Promise<Habit> {
  const userId = await getCurrentUserId();

  // Get the highest sort_order to append at the end
  const { data: existingHabits } = await supabase
    .from('habits')
    .select('sort_order')
    .eq('user_id', userId)
    .order('sort_order', { ascending: false })
    .limit(1);

  const nextSortOrder = existingHabits && existingHabits.length > 0
    ? existingHabits[0].sort_order + 1
    : 0;

  const { data, error } = await supabase
    .from('habits')
    .insert({
      user_id: userId,
      label: habit.label,
      description: habit.description ?? null,
      category: habit.category,
      emoji: habit.emoji ?? null,
      sort_order: nextSortOrder,
    })
    .select()
    .single();

  if (error) {
    throw new DataServiceError(`Failed to create habit: ${error.message}`, error.code);
  }

  return data;
}

/**
 * Update an existing habit
 */
export async function updateHabit(id: string, updates: Partial<Omit<Habit, 'id' | 'user_id' | 'created_at'>>): Promise<Habit> {
  const userId = await getCurrentUserId();

  const { data, error } = await supabase
    .from('habits')
    .update(updates)
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) {
    throw new DataServiceError(`Failed to update habit: ${error.message}`, error.code);
  }

  return data;
}

/**
 * Delete a habit (soft delete by archiving)
 */
export async function deleteHabit(id: string): Promise<void> {
  const userId = await getCurrentUserId();

  const { error } = await supabase
    .from('habits')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId);

  if (error) {
    throw new DataServiceError(`Failed to delete habit: ${error.message}`, error.code);
  }
}

/**
 * Reorder habits by providing the new order of habit IDs
 */
export async function reorderHabits(habitIds: string[]): Promise<void> {
  const userId = await getCurrentUserId();

  // Update each habit's sort_order based on its position in the array
  const updates = habitIds.map((id, index) =>
    supabase
      .from('habits')
      .update({ sort_order: index })
      .eq('id', id)
      .eq('user_id', userId)
  );

  const results = await Promise.all(updates);

  const errors = results.filter(r => r.error);
  if (errors.length > 0) {
    throw new DataServiceError(`Failed to reorder habits: ${errors[0].error?.message}`, errors[0].error?.code);
  }
}

// ============================================================================
// Daily Entries (focus + reflection)
// ============================================================================

/**
 * Get the daily entry for a specific date
 */
export async function getDailyEntry(date: string): Promise<DailyEntry | null> {
  const userId = await getCurrentUserId();

  const { data, error } = await supabase
    .from('daily_entries')
    .select('*')
    .eq('user_id', userId)
    .eq('date', date)
    .maybeSingle();

  if (error) {
    throw new DataServiceError(`Failed to fetch daily entry: ${error.message}`, error.code);
  }

  return data;
}

/**
 * Create or update a daily entry
 */
export async function upsertDailyEntry(
  date: string,
  data: { focus?: string; reflection?: string }
): Promise<DailyEntry> {
  const userId = await getCurrentUserId();

  const { data: result, error } = await supabase
    .from('daily_entries')
    .upsert(
      {
        user_id: userId,
        date,
        focus: data.focus,
        reflection: data.reflection,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: 'user_id,date',
      }
    )
    .select()
    .single();

  if (error) {
    throw new DataServiceError(`Failed to upsert daily entry: ${error.message}`, error.code);
  }

  return result;
}

// ============================================================================
// Habit Completions
// ============================================================================

/**
 * Get all habit completions within a date range
 */
export async function getCompletions(startDate: string, endDate: string): Promise<HabitCompletion[]> {
  const userId = await getCurrentUserId();

  const { data, error } = await supabase
    .from('habit_completions')
    .select('*')
    .eq('user_id', userId)
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date', { ascending: true });

  if (error) {
    throw new DataServiceError(`Failed to fetch completions: ${error.message}`, error.code);
  }

  return data || [];
}

/**
 * Get habit completions for a specific date as a map of habitId -> completed
 */
export async function getCompletionsForDate(date: string): Promise<Record<string, boolean>> {
  const userId = await getCurrentUserId();

  const { data, error } = await supabase
    .from('habit_completions')
    .select('habit_id')
    .eq('user_id', userId)
    .eq('date', date);

  if (error) {
    throw new DataServiceError(`Failed to fetch completions for date: ${error.message}`, error.code);
  }

  // Convert to a map of habitId -> true (presence indicates completion)
  const completions: Record<string, boolean> = {};
  (data || []).forEach(row => {
    completions[row.habit_id] = true;
  });

  return completions;
}

/**
 * Toggle a habit completion for a specific date
 */
export async function toggleCompletion(
  habitId: string,
  date: string,
  completed: boolean
): Promise<void> {
  const userId = await getCurrentUserId();

  if (completed) {
    // Insert a completion record
    const { error } = await supabase
      .from('habit_completions')
      .upsert(
        {
          user_id: userId,
          habit_id: habitId,
          date,
        },
        {
          onConflict: 'user_id,habit_id,date',
        }
      );

    if (error) {
      throw new DataServiceError(`Failed to mark habit complete: ${error.message}`, error.code);
    }
  } else {
    // Delete the completion record
    const { error } = await supabase
      .from('habit_completions')
      .delete()
      .eq('user_id', userId)
      .eq('habit_id', habitId)
      .eq('date', date);

    if (error) {
      throw new DataServiceError(`Failed to mark habit incomplete: ${error.message}`, error.code);
    }
  }
}

// ============================================================================
// Tasks (MITs)
// ============================================================================

/**
 * Get all tasks for a specific date
 */
export async function getTasks(date: string): Promise<Task[]> {
  const userId = await getCurrentUserId();

  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('user_id', userId)
    .eq('date', date)
    .order('category', { ascending: true })
    .order('sort_order', { ascending: true });

  if (error) {
    throw new DataServiceError(`Failed to fetch tasks: ${error.message}`, error.code);
  }

  return data || [];
}

/**
 * Get all tasks within a date range
 */
export async function getTasksRange(startDate: string, endDate: string): Promise<Task[]> {
  const userId = await getCurrentUserId();

  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('user_id', userId)
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date', { ascending: true })
    .order('category', { ascending: true })
    .order('sort_order', { ascending: true });

  if (error) {
    throw new DataServiceError(`Failed to fetch tasks range: ${error.message}`, error.code);
  }

  return data || [];
}

/**
 * Create a new task
 */
export async function createTask(task: TaskInput): Promise<Task> {
  const userId = await getCurrentUserId();

  // Get the highest sort_order for this date/category to append at the end
  const { data: existingTasks } = await supabase
    .from('tasks')
    .select('sort_order')
    .eq('user_id', userId)
    .eq('date', task.date)
    .eq('category', task.category)
    .order('sort_order', { ascending: false })
    .limit(1);

  const nextSortOrder = existingTasks && existingTasks.length > 0
    ? existingTasks[0].sort_order + 1
    : 0;

  const { data, error } = await supabase
    .from('tasks')
    .insert({
      user_id: userId,
      date: task.date,
      category: task.category,
      text: task.text,
      first_step: task.firstStep ?? null,
      sort_order: nextSortOrder,
      completed: false,
    })
    .select()
    .single();

  if (error) {
    throw new DataServiceError(`Failed to create task: ${error.message}`, error.code);
  }

  return data;
}

/**
 * Update an existing task
 */
export async function updateTask(
  id: string,
  updates: Partial<Omit<Task, 'id' | 'user_id' | 'created_at'>>
): Promise<Task> {
  const userId = await getCurrentUserId();

  // If marking as completed, set completed_at timestamp
  const updateData: UpdateTables<'tasks'> = { ...updates };
  if (updates.completed === true && !updates.completed_at) {
    updateData.completed_at = new Date().toISOString();
  } else if (updates.completed === false) {
    updateData.completed_at = null;
  }

  const { data, error } = await supabase
    .from('tasks')
    .update(updateData)
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) {
    throw new DataServiceError(`Failed to update task: ${error.message}`, error.code);
  }

  return data;
}

/**
 * Delete a task
 */
export async function deleteTask(id: string): Promise<void> {
  const userId = await getCurrentUserId();

  const { error } = await supabase
    .from('tasks')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);

  if (error) {
    throw new DataServiceError(`Failed to delete task: ${error.message}`, error.code);
  }
}

// ============================================================================
// Year Themes
// ============================================================================

/**
 * Get the theme for a specific year
 */
export async function getYearTheme(year: number): Promise<string | null> {
  const userId = await getCurrentUserId();

  const { data, error } = await supabase
    .from('year_themes')
    .select('theme')
    .eq('user_id', userId)
    .eq('year', year)
    .maybeSingle();

  if (error) {
    throw new DataServiceError(`Failed to fetch year theme: ${error.message}`, error.code);
  }

  return data?.theme ?? null;
}

/**
 * Set the theme for a specific year
 */
export async function setYearTheme(year: number, theme: string): Promise<void> {
  const userId = await getCurrentUserId();

  const { error } = await supabase
    .from('year_themes')
    .upsert(
      {
        user_id: userId,
        year,
        theme,
      },
      {
        onConflict: 'user_id,year',
      }
    );

  if (error) {
    throw new DataServiceError(`Failed to set year theme: ${error.message}`, error.code);
  }
}

// ============================================================================
// Profile
// ============================================================================

/**
 * Get the current user's profile
 */
export async function getProfile(): Promise<Profile> {
  const userId = await getCurrentUserId();

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (error) {
    throw new DataServiceError(`Failed to fetch profile: ${error.message}`, error.code);
  }

  return data;
}

/**
 * Update the current user's profile
 */
export async function updateProfile(
  updates: Partial<Omit<Profile, 'id' | 'created_at'>>
): Promise<Profile> {
  const userId = await getCurrentUserId();

  const { data, error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', userId)
    .select()
    .single();

  if (error) {
    throw new DataServiceError(`Failed to update profile: ${error.message}`, error.code);
  }

  return data;
}

// ============================================================================
// Bulk Data Loading
// ============================================================================

/**
 * Load all data needed for app initialization
 */
export async function loadAllData(): Promise<{
  habits: Habit[];
  profile: Profile;
}> {
  const userId = await getCurrentUserId();

  // Fetch habits and profile in parallel
  const [habitsResult, profileResult] = await Promise.all([
    supabase
      .from('habits')
      .select('*')
      .eq('user_id', userId)
      .is('archived_at', null)
      .order('sort_order', { ascending: true }),
    supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single(),
  ]);

  if (habitsResult.error) {
    throw new DataServiceError(`Failed to load habits: ${habitsResult.error.message}`, habitsResult.error.code);
  }

  if (profileResult.error) {
    throw new DataServiceError(`Failed to load profile: ${profileResult.error.message}`, profileResult.error.code);
  }

  return {
    habits: habitsResult.data || [],
    profile: profileResult.data,
  };
}

// ============================================================================
// Analytics Helper
// ============================================================================

/**
 * Get all daily data for a date range (for analytics)
 */
export async function getDailyDataRange(
  startDate: string,
  endDate: string
): Promise<{
  entries: DailyEntry[];
  completions: HabitCompletion[];
  tasks: Task[];
}> {
  const userId = await getCurrentUserId();

  // Fetch all data in parallel
  const [entriesResult, completionsResult, tasksResult] = await Promise.all([
    supabase
      .from('daily_entries')
      .select('*')
      .eq('user_id', userId)
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: true }),
    supabase
      .from('habit_completions')
      .select('*')
      .eq('user_id', userId)
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: true }),
    supabase
      .from('tasks')
      .select('*')
      .eq('user_id', userId)
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: true }),
  ]);

  if (entriesResult.error) {
    throw new DataServiceError(`Failed to load daily entries: ${entriesResult.error.message}`, entriesResult.error.code);
  }

  if (completionsResult.error) {
    throw new DataServiceError(`Failed to load completions: ${completionsResult.error.message}`, completionsResult.error.code);
  }

  if (tasksResult.error) {
    throw new DataServiceError(`Failed to load tasks: ${tasksResult.error.message}`, tasksResult.error.code);
  }

  return {
    entries: entriesResult.data || [],
    completions: completionsResult.data || [],
    tasks: tasksResult.data || [],
  };
}

// ============================================================================
// Additional Utility Functions
// ============================================================================

/**
 * Get all year themes for the current user
 */
export async function getAllYearThemes(): Promise<YearTheme[]> {
  const userId = await getCurrentUserId();

  const { data, error } = await supabase
    .from('year_themes')
    .select('*')
    .eq('user_id', userId)
    .order('year', { ascending: false });

  if (error) {
    throw new DataServiceError(`Failed to fetch year themes: ${error.message}`, error.code);
  }

  return data || [];
}

/**
 * Delete a year theme
 */
export async function deleteYearTheme(year: number): Promise<void> {
  const userId = await getCurrentUserId();

  const { error } = await supabase
    .from('year_themes')
    .delete()
    .eq('user_id', userId)
    .eq('year', year);

  if (error) {
    throw new DataServiceError(`Failed to delete year theme: ${error.message}`, error.code);
  }
}

/**
 * Restore an archived habit
 */
export async function restoreHabit(id: string): Promise<Habit> {
  const userId = await getCurrentUserId();

  const { data, error } = await supabase
    .from('habits')
    .update({ archived_at: null })
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) {
    throw new DataServiceError(`Failed to restore habit: ${error.message}`, error.code);
  }

  return data;
}

/**
 * Get streak information for a habit
 * Returns the current streak and longest streak
 */
export async function getHabitStreak(habitId: string): Promise<{ current: number; longest: number }> {
  const userId = await getCurrentUserId();

  // Get all completions for this habit, ordered by date descending
  const { data, error } = await supabase
    .from('habit_completions')
    .select('date')
    .eq('user_id', userId)
    .eq('habit_id', habitId)
    .order('date', { ascending: false });

  if (error) {
    throw new DataServiceError(`Failed to fetch habit streak: ${error.message}`, error.code);
  }

  if (!data || data.length === 0) {
    return { current: 0, longest: 0 };
  }

  const dates = data.map(d => d.date).sort((a, b) => b.localeCompare(a));
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

  let currentStreak = 0;
  let longestStreak = 0;
  let tempStreak = 1;

  // Check if streak is current (today or yesterday)
  const isCurrentStreak = dates[0] === today || dates[0] === yesterday;

  for (let i = 0; i < dates.length; i++) {
    if (i === 0) {
      tempStreak = 1;
      continue;
    }

    const prevDate = new Date(dates[i - 1]);
    const currDate = new Date(dates[i]);
    const diffDays = Math.floor((prevDate.getTime() - currDate.getTime()) / 86400000);

    if (diffDays === 1) {
      tempStreak++;
    } else {
      if (i === 1 && isCurrentStreak) {
        currentStreak = 1; // Streak broken, only today/yesterday counts
      }
      longestStreak = Math.max(longestStreak, tempStreak);
      tempStreak = 1;
    }
  }

  longestStreak = Math.max(longestStreak, tempStreak);

  if (isCurrentStreak && currentStreak === 0) {
    currentStreak = tempStreak;
  }

  return { current: currentStreak, longest: longestStreak };
}

/**
 * Get all completion dates for a habit
 * Returns an array of date strings (YYYY-MM-DD)
 */
export async function getHabitCompletionDates(habitId: string): Promise<string[]> {
  const userId = await getCurrentUserId();

  const { data, error } = await supabase
    .from('habit_completions')
    .select('date')
    .eq('user_id', userId)
    .eq('habit_id', habitId)
    .order('date', { ascending: false });

  if (error) {
    throw new DataServiceError(`Failed to fetch habit completions: ${error.message}`, error.code);
  }

  return (data || []).map(d => d.date);
}

// ============================================================================
// Tower Items
// ============================================================================

/**
 * Convert database row to domain model
 */
function toTowerItem(row: TowerItemRow): TowerItem {
  return {
    id: row.id,
    text: row.text,
    status: row.status,
    waitingOn: row.waiting_on ?? undefined,
    expectsBy: row.expects_by ?? undefined,
    effort: row.effort ?? undefined,
    isEvent: row.is_event,
    lastTouched: row.last_touched,
    createdAt: row.created_at,
    doneAt: row.done_at ?? undefined,
  };
}

/**
 * Get all tower items for the current user (excludes done by default)
 */
export async function getTowerItems(includeDone = false): Promise<TowerItem[]> {
  const userId = await getCurrentUserId();

  let query = supabase
    .from('tower_items')
    .select('*')
    .eq('user_id', userId);

  if (!includeDone) {
    query = query.neq('status', 'done');
  }

  // Surfacing logic: expects_by ASC (nulls last), then last_touched ASC (oldest first)
  query = query
    .order('expects_by', { ascending: true, nullsFirst: false })
    .order('last_touched', { ascending: true });

  const { data, error } = await query;

  if (error) {
    throw new DataServiceError(`Failed to fetch tower items: ${error.message}`, error.code);
  }

  return (data || []).map(toTowerItem);
}

/**
 * Get tower items by status
 */
export async function getTowerItemsByStatus(status: TowerStatus): Promise<TowerItem[]> {
  const userId = await getCurrentUserId();

  const { data, error } = await supabase
    .from('tower_items')
    .select('*')
    .eq('user_id', userId)
    .eq('status', status)
    .order('expects_by', { ascending: true, nullsFirst: false })
    .order('last_touched', { ascending: true });

  if (error) {
    throw new DataServiceError(`Failed to fetch tower items by status: ${error.message}`, error.code);
  }

  return (data || []).map(toTowerItem);
}

/**
 * Create a new tower item
 */
export async function createTowerItem(item: TowerItemInput): Promise<TowerItem> {
  const userId = await getCurrentUserId();

  const { data, error } = await supabase
    .from('tower_items')
    .insert({
      user_id: userId,
      text: item.text,
      status: item.status ?? 'active',
      waiting_on: item.waitingOn ?? null,
      expects_by: item.expectsBy ?? null,
      effort: item.effort ?? null,
      is_event: item.isEvent ?? false,
    })
    .select()
    .single();

  if (error) {
    throw new DataServiceError(`Failed to create tower item: ${error.message}`, error.code);
  }

  return toTowerItem(data);
}

/**
 * Update a tower item
 */
export async function updateTowerItem(
  id: string,
  updates: Partial<TowerItemInput>
): Promise<TowerItem> {
  const userId = await getCurrentUserId();

  const updateData: UpdateTables<'tower_items'> = {
    last_touched: new Date().toISOString(),
  };

  if (updates.text !== undefined) updateData.text = updates.text;
  if (updates.status !== undefined) updateData.status = updates.status;
  if (updates.waitingOn !== undefined) updateData.waiting_on = updates.waitingOn;
  if (updates.expectsBy !== undefined) updateData.expects_by = updates.expectsBy;
  if (updates.effort !== undefined) updateData.effort = updates.effort;
  if (updates.isEvent !== undefined) updateData.is_event = updates.isEvent;

  const { data, error } = await supabase
    .from('tower_items')
    .update(updateData)
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) {
    throw new DataServiceError(`Failed to update tower item: ${error.message}`, error.code);
  }

  return toTowerItem(data);
}

/**
 * Mark a tower item as done
 */
export async function completeTowerItem(id: string): Promise<TowerItem> {
  const userId = await getCurrentUserId();

  const { data, error } = await supabase
    .from('tower_items')
    .update({
      status: 'done',
      done_at: new Date().toISOString(),
      last_touched: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) {
    throw new DataServiceError(`Failed to complete tower item: ${error.message}`, error.code);
  }

  return toTowerItem(data);
}

/**
 * Delete a tower item permanently
 */
export async function deleteTowerItem(id: string): Promise<void> {
  const userId = await getCurrentUserId();

  const { error } = await supabase
    .from('tower_items')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);

  if (error) {
    throw new DataServiceError(`Failed to delete tower item: ${error.message}`, error.code);
  }
}

// ============================================================================
// Packs
// ============================================================================

/**
 * Convert database row to domain model
 */
function toPack(row: PackRow): Pack {
  return {
    id: row.id,
    label: row.label,
    total: row.total,
    createdAt: row.created_at,
    archivedAt: row.archived_at ?? undefined,
  };
}

/**
 * Convert database row to domain model
 */
function toPackSession(row: PackSessionRow): PackSession {
  return {
    id: row.id,
    packId: row.pack_id,
    date: row.date,
    note: row.note ?? undefined,
    createdAt: row.created_at,
  };
}

export interface PackInput {
  label: string;
  total: number;
}

export interface PackSessionInput {
  packId: string;
  date: string;
  note?: string | null;
}

/**
 * Get all packs for the current user (non-archived by default)
 * Returns packs with their used count
 */
export async function getPacks(includeArchived = false): Promise<PackWithCount[]> {
  const userId = await getCurrentUserId();

  let query = supabase
    .from('packs')
    .select(`
      *,
      pack_sessions(count)
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (!includeArchived) {
    query = query.is('archived_at', null);
  }

  const { data, error } = await query;

  if (error) {
    throw new DataServiceError(`Failed to fetch packs: ${error.message}`, error.code);
  }

  return (data || []).map(row => ({
    ...toPack(row),
    used: (row.pack_sessions as { count: number }[])[0]?.count ?? 0,
  }));
}

/**
 * Create a new pack
 */
export async function createPack(pack: PackInput): Promise<Pack> {
  const userId = await getCurrentUserId();

  const { data, error } = await supabase
    .from('packs')
    .insert({
      user_id: userId,
      label: pack.label,
      total: pack.total,
    })
    .select()
    .single();

  if (error) {
    throw new DataServiceError(`Failed to create pack: ${error.message}`, error.code);
  }

  return toPack(data);
}

/**
 * Update a pack
 */
export async function updatePack(
  id: string,
  updates: Partial<PackInput>
): Promise<Pack> {
  const userId = await getCurrentUserId();

  const { data, error } = await supabase
    .from('packs')
    .update(updates)
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) {
    throw new DataServiceError(`Failed to update pack: ${error.message}`, error.code);
  }

  return toPack(data);
}

/**
 * Archive a pack (soft delete)
 */
export async function archivePack(id: string): Promise<void> {
  const userId = await getCurrentUserId();

  const { error } = await supabase
    .from('packs')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId);

  if (error) {
    throw new DataServiceError(`Failed to archive pack: ${error.message}`, error.code);
  }
}

/**
 * Get all sessions for a pack
 */
export async function getPackSessions(packId: string): Promise<PackSession[]> {
  const { data, error } = await supabase
    .from('pack_sessions')
    .select('*')
    .eq('pack_id', packId)
    .order('date', { ascending: false });

  if (error) {
    throw new DataServiceError(`Failed to fetch pack sessions: ${error.message}`, error.code);
  }

  return (data || []).map(toPackSession);
}

/**
 * Log a new session for a pack
 */
export async function createPackSession(session: PackSessionInput): Promise<PackSession> {
  const { data, error } = await supabase
    .from('pack_sessions')
    .insert({
      pack_id: session.packId,
      date: session.date,
      note: session.note ?? null,
    })
    .select()
    .single();

  if (error) {
    throw new DataServiceError(`Failed to create pack session: ${error.message}`, error.code);
  }

  return toPackSession(data);
}

/**
 * Update a pack session
 */
export async function updatePackSession(
  id: string,
  updates: { date?: string; note?: string | null }
): Promise<PackSession> {
  const updateData: { date?: string; note?: string | null } = {};
  if (updates.date !== undefined) updateData.date = updates.date;
  if (updates.note !== undefined) updateData.note = updates.note;

  const { data, error } = await supabase
    .from('pack_sessions')
    .update(updateData)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw new DataServiceError(`Failed to update pack session: ${error.message}`, error.code);
  }

  return toPackSession(data);
}

/**
 * Delete a pack session
 */
export async function deletePackSession(id: string): Promise<void> {
  const { error } = await supabase
    .from('pack_sessions')
    .delete()
    .eq('id', id);

  if (error) {
    throw new DataServiceError(`Failed to delete pack session: ${error.message}`, error.code);
  }
}

// Re-export types for convenience
export type { Habit, DailyEntry, HabitCompletion, Task, YearTheme, Profile, TowerItemRow } from '../types/database';
