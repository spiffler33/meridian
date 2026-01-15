/**
 * App State Management using React Context
 *
 * This provides the global state for the entire app.
 * State is automatically persisted to localStorage on every change.
 */

import type React from 'react';
import { createContext, useContext, useReducer, useEffect, useCallback } from 'react';
import type {
  AppState,
  AppSettings,
  DailyData,
  TodoItem,
  HabitId,
  MitCategory,
  HabitDefinition,
} from '../types';
import { createEmptyDailyData, createInitialState } from '../types';
import { loadState, saveState } from '../utils/storage';

// Action types for the reducer
type Action =
  | { type: 'LOAD_STATE'; payload: AppState }
  | { type: 'SET_DAILY_DATA'; payload: { date: string; data: DailyData } }
  | { type: 'TOGGLE_HABIT'; payload: { date: string; habitId: HabitId } }
  | { type: 'ADD_MIT'; payload: { date: string; category: MitCategory; text: string } }
  | { type: 'UPDATE_MIT'; payload: { date: string; category: MitCategory; id: string; text: string } }
  | { type: 'DELETE_MIT'; payload: { date: string; category: MitCategory; id: string } }
  | { type: 'TOGGLE_MIT'; payload: { date: string; category: MitCategory; id: string } }
  | { type: 'SET_REFLECTION'; payload: { date: string; reflection: string } }
  | { type: 'UPDATE_SETTINGS'; payload: Partial<AppSettings> }
  | { type: 'UPDATE_HABITS'; payload: HabitDefinition[] }
  | { type: 'SET_YEAR_THEME'; payload: { year: number; theme: string } }
  | { type: 'IMPORT_DATA'; payload: AppState };

// Generate a simple unique ID
function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

// Reducer function
function appReducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'LOAD_STATE':
      return action.payload;

    case 'SET_DAILY_DATA': {
      return {
        ...state,
        dailyData: {
          ...state.dailyData,
          [action.payload.date]: action.payload.data,
        },
      };
    }

    case 'TOGGLE_HABIT': {
      const { date, habitId } = action.payload;
      const dayData = state.dailyData[date] || createEmptyDailyData(date);
      return {
        ...state,
        dailyData: {
          ...state.dailyData,
          [date]: {
            ...dayData,
            habits: {
              ...dayData.habits,
              [habitId]: !dayData.habits[habitId],
            },
          },
        },
      };
    }

    case 'ADD_MIT': {
      const { date, category, text } = action.payload;
      const dayData = state.dailyData[date] || createEmptyDailyData(date);
      const newItem: TodoItem = { id: generateId(), text, completed: false };
      return {
        ...state,
        dailyData: {
          ...state.dailyData,
          [date]: {
            ...dayData,
            mit: {
              ...dayData.mit,
              [category]: [...dayData.mit[category], newItem],
            },
          },
        },
      };
    }

    case 'UPDATE_MIT': {
      const { date, category, id, text } = action.payload;
      const dayData = state.dailyData[date];
      if (!dayData) return state;
      return {
        ...state,
        dailyData: {
          ...state.dailyData,
          [date]: {
            ...dayData,
            mit: {
              ...dayData.mit,
              [category]: dayData.mit[category].map(item =>
                item.id === id ? { ...item, text } : item
              ),
            },
          },
        },
      };
    }

    case 'DELETE_MIT': {
      const { date, category, id } = action.payload;
      const dayData = state.dailyData[date];
      if (!dayData) return state;
      return {
        ...state,
        dailyData: {
          ...state.dailyData,
          [date]: {
            ...dayData,
            mit: {
              ...dayData.mit,
              [category]: dayData.mit[category].filter(item => item.id !== id),
            },
          },
        },
      };
    }

    case 'TOGGLE_MIT': {
      const { date, category, id } = action.payload;
      const dayData = state.dailyData[date];
      if (!dayData) return state;
      return {
        ...state,
        dailyData: {
          ...state.dailyData,
          [date]: {
            ...dayData,
            mit: {
              ...dayData.mit,
              [category]: dayData.mit[category].map(item =>
                item.id === id ? { ...item, completed: !item.completed } : item
              ),
            },
          },
        },
      };
    }

    case 'SET_REFLECTION': {
      const { date, reflection } = action.payload;
      const dayData = state.dailyData[date] || createEmptyDailyData(date);
      return {
        ...state,
        dailyData: {
          ...state.dailyData,
          [date]: {
            ...dayData,
            reflection,
          },
        },
      };
    }

    case 'UPDATE_SETTINGS': {
      return {
        ...state,
        settings: {
          ...state.settings,
          ...action.payload,
        },
      };
    }

    case 'UPDATE_HABITS': {
      return {
        ...state,
        settings: {
          ...state.settings,
          habits: action.payload,
        },
      };
    }

    case 'SET_YEAR_THEME': {
      const { year, theme } = action.payload;
      const existingThemes = state.settings.yearThemes.filter(t => t.year !== year);
      return {
        ...state,
        settings: {
          ...state.settings,
          yearThemes: [...existingThemes, { year, theme }],
        },
      };
    }

    case 'IMPORT_DATA': {
      return action.payload;
    }

    default:
      return state;
  }
}

