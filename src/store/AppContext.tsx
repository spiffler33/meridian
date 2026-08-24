/**
 * App State Management using React Context
 *
 * IndexedDB is the source of truth this renders from. First paint reads the
 * local store and never waits on the network; the GitHub sync runs in the
 * background afterwards and re-renders when it lands.
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

// Create initial state with EMPTY habits (will load from the local store)
function createEmptyState(): ExtendedAppState {
  return {
    settings: {
      habits: [], // Start empty - will load from the local store
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
  getProfile,
  updateProfile as updateProfileInStore,
} from '../services/data';
import type { TowerItemInput, PackInput, PackSessionInput, Profile } from '../services/data';
import { requestPersistence } from '../lib/db';
import { installSyncTriggers, scheduleFlush, syncDown } from '../lib/sync';

/**
 * What a caller may change on the profile.
 *
 * Its id and creation date are not theirs, and neither is `claude_api_key`:
 * a profile write becomes a journal event, so permitting the key here would
 * type-check a path that carries a live credential into the data repo. The key
 * lives in the IndexedDB `meta` store, which is never journalled.
 */
export type ProfileUpdates = Partial<Omit<Profile, 'id' | 'created_at' | 'claude_api_key'>>;

/**
 * The inclusive date range a load covered.
 *
 * A reload REPLACES this window rather than merging into it. Merging made a
 * deletion invisible: the payload only carries what still exists, so a date
 * whose last habit tick or last MIT was removed on another device kept
 * rendering it until a page reload.
 */
interface DateWindow {
  start: string;
  end: string;
}

/** ISO dates sort lexicographically, so plain comparison is the range test. */
function withinWindow(date: string, window: DateWindow): boolean {
  return date >= window.start && date <= window.end;
}

