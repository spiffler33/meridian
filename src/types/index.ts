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
  firstStep?: string; // Tiny first action to reduce activation energy
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
  focus?: string; // The ONE thing for today
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
    id: 'smoke-free',
    label: 'Smoke-free',
    description: 'No smoking today',
    category: 'health',
  },
  {
    id: 'no-salt',
    label: 'No salt',
    description: 'Avoided added salt',
    category: 'health',
  },
  {
    id: 'no-bread',
    label: 'No bread',
    description: 'No bread or refined carbs',
    category: 'health',
  },
  {
    id: 'no-sugar',
    label: 'No sugar',
    description: 'No added sugar',
    category: 'health',
  },
  {
    id: 'protein',
    label: 'Protein',
    description: 'High protein meals',
    category: 'health',
  },
  {
    id: 'greens',
    label: 'Greens',
    description: 'Ate vegetables/greens',
    category: 'health',
  },
  {
    id: 'sleep',
    label: 'Slept 7+',
    description: '7+ hours of sleep',
    category: 'health',
  },
  {
    id: 'strength',
    label: 'Strength',
    description: 'Strength workout (6-pack goal)',
    category: 'health',
  },
  {
    id: 'read',
    label: 'Read',
    description: 'Read a book today',
    category: 'learning',
  },
  {
    id: 'shipped',
    label: 'Shipped',
    description: 'Made progress on Rubic',
    category: 'work',
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
