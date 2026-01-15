/**
 * localStorage Persistence Layer
 *
 * Handles all read/write operations to localStorage.
 * Data is stored as JSON under the key 'life-calendar-data'.
 */

import type { AppState } from '../types';
import { createInitialState } from '../types';

const STORAGE_KEY = 'life-calendar-data';

/**
 * Load app state from localStorage.
 * Returns default state if nothing is stored or if parsing fails.
 */
export function loadState(): AppState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return createInitialState();
    }
    const parsed = JSON.parse(stored) as AppState;
    // Ensure we have required structure (handles schema evolution)
    return {
      settings: {
        ...createInitialState().settings,
        ...parsed.settings,
      },
      dailyData: parsed.dailyData || {},
    };
  } catch (error) {
    console.error('Failed to load state from localStorage:', error);
    return createInitialState();
  }
}

/**
 * Save app state to localStorage.
 */
export function saveState(state: AppState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error('Failed to save state to localStorage:', error);
  }
}

/**
 * Export all data as a JSON string (for download).
 */
export function exportData(state: AppState): string {
  return JSON.stringify(state, null, 2);
}

/**
 * Import data from a JSON string.
 * Returns the parsed state or null if parsing fails.
 */
export function importData(jsonString: string): AppState | null {
  try {
    const parsed = JSON.parse(jsonString) as AppState;
    // Basic validation
    if (!parsed.settings || !parsed.dailyData) {
      throw new Error('Invalid data structure');
    }
    return parsed;
  } catch (error) {
    console.error('Failed to import data:', error);
    return null;
  }
}

/**
 * Clear all stored data (use with caution).
 */
export function clearAllData(): void {
  localStorage.removeItem(STORAGE_KEY);
}