// Action types for the reducer
type Action =
  | { type: 'SET_HABITS'; payload: HabitDefinition[] }
  | { type: 'SET_COMPLETIONS'; payload: { window: DateWindow; completions: Record<string, Record<string, boolean>> } }
  | { type: 'SET_DAILY_ENTRIES'; payload: Record<string, { focus?: string; reflection?: string; isHoliday?: boolean }> }
  | { type: 'SET_TASKS'; payload: { window: DateWindow; groups: { date: string; category: MitCategory; tasks: TodoItem[] }[] } }
  | { type: 'SET_YEAR_THEMES'; payload: { year: number; theme: string }[] }
  | { type: 'TOGGLE_HABIT'; payload: { date: string; habitId: HabitId } }
  | { type: 'ADD_MIT'; payload: { date: string; category: MitCategory; item: TodoItem } }
  | { type: 'UPDATE_MIT'; payload: { date: string; category: MitCategory; id: string; text: string } }
  | { type: 'DELETE_MIT'; payload: { date: string; category: MitCategory; id: string } }
  | { type: 'TOGGLE_MIT'; payload: { date: string; category: MitCategory; id: string; completed: boolean } }
  | { type: 'SET_MIT_FIRST_STEP'; payload: { date: string; category: MitCategory; id: string; firstStep: string } }
  | { type: 'SET_FOCUS'; payload: { date: string; focus: string } }
  | { type: 'SET_REFLECTION'; payload: { date: string; reflection: string } }
  | { type: 'SET_HOLIDAY'; payload: { date: string; isHoliday: boolean } }
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
      const { window, completions } = action.payload;
      const newDailyData = { ...state.dailyData };
      // Clear the whole loaded window first. Whatever the payload does not
      // carry was deleted, and must stop rendering without a page reload.
      for (const [date, dayData] of Object.entries(newDailyData)) {
        if (!withinWindow(date, window)) continue;
        newDailyData[date] = { ...dayData, habits: {} };
      }
      for (const [date, habits] of Object.entries(completions)) {
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
          isHoliday: entry.isHoliday || false,
        };
      }
      return {
        ...state,
        dailyData: newDailyData,
      };
    }

    case 'SET_TASKS': {
      const { window, groups } = action.payload;
      const newDailyData = { ...state.dailyData };
      // Same replacement rule as SET_COMPLETIONS: a date+category whose last
      // MIT was deleted elsewhere has no entry in the payload at all.
      for (const [date, dayData] of Object.entries(newDailyData)) {
        if (!withinWindow(date, window)) continue;
        newDailyData[date] = { ...dayData, mit: createEmptyDailyData(date).mit };
      }
      for (const { date, category, tasks } of groups) {
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

    case 'SET_HOLIDAY': {
      const { date, isHoliday } = action.payload;
      const dayData = state.dailyData[date] || createEmptyDailyData(date);
      return {
        ...state,
        dailyData: {
          ...state.dailyData,
          [date]: {
            ...dayData,
            isHoliday,
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
  profile: Profile | null;
  updateProfile: (updates: ProfileUpdates) => Promise<void>;
  getDailyData: (date: string) => DailyData;
  toggleHabit: (date: string, habitId: HabitId) => void;
  addMit: (date: string, category: MitCategory, text: string, firstStep?: string) => void;
  updateMit: (date: string, category: MitCategory, id: string, text: string) => void;
  deleteMit: (date: string, category: MitCategory, id: string) => void;
  toggleMit: (date: string, category: MitCategory, id: string) => void;
  setMitFirstStep: (date: string, category: MitCategory, id: string, firstStep: string) => void;
  setFocus: (date: string, focus: string) => void;
  setReflection: (date: string, reflection: string) => void;
  toggleHoliday: (date: string) => void;
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
  const [profile, setProfile] = useState<Profile | null>(null);
  const initializedRef = useRef(false);

  /**
   * Read everything the UI needs out of the local store.
   *
   * Every call below is served from IndexedDB, so this never waits on the
   * network. It is safe to repeat: the background sync calls it again once
   * newly fetched events have landed.
   */
  const loadLocalData = useCallback(async () => {
    try {
      const storedHabits = await getHabits();

      if (storedHabits.length > 0) {
        // Convert to HabitDefinition format
        const habits: HabitDefinition[] = storedHabits.map(h => ({
          id: h.id,
          label: h.label,
          description: h.description || undefined,
          category: h.category as HabitDefinition['category'],
          emoji: h.emoji || undefined,
        }));
        dispatch({ type: 'SET_HABITS', payload: habits });
      } else {
        // Nothing stored yet - use defaults
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

      // Unguarded on purpose: clearing every tick in the window on another
      // device has to clear them here too, and that payload is empty.
      const loadedWindow = { start: startDateStr, end: todayStr };
      dispatch({ type: 'SET_COMPLETIONS', payload: { window: loadedWindow, completions: completionMap } });

      // Convert daily entries to date -> { focus, reflection, isHoliday } map
      const entriesMap: Record<string, { focus?: string; reflection?: string; isHoliday?: boolean }> = {};
      for (const entry of dailyData.entries) {
        entriesMap[entry.date] = {
          focus: entry.focus || undefined,
          reflection: entry.reflection || undefined,
          isHoliday: entry.is_holiday || false,
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

      dispatch({ type: 'SET_TASKS', payload: { window: loadedWindow, groups: taskGroups } });

      // Load tower items, packs and the profile in parallel
      const [towerItems, packs, storedProfile] = await Promise.all([
        getTowerItems(),
        getPacks(),
        getProfile(),
      ]);
      dispatch({ type: 'SET_TOWER_ITEMS', payload: towerItems });
      dispatch({ type: 'SET_PACKS', payload: packs });
      setProfile(storedProfile);
    } catch (err) {
      if (import.meta.env.DEV) console.error('Failed to load local data:', err);
      // Fall back to defaults on error
      dispatch({ type: 'SET_HABITS', payload: DEFAULT_HABITS });
    }
  }, []);

  // First paint comes from the local store. Everything that touches the
  // network happens strictly after it, so an offline cold open shows data.
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    void (async () => {
      try {
        await loadLocalData();
      } finally {
        setLoading(false);
      }

      // Ask the browser to keep this origin's storage. Settings queries the
      // live answer itself, so nothing is recorded here.
      try {
        await requestPersistence();
      } catch (err) {
        if (import.meta.env.DEV) console.error('Failed to request storage persistence:', err);
      }

      try {
        const result = await syncDown();
        // Only a pull that actually changed the cache is worth re-reading for.
        if (result !== null && result.fetched > 0) await loadLocalData();
      } catch (err) {
        if (import.meta.env.DEV) console.error('Background sync failed:', err);
      }
    })();
  }, [loadLocalData]);

  // Push and pull triggers. Installed in their own effect, with symmetric
  // teardown, so React's development double-mount leaves them wired.
  useEffect(() => {
    return installSyncTriggers({
      onSynced: () => {
        void loadLocalData();
      },
    });
  }, [loadLocalData]);

  // Any change to rendered state or to the profile may have queued events —
  // including writes made outside this provider. The debounce inside
  // collapses a burst of edits into one push.
  useEffect(() => {
    scheduleFlush();
  }, [state, profile]);

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

  // Calculate habit streak (skips holiday days)
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

        // Skip holiday days (they don't break or extend streaks)
        if (dayData?.isHoliday) {
          currentDate = addDays(currentDate, -1);
          continue;
        }

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

  // Toggle habit, recorded to the local journal
  const toggleHabit = useCallback(
    async (date: string, habitId: HabitId) => {
      const dayData = state.dailyData[date] || createEmptyDailyData(date);
      const currentValue = dayData.habits[habitId] || false;
      const newValue = !currentValue;

      // Update local state immediately
      dispatch({ type: 'TOGGLE_HABIT', payload: { date, habitId } });

      // Record the change
      try {
        await toggleCompletion(habitId, date, newValue);
      } catch (err) {
        if (import.meta.env.DEV) console.error('Failed to record habit toggle:', err);
        // Revert on error
        dispatch({ type: 'TOGGLE_HABIT', payload: { date, habitId } });
      }
    },
    [state.dailyData]
  );

  // Add MIT, recorded to the local journal
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

  // Update MIT, recorded to the local journal
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

  // Delete MIT, recorded to the local journal
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

  // Toggle MIT, recorded to the local journal
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

  // Set MIT first step, recorded to the local journal
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

  // Set focus, recorded to the local journal
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

  // Set reflection, recorded to the local journal
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

  // Toggle holiday mode, recorded to the local journal
  const toggleHoliday = useCallback(
    async (date: string) => {
      const dayData = state.dailyData[date] || createEmptyDailyData(date);
      const newValue = !dayData.isHoliday;

      // Update local state immediately
      dispatch({ type: 'SET_HOLIDAY', payload: { date, isHoliday: newValue } });

      try {
        await upsertDailyEntry(date, { isHoliday: newValue });
      } catch (err) {
        if (import.meta.env.DEV) console.error('Failed to save holiday status:', err);
        // Revert on error
        dispatch({ type: 'SET_HOLIDAY', payload: { date, isHoliday: !newValue } });
      }
    },
    [state.dailyData]
  );

  // Set year theme, recorded to the local journal
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

  // Update the profile. The store returns the merged singleton, which is what
  // the next read would say, so it is what the UI is given.
  const updateProfileFn = useCallback(async (updates: ProfileUpdates) => {
    try {
      setProfile(await updateProfileInStore(updates));
    } catch (err) {
      if (import.meta.env.DEV) console.error('Failed to update profile:', err);
    }
  }, []);

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
    profile,
    updateProfile: updateProfileFn,
    getDailyData,
    toggleHabit,
    addMit,
    updateMit,
    deleteMit,
    toggleMit,
    setMitFirstStep,
    setFocus,
    setReflection,
    toggleHoliday,
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
