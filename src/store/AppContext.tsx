/**
 * App State Management using React Context
 *
 * Supabase is the source of truth for authenticated users.
 * Habits and completions are loaded from and saved to Supabase.
 */

import { createContext, useContext, useReducer, useEffect, useCallback, useRef, useState } from 'react';
import type {
  AppState,
  AppSettings,
  DailyData,
  TodoItem,
  HabitId,
  MitCategory,
  HabitDefinition,
  TowerItem,
  TowerStatus,
  PackWithCount,
} from '../types';
import { createEmptyDailyData, DEFAULT_HABITS } from '../types';

// Extended state with tower items and packs
interface ExtendedAppState extends AppState {
  tower: TowerItem[];
  packs: PackWithCount[];
}

// Create initial state with EMPTY habits (will load from Supabase)
function createEmptyState(): ExtendedAppState {
  return {
    settings: {
      habits: [], // Start empty - will load from Supabase
      yearThemes: [],
      weekStartsOn: 1,
    },
    dailyData: {},
    tower: [],
    packs: [],
  };
}
import { addDays, getToday } from '../utils/dates';
import {
  toggleCompletion,
  getCompletions,
  getHabits,
  upsertDailyEntry,
  getDailyDataRange,
  createTask,
  updateTask,
  deleteTask,
  getAllYearThemes,
  setYearTheme as setYearThemeInDb,
  getTowerItems,
  createTowerItem,
  updateTowerItem,
  completeTowerItem,
  deleteTowerItem,
  getPacks,
  createPack,
  archivePack,
  createPackSession,
  deletePackSession,
} from '../services/data';
import type { TowerItemInput, PackInput, PackSessionInput } from '../services/data';

// Action types for the reducer
type Action =
  | { type: 'SET_HABITS'; payload: HabitDefinition[] }
  | { type: 'SET_COMPLETIONS'; payload: Record<string, Record<string, boolean>> }
  | { type: 'SET_DAILY_ENTRIES'; payload: Record<string, { focus?: string; reflection?: string }> }
  | { type: 'SET_TASKS'; payload: { date: string; category: MitCategory; tasks: TodoItem[] }[] }
  | { type: 'SET_YEAR_THEMES'; payload: { year: number; theme: string }[] }
  | { type: 'TOGGLE_HABIT'; payload: { date: string; habitId: HabitId } }
  | { type: 'ADD_MIT'; payload: { date: string; category: MitCategory; item: TodoItem } }
  | { type: 'UPDATE_MIT'; payload: { date: string; category: MitCategory; id: string; text: string } }
  | { type: 'DELETE_MIT'; payload: { date: string; category: MitCategory; id: string } }
  | { type: 'TOGGLE_MIT'; payload: { date: string; category: MitCategory; id: string; completed: boolean } }
  | { type: 'SET_MIT_FIRST_STEP'; payload: { date: string; category: MitCategory; id: string; firstStep: string } }
  | { type: 'SET_FOCUS'; payload: { date: string; focus: string } }
  | { type: 'SET_REFLECTION'; payload: { date: string; reflection: string } }
  | { type: 'UPDATE_SETTINGS'; payload: Partial<AppSettings> }
  | { type: 'SET_YEAR_THEME'; payload: { year: number; theme: string } }
  | { type: 'SET_TOWER_ITEMS'; payload: TowerItem[] }
  | { type: 'ADD_TOWER_ITEM'; payload: TowerItem }
  | { type: 'UPDATE_TOWER_ITEM'; payload: TowerItem }
  | { type: 'DELETE_TOWER_ITEM'; payload: string }
  | { type: 'SET_PACKS'; payload: PackWithCount[] }
  | { type: 'ADD_PACK'; payload: PackWithCount }
  | { type: 'UPDATE_PACK_COUNT'; payload: { id: string; delta: number } }
  | { type: 'DELETE_PACK'; payload: string };