// Context type
interface AppContextType {
  state: AppState;
  // Daily data helpers
  getDailyData: (date: string) => DailyData;
  toggleHabit: (date: string, habitId: HabitId) => void;
  addMit: (date: string, category: MitCategory, text: string) => void;
  updateMit: (date: string, category: MitCategory, id: string, text: string) => void;
  deleteMit: (date: string, category: MitCategory, id: string) => void;
  toggleMit: (date: string, category: MitCategory, id: string) => void;
  setReflection: (date: string, reflection: string) => void;
  // Settings helpers
  updateSettings: (settings: Partial<AppSettings>) => void;
  updateHabits: (habits: HabitDefinition[]) => void;
  setYearTheme: (year: number, theme: string) => void;
  getYearTheme: (year: number) => string;
  // Data helpers
  getHabitCount: (date: string) => number;
  importData: (data: AppState) => void;
}

const AppContext = createContext<AppContextType | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, createInitialState());

  // Load state from localStorage on mount
  useEffect(() => {
    const loaded = loadState();
    dispatch({ type: 'LOAD_STATE', payload: loaded });
  }, []);

  // Save state to localStorage whenever it changes
  useEffect(() => {
    saveState(state);
  }, [state]);

  // Helper to get daily data (with fallback to empty)
  const getDailyData = useCallback(
    (date: string): DailyData => {
      return state.dailyData[date] || createEmptyDailyData(date);
    },
    [state.dailyData]
  );

  // Count completed habits for a given day
  const getHabitCount = useCallback(
    (date: string): number => {
      const dayData = state.dailyData[date];
      if (!dayData) return 0;
      return Object.values(dayData.habits).filter(Boolean).length;
    },
    [state.dailyData]
  );

  // Get year theme
  const getYearTheme = useCallback(
    (year: number): string => {
      const theme = state.settings.yearThemes.find(t => t.year === year);
      return theme?.theme || '';
    },
    [state.settings.yearThemes]
  );

  const value: AppContextType = {
    state,
    getDailyData,
    toggleHabit: (date, habitId) => dispatch({ type: 'TOGGLE_HABIT', payload: { date, habitId } }),
    addMit: (date, category, text) => dispatch({ type: 'ADD_MIT', payload: { date, category, text } }),
    updateMit: (date, category, id, text) => dispatch({ type: 'UPDATE_MIT', payload: { date, category, id, text } }),
    deleteMit: (date, category, id) => dispatch({ type: 'DELETE_MIT', payload: { date, category, id } }),
    toggleMit: (date, category, id) => dispatch({ type: 'TOGGLE_MIT', payload: { date, category, id } }),
    setReflection: (date, reflection) => dispatch({ type: 'SET_REFLECTION', payload: { date, reflection } }),
    updateSettings: settings => dispatch({ type: 'UPDATE_SETTINGS', payload: settings }),
    updateHabits: habits => dispatch({ type: 'UPDATE_HABITS', payload: habits }),
    setYearTheme: (year, theme) => dispatch({ type: 'SET_YEAR_THEME', payload: { year, theme } }),
    getYearTheme,
    getHabitCount,
    importData: data => dispatch({ type: 'IMPORT_DATA', payload: data }),
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

// Custom hook to use the app context
export function useApp(): AppContextType {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}
