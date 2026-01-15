/**
 * Life Calendar - Core Type Definitions
 *
 * This file defines the data model for the entire app.
 * All data is stored in localStorage and persisted across sessions.
 */

// Unique identifier for habits
export type HabitId = string;

// Categories for organizing habits
export type HabitCategory = 'health' | 'work' | 'family' | 'learning' | 'other';

// Definition of a trackable habit
export interface HabitDefinition {
  id: HabitId;
  label: string;
  description?: string;
  category: HabitCategory;
  emoji?: string; // Optional emoji for visual flair
}

// A single todo/MIT item
export interface TodoItem {
  id: string;
  text: string;
  completed: boolean;
}

// MIT categories - the three pillars
export type MitCategory = 'work' | 'self' | 'family';

// Structure for a single day's MITs
export interface MitData {
  work: TodoItem[];
  self: TodoItem[];
  family: TodoItem[];
}

// All data for a single day
export interface DailyData {
  date: string; // YYYY-MM-DD format
  mit: MitData;
  habits: Record<HabitId, boolean>;
  reflection: string;
}

// Year theme (optional motivational framing)
export interface YearTheme {
  year: number;
  theme: string;
}

// App-wide settings
export interface AppSettings {
  habits: HabitDefinition[];
  yearThemes: YearTheme[];
  weekStartsOn: 0 | 1; // 0 = Sunday, 1 = Monday
}

// Complete app state that gets persisted
export interface AppState {
  settings: AppSettings;
  dailyData: Record<string, DailyData>; // Keyed by YYYY-MM-DD
}

// View types for navigation
export type ViewType = 'today' | 'week' | 'year' | 'settings';

// Default habit definitions - easily customizable
export const DEFAULT_HABITS: HabitDefinition[] = [
  {
    id: 'movement',
    label: 'Movement',
    description: 'Run, walk, or hit 8k+ steps',
    category: 'health',
    emoji: '🚶',
  },
  {
    id: 'strength',
    label: 'Strength',
    description: 'Gym or strength workout',
    category: 'health',
    emoji: '💪',
  },
  {
    id: 'alcohol-free',
    label: 'Alcohol-free',
    description: 'No alcohol today',
    category: 'health',
    emoji: '🚫',
  },
  {
    id: 'ate-clean',
    label: 'Ate clean',
    description: 'Healthy eating choices',
    category: 'health',
    emoji: '🥗',
  },
  {
    id: 'sleep',
    label: 'Slept 7+',
    description: '7+ hours of sleep',
    category: 'health',
    emoji: '😴',
  },
  {
    id: 'coded',
    label: 'Coded',
    description: 'Wrote code or built something',
    category: 'learning',
    emoji: '💻',
  },
  {
    id: 'family-time',
    label: 'Family time',
    description: 'Quality time with kids/family',
    category: 'family',
    emoji: '👨‍👩‍👧‍👦',
  },
];

// Default app settings
export const DEFAULT_SETTINGS: AppSettings = {
  habits: DEFAULT_HABITS,
  yearThemes: [],
  weekStartsOn: 1, // Monday
};

// Create an empty day's data structure
export function createEmptyDailyData(date: string): DailyData {
  return {
    date,
    mit: {
      work: [],
      self: [],
      family: [],
    },
    habits: {},
    reflection: '',
  };
}

// Create the initial app state
export function createInitialState(): AppState {
  return {
    settings: DEFAULT_SETTINGS,
    dailyData: {},
  };
}