// Reducer function
function appReducer(state: ExtendedAppState, action: Action): ExtendedAppState {
  switch (action.type) {
    case 'SET_HABITS': {
      return {
        ...state,
        settings: {
          ...state.settings,
          habits: action.payload,
        },
      };
    }

    case 'SET_COMPLETIONS': {
      const newDailyData = { ...state.dailyData };
      for (const [date, habits] of Object.entries(action.payload)) {
        newDailyData[date] = {
          ...(newDailyData[date] || createEmptyDailyData(date)),
          habits,
        };
      }
      return {
        ...state,
        dailyData: newDailyData,
      };
    }

    case 'SET_DAILY_ENTRIES': {
      const newDailyData = { ...state.dailyData };
      for (const [date, entry] of Object.entries(action.payload)) {
        newDailyData[date] = {
          ...(newDailyData[date] || createEmptyDailyData(date)),
          focus: entry.focus || '',
          reflection: entry.reflection || '',
        };
      }
      return {
        ...state,
        dailyData: newDailyData,
      };
    }

    case 'SET_TASKS': {
      const newDailyData = { ...state.dailyData };
      for (const { date, category, tasks } of action.payload) {
        const dayData = newDailyData[date] || createEmptyDailyData(date);
        newDailyData[date] = {
          ...dayData,
          mit: {
            ...dayData.mit,
            [category]: tasks,
          },
        };
      }
      return {
        ...state,
        dailyData: newDailyData,
      };
    }

    case 'SET_YEAR_THEMES': {
      return {
        ...state,
        settings: {
          ...state.settings,
          yearThemes: action.payload,
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
      const { date, category, item } = action.payload;
      const dayData = state.dailyData[date] || createEmptyDailyData(date);
      return {
        ...state,
        dailyData: {
          ...state.dailyData,
          [date]: {
            ...dayData,
            mit: {
              ...dayData.mit,
              [category]: [...dayData.mit[category], item],
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
      const { date, category, id, completed } = action.payload;
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
                item.id === id ? { ...item, completed } : item
              ),
            },
          },
        },
      };
    }

    case 'SET_MIT_FIRST_STEP': {
      const { date, category, id, firstStep } = action.payload;
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
                item.id === id ? { ...item, firstStep } : item
              ),
            },
          },
        },
      };
    }

    case 'SET_FOCUS': {
      const { date, focus } = action.payload;
      const dayData = state.dailyData[date] || createEmptyDailyData(date);
      return {
        ...state,
        dailyData: {
          ...state.dailyData,
          [date]: {
            ...dayData,
            focus,
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

    case 'SET_TOWER_ITEMS': {
      return { ...state, tower: action.payload };
    }

    case 'ADD_TOWER_ITEM': {
      return { ...state, tower: [...state.tower, action.payload] };
    }

    case 'UPDATE_TOWER_ITEM': {
      return {
        ...state,
        tower: state.tower.map(item =>
          item.id === action.payload.id ? action.payload : item
        ),
      };
    }

    case 'DELETE_TOWER_ITEM': {
      return {
        ...state,
        tower: state.tower.filter(item => item.id !== action.payload),
      };
    }

    case 'SET_PACKS': {
      return { ...state, packs: action.payload };
    }

    case 'ADD_PACK': {
      return { ...state, packs: [action.payload, ...state.packs] };
    }

    case 'UPDATE_PACK_COUNT': {
      return {
        ...state,
        packs: state.packs.map(pack =>
          pack.id === action.payload.id
            ? { ...pack, used: pack.used + action.payload.delta }
            : pack
        ),
      };
    }

    case 'DELETE_PACK': {
      return {
        ...state,
        packs: state.packs.filter(pack => pack.id !== action.payload),
      };
    }

    default:
      return state;
  }
}

// Context type
interface AppContextType {
  state: ExtendedAppState;
  loading: boolean;
  getDailyData: (date: string) => DailyData;
  toggleHabit: (date: string, habitId: HabitId) => void;
  addMit: (date: string, category: MitCategory, text: string, firstStep?: string) => void;
  updateMit: (date: string, category: MitCategory, id: string, text: string) => void;
  deleteMit: (date: string, category: MitCategory, id: string) => void;
  toggleMit: (date: string, category: MitCategory, id: string) => void;
  setMitFirstStep: (date: string, category: MitCategory, id: string, firstStep: string) => void;
  setFocus: (date: string, focus: string) => void;
  setReflection: (date: string, reflection: string) => void;
  updateSettings: (settings: Partial<AppSettings>) => void;
  updateHabits: (habits: HabitDefinition[]) => void;
  setYearTheme: (year: number, theme: string) => void;
  getYearTheme: (year: number) => string;
  getHabitCount: (date: string) => number;
  getHabitStreak: (habitId: HabitId, fromDate?: string) => number;
  // Tower methods
  getTowerItemsByStatus: (status: TowerStatus) => TowerItem[];
  addTowerItem: (input: TowerItemInput) => Promise<void>;
  updateTowerItemById: (id: string, updates: Partial<TowerItemInput>) => Promise<void>;
  completeTowerItemById: (id: string) => Promise<void>;
  deleteTowerItemById: (id: string) => Promise<void>;
  // Packs methods
  addPack: (input: PackInput) => Promise<void>;
  archivePackById: (id: string) => Promise<void>;
  logPackSession: (input: PackSessionInput) => Promise<void>;
  removePackSession: (packId: string, sessionId: string) => Promise<void>;
}

const AppContext = createContext<AppContextType | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, createEmptyState());
  const [loading, setLoading] = useState(true);
  const initializedRef = useRef(false);

  // Load data from Supabase on mount
  useEffect(() => {
    const loadFromSupabase = async () => {
      if (initializedRef.current) return;
      initializedRef.current = true;

      try {
        // Load habits from Supabase
        const supabaseHabits = await getHabits();

        if (supabaseHabits.length > 0) {
          // Convert to HabitDefinition format
          const habits: HabitDefinition[] = supabaseHabits.map(h => ({
            id: h.id,
            label: h.label,
            description: h.description || undefined,
            category: h.category as HabitDefinition['category'],
            emoji: h.emoji || undefined,
          }));
          dispatch({ type: 'SET_HABITS', payload: habits });
        } else {
          // No habits in Supabase - use defaults
          dispatch({ type: 'SET_HABITS', payload: DEFAULT_HABITS });
        }

        // Load year themes
        const yearThemes = await getAllYearThemes();
        if (yearThemes.length > 0) {
          dispatch({
            type: 'SET_YEAR_THEMES',
            payload: yearThemes.map(t => ({ year: t.year, theme: t.theme })),
          });
        }

        // Load data for last 14 days (UI needs ~1-2 weeks, AI fetches its own data on-demand)
        const todayStr = getToday(); // Local date
        const startDateObj = new Date();
        startDateObj.setDate(startDateObj.getDate() - 14);
        const startDateStr = `${startDateObj.getFullYear()}-${String(startDateObj.getMonth() + 1).padStart(2, '0')}-${String(startDateObj.getDate()).padStart(2, '0')}`;

        // Load completions, daily entries, and tasks in parallel
        const [completions, dailyData] = await Promise.all([
          getCompletions(startDateStr, todayStr),
          getDailyDataRange(startDateStr, todayStr),
        ]);

        // Convert completions to date -> habitId -> true map
        const completionMap: Record<string, Record<string, boolean>> = {};
        for (const c of completions) {
          if (!completionMap[c.date]) {
            completionMap[c.date] = {};
          }
          completionMap[c.date][c.habit_id] = true;
        }

        if (Object.keys(completionMap).length > 0) {
          dispatch({ type: 'SET_COMPLETIONS', payload: completionMap });
        }

        // Convert daily entries to date -> { focus, reflection } map
        const entriesMap: Record<string, { focus?: string; reflection?: string }> = {};
        for (const entry of dailyData.entries) {
          entriesMap[entry.date] = {
            focus: entry.focus || undefined,
            reflection: entry.reflection || undefined,
          };
        }

        if (Object.keys(entriesMap).length > 0) {
          dispatch({ type: 'SET_DAILY_ENTRIES', payload: entriesMap });
        }

        // Convert tasks to grouped format
        const taskGroups: { date: string; category: MitCategory; tasks: TodoItem[] }[] = [];
        const tasksByDateCategory: Record<string, Record<string, TodoItem[]>> = {};

        for (const task of dailyData.tasks) {
          const date = task.date;
          const category = task.category as MitCategory;
          if (!tasksByDateCategory[date]) {
            tasksByDateCategory[date] = {};
          }
          if (!tasksByDateCategory[date][category]) {
            tasksByDateCategory[date][category] = [];
          }
          tasksByDateCategory[date][category].push({
            id: task.id,
            text: task.text,
            completed: task.completed,
            firstStep: task.first_step || undefined,
          });
        }

        for (const [date, categories] of Object.entries(tasksByDateCategory)) {
          for (const [category, tasks] of Object.entries(categories)) {
            taskGroups.push({ date, category: category as MitCategory, tasks });
          }
        }

        if (taskGroups.length > 0) {
          dispatch({ type: 'SET_TASKS', payload: taskGroups });
        }

        // Load tower items and packs in parallel
        const [towerItems, packs] = await Promise.all([
          getTowerItems(),
          getPacks(),
        ]);
        dispatch({ type: 'SET_TOWER_ITEMS', payload: towerItems });
        dispatch({ type: 'SET_PACKS', payload: packs });
      } catch (err) {
        if (import.meta.env.DEV) console.error('Failed to load from Supabase:', err);
        // Fall back to defaults on error
        dispatch({ type: 'SET_HABITS', payload: DEFAULT_HABITS });
      } finally {
        setLoading(false);
      }
    };

    loadFromSupabase();
  }, []);

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

  // Calculate habit streak
  const getHabitStreak = useCallback(
    (habitId: HabitId, fromDate: string = getToday()): number => {
      let streak = 0;
      let currentDate = fromDate;

      const todayData = state.dailyData[currentDate];
      if (!todayData?.habits[habitId]) {
        currentDate = addDays(currentDate, -1);
      }

      while (true) {
        const dayData = state.dailyData[currentDate];
        if (dayData?.habits[habitId]) {
          streak++;
          currentDate = addDays(currentDate, -1);
        } else {
          break;
        }
      }

      return streak;
    },
    [state.dailyData]
  );

  // Toggle habit with Supabase sync
  const toggleHabit = useCallback(
    async (date: string, habitId: HabitId) => {
      const dayData = state.dailyData[date] || createEmptyDailyData(date);
      const currentValue = dayData.habits[habitId] || false;
      const newValue = !currentValue;

      // Update local state immediately
      dispatch({ type: 'TOGGLE_HABIT', payload: { date, habitId } });

      // Sync to Supabase
      try {
        await toggleCompletion(habitId, date, newValue);
      } catch (err) {
        if (import.meta.env.DEV) console.error('Failed to sync habit to Supabase:', err);
        // Revert on error
        dispatch({ type: 'TOGGLE_HABIT', payload: { date, habitId } });
      }
    },
    [state.dailyData]
  );

  // Add MIT with Supabase sync
  const addMit = useCallback(
    async (date: string, category: MitCategory, text: string, firstStep?: string) => {
      try {
        const task = await createTask({ date, category, text, firstStep });
        const item: TodoItem = {
          id: task.id,
          text: task.text,
          completed: task.completed,
          firstStep: task.first_step || undefined,
        };
        dispatch({ type: 'ADD_MIT', payload: { date, category, item } });
      } catch (err) {
        if (import.meta.env.DEV) console.error('Failed to create task:', err);
      }
    },
    []
  );

  // Update MIT with Supabase sync
  const updateMit = useCallback(
    async (date: string, category: MitCategory, id: string, text: string) => {
      // Update local state immediately
      dispatch({ type: 'UPDATE_MIT', payload: { date, category, id, text } });

      try {
        await updateTask(id, { text });
      } catch (err) {
        if (import.meta.env.DEV) console.error('Failed to update task:', err);
      }
    },
    []
  );

  // Delete MIT with Supabase sync
  const deleteMit = useCallback(
    async (date: string, category: MitCategory, id: string) => {
      // Update local state immediately
      dispatch({ type: 'DELETE_MIT', payload: { date, category, id } });

      try {
        await deleteTask(id);
      } catch (err) {
        if (import.meta.env.DEV) console.error('Failed to delete task:', err);
      }
    },
    []
  );

  // Toggle MIT with Supabase sync
  const toggleMit = useCallback(
    async (date: string, category: MitCategory, id: string) => {
      const dayData = state.dailyData[date];
      if (!dayData) return;

      const task = dayData.mit[category].find(t => t.id === id);
      if (!task) return;

      const newCompleted = !task.completed;

      // Update local state immediately
      dispatch({ type: 'TOGGLE_MIT', payload: { date, category, id, completed: newCompleted } });

      try {
        await updateTask(id, { completed: newCompleted });
      } catch (err) {
        if (import.meta.env.DEV) console.error('Failed to toggle task:', err);
        // Revert on error
        dispatch({ type: 'TOGGLE_MIT', payload: { date, category, id, completed: task.completed } });
      }
    },
    [state.dailyData]
  );

  // Set MIT first step with Supabase sync
  const setMitFirstStep = useCallback(
    async (date: string, category: MitCategory, id: string, firstStep: string) => {
      // Update local state immediately
      dispatch({ type: 'SET_MIT_FIRST_STEP', payload: { date, category, id, firstStep } });

      try {
        await updateTask(id, { first_step: firstStep });
      } catch (err) {
        if (import.meta.env.DEV) console.error('Failed to update task first step:', err);
      }
    },
    []
  );

  // Set focus with Supabase sync
  const setFocus = useCallback(
    async (date: string, focus: string) => {
      // Update local state immediately
      dispatch({ type: 'SET_FOCUS', payload: { date, focus } });

      try {
        await upsertDailyEntry(date, { focus });
      } catch (err) {
        if (import.meta.env.DEV) console.error('Failed to save focus:', err);
      }
    },
    []
  );

  // Set reflection with Supabase sync
  const setReflection = useCallback(
    async (date: string, reflection: string) => {
      // Update local state immediately
      dispatch({ type: 'SET_REFLECTION', payload: { date, reflection } });

      try {
        await upsertDailyEntry(date, { reflection });
      } catch (err) {
        if (import.meta.env.DEV) console.error('Failed to save reflection:', err);
      }
    },
    []
  );

  // Set year theme with Supabase sync
  const setYearTheme = useCallback(
    async (year: number, theme: string) => {
      // Update local state immediately
      dispatch({ type: 'SET_YEAR_THEME', payload: { year, theme } });

      try {
        await setYearThemeInDb(year, theme);
      } catch (err) {
        if (import.meta.env.DEV) console.error('Failed to save year theme:', err);
      }
    },
    []
  );

  // ============================================================================
  // Tower Methods
  // ============================================================================

  const getTowerItemsByStatusFn = useCallback(
    (status: TowerStatus): TowerItem[] => {
      return state.tower.filter(item => item.status === status);
    },
    [state.tower]
  );

  const addTowerItemFn = useCallback(
    async (input: TowerItemInput) => {
      try {
        const item = await createTowerItem(input);
        dispatch({ type: 'ADD_TOWER_ITEM', payload: item });
      } catch (err) {
        if (import.meta.env.DEV) console.error('Failed to create tower item:', err);
      }
    },
    []
  );

  const updateTowerItemByIdFn = useCallback(
    async (id: string, updates: Partial<TowerItemInput>) => {
      try {
        const item = await updateTowerItem(id, updates);
        dispatch({ type: 'UPDATE_TOWER_ITEM', payload: item });
      } catch (err) {
        if (import.meta.env.DEV) console.error('Failed to update tower item:', err);
      }
    },
    []
  );

  const completeTowerItemByIdFn = useCallback(
    async (id: string) => {
      try {
        const item = await completeTowerItem(id);
        dispatch({ type: 'UPDATE_TOWER_ITEM', payload: item });
      } catch (err) {
        if (import.meta.env.DEV) console.error('Failed to complete tower item:', err);
      }
    },
    []
  );

  const deleteTowerItemByIdFn = useCallback(
    async (id: string) => {
      // Optimistic update
      dispatch({ type: 'DELETE_TOWER_ITEM', payload: id });

      try {
        await deleteTowerItem(id);
      } catch (err) {
        if (import.meta.env.DEV) console.error('Failed to delete tower item:', err);
        // Reload tower items on error
        const items = await getTowerItems();
        dispatch({ type: 'SET_TOWER_ITEMS', payload: items });
      }
    },
    []
  );

  // ============================================================================
  // Packs Methods
  // ============================================================================

  const addPackFn = useCallback(
    async (input: PackInput) => {
      try {
        const pack = await createPack(input);
        dispatch({ type: 'ADD_PACK', payload: { ...pack, used: 0 } });
      } catch (err) {
        if (import.meta.env.DEV) console.error('Failed to create pack:', err);
      }
    },
    []
  );

  const archivePackByIdFn = useCallback(
    async (id: string) => {
      // Optimistic update
      dispatch({ type: 'DELETE_PACK', payload: id });

      try {
        await archivePack(id);
      } catch (err) {
        if (import.meta.env.DEV) console.error('Failed to archive pack:', err);
        // Reload packs on error
        const packs = await getPacks();
        dispatch({ type: 'SET_PACKS', payload: packs });
      }
    },
    []
  );

  const logPackSessionFn = useCallback(
    async (input: PackSessionInput) => {
      try {
        await createPackSession(input);
        // Optimistic update: increment the used count
        dispatch({ type: 'UPDATE_PACK_COUNT', payload: { id: input.packId, delta: 1 } });
      } catch (err) {
        if (import.meta.env.DEV) console.error('Failed to log pack session:', err);
      }
    },
    []
  );

  const removePackSessionFn = useCallback(
    async (packId: string, sessionId: string) => {
      try {
        await deletePackSession(sessionId);
        // Optimistic update: decrement the used count
        dispatch({ type: 'UPDATE_PACK_COUNT', payload: { id: packId, delta: -1 } });
      } catch (err) {
        if (import.meta.env.DEV) console.error('Failed to delete pack session:', err);
      }
    },
    []
  );

  const value: AppContextType = {
    state,
    loading,
    getDailyData,
    toggleHabit,
    addMit,
    updateMit,
    deleteMit,
    toggleMit,
    setMitFirstStep,
    setFocus,
    setReflection,
    updateSettings: settings => dispatch({ type: 'UPDATE_SETTINGS', payload: settings }),
    updateHabits: habits => dispatch({ type: 'SET_HABITS', payload: habits }),
    setYearTheme,
    getYearTheme,
    getHabitCount,
    getHabitStreak,
    // Tower
    getTowerItemsByStatus: getTowerItemsByStatusFn,
    addTowerItem: addTowerItemFn,
    updateTowerItemById: updateTowerItemByIdFn,
    completeTowerItemById: completeTowerItemByIdFn,
    deleteTowerItemById: deleteTowerItemByIdFn,
    // Packs
    addPack: addPackFn,
    archivePackById: archivePackByIdFn,
    logPackSession: logPackSessionFn,
    removePackSession: removePackSessionFn,
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
