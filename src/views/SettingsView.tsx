/**
 * Settings View
 *
 * Manage habits, week start day, and export/import data.
 */

import type React from 'react';
import { useState, useRef } from 'react';
import { useApp } from '../store/AppContext';
import type { HabitDefinition, HabitCategory } from '../types';
import { DEFAULT_HABITS } from '../types';
import { exportData, importData } from '../utils/storage';

interface HabitEditorProps {
  habit: HabitDefinition;
  onUpdate: (habit: HabitDefinition) => void;
  onDelete: () => void;
}

function HabitEditor({ habit, onUpdate, onDelete }: HabitEditorProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editHabit, setEditHabit] = useState(habit);

  const handleSave = () => {
    if (editHabit.label.trim()) {
      onUpdate(editHabit);
      setIsEditing(false);
    }
  };

  const categories: HabitCategory[] = ['health', 'work', 'family', 'learning', 'other'];

  if (isEditing) {
    return (
      <div className="p-4 bg-surface-50 rounded-lg border border-surface-200 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-surface-600 mb-1">Label</label>
            <input
              type="text"
              value={editHabit.label}
              onChange={e => setEditHabit({ ...editHabit, label: e.target.value })}
              className="w-full px-3 py-2 text-sm rounded-lg border border-surface-200 focus:border-accent-400 focus:ring-1 focus:ring-accent-400 outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-surface-600 mb-1">Emoji</label>
            <input
              type="text"
              value={editHabit.emoji || ''}
              onChange={e => setEditHabit({ ...editHabit, emoji: e.target.value })}
              className="w-full px-3 py-2 text-sm rounded-lg border border-surface-200 focus:border-accent-400 focus:ring-1 focus:ring-accent-400 outline-none"
              maxLength={2}
            />
          </div>
        </div>
        <div>
          <label className="block text-xs text-surface-600 mb-1">Description</label>
          <input
            type="text"
            value={editHabit.description || ''}
            onChange={e => setEditHabit({ ...editHabit, description: e.target.value })}
            className="w-full px-3 py-2 text-sm rounded-lg border border-surface-200 focus:border-accent-400 focus:ring-1 focus:ring-accent-400 outline-none"
          />
        </div>
        <div>
          <label className="block text-xs text-surface-600 mb-1">Category</label>
          <select
            value={editHabit.category}
            onChange={e => setEditHabit({ ...editHabit, category: e.target.value as HabitCategory })}
            className="w-full px-3 py-2 text-sm rounded-lg border border-surface-200 focus:border-accent-400 focus:ring-1 focus:ring-accent-400 outline-none bg-white"
          >
            {categories.map(cat => (
              <option key={cat} value={cat}>
                {cat.charAt(0).toUpperCase() + cat.slice(1)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={() => {
              setEditHabit(habit);
              setIsEditing(false);
            }}
            className="px-3 py-1.5 text-sm text-surface-600 hover:bg-surface-100 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-3 py-1.5 text-sm bg-accent-500 text-white rounded-lg hover:bg-accent-600 transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between p-3 bg-white rounded-lg border border-surface-200 group">
      <div className="flex items-center gap-3">
        <span className="text-lg">{habit.emoji}</span>
        <div>
          <div className="font-medium text-surface-800">{habit.label}</div>
          <div className="text-xs text-surface-500">{habit.description}</div>
        </div>
      </div>
      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={() => setIsEditing(true)}
          className="p-1.5 text-surface-500 hover:text-accent-600 hover:bg-surface-100 rounded transition-colors"
          aria-label="Edit habit"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
          </svg>
        </button>
        <button
          onClick={onDelete}
          className="p-1.5 text-surface-500 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
          aria-label="Delete habit"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export function SettingsView() {
  const { state, updateSettings, updateHabits, importData: importAppData } = useApp();
  const [showImportConfirm, setShowImportConfirm] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [addingHabit, setAddingHabit] = useState(false);
  const [newHabit, setNewHabit] = useState<Partial<HabitDefinition>>({
    label: '',
    description: '',
    emoji: '',
    category: 'health',
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = () => {
    const data = exportData(state);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `life-calendar-backup-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = event => {
      const content = event.target?.result as string;
      const parsed = importData(content);
      if (parsed) {
        setShowImportConfirm(true);
        setImportError(null);
        // Store parsed data temporarily
        (window as unknown as { __pendingImport?: typeof parsed }).__pendingImport = parsed;
      } else {
        setImportError('Invalid file format. Please select a valid Life Calendar backup file.');
      }
    };
    reader.readAsText(file);
    e.target.value = ''; // Reset input
  };

  const confirmImport = () => {
    const parsed = (window as unknown as { __pendingImport?: typeof state }).__pendingImport;
    if (parsed) {
      importAppData(parsed);
      delete (window as unknown as { __pendingImport?: typeof state }).__pendingImport;
    }
    setShowImportConfirm(false);
  };

  const handleAddHabit = () => {
    if (!newHabit.label?.trim()) return;

    const habit: HabitDefinition = {
      id: Date.now().toString(36) + Math.random().toString(36).substr(2, 9),
      label: newHabit.label.trim(),
      description: newHabit.description?.trim() || '',
      emoji: newHabit.emoji?.trim() || '✓',
      category: newHabit.category || 'health',
    };

    updateHabits([...state.settings.habits, habit]);
    setNewHabit({ label: '', description: '', emoji: '', category: 'health' });
    setAddingHabit(false);
  };

  const handleUpdateHabit = (index: number, habit: HabitDefinition) => {
    const newHabits = [...state.settings.habits];
    newHabits[index] = habit;
    updateHabits(newHabits);
  };

  const handleDeleteHabit = (index: number) => {
    const newHabits = state.settings.habits.filter((_, i) => i !== index);
    updateHabits(newHabits);
  };

  const handleResetHabits = () => {
    if (window.confirm('Reset habits to defaults? This will remove any custom habits.')) {
      updateHabits(DEFAULT_HABITS);
    }
  };

  return (
    <div className="space-y-8 max-w-2xl">
      <h2 className="text-2xl font-semibold text-surface-800">Settings</h2>

      {/* Habits section */}
      <section className="bg-white rounded-xl border border-surface-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium text-surface-800">Habits</h3>
          <div className="flex gap-2">
            <button
              onClick={handleResetHabits}
              className="text-sm text-surface-500 hover:text-surface-700"
            >
              Reset to defaults
            </button>
          </div>
        </div>

        <div className="space-y-2 mb-4">
          {state.settings.habits.map((habit, index) => (
            <HabitEditor
              key={habit.id}
              habit={habit}
              onUpdate={h => handleUpdateHabit(index, h)}
              onDelete={() => handleDeleteHabit(index)}
            />
          ))}
        </div>

        {/* Add new habit */}
        {addingHabit ? (
          <div className="p-4 bg-surface-50 rounded-lg border border-dashed border-surface-300 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-surface-600 mb-1">Label *</label>
                <input
                  type="text"
                  value={newHabit.label || ''}
                  onChange={e => setNewHabit({ ...newHabit, label: e.target.value })}
                  placeholder="e.g., Meditation"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-surface-200 focus:border-accent-400 focus:ring-1 focus:ring-accent-400 outline-none"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs text-surface-600 mb-1">Emoji</label>
                <input
                  type="text"
                  value={newHabit.emoji || ''}
                  onChange={e => setNewHabit({ ...newHabit, emoji: e.target.value })}
                  placeholder="e.g., 🧘"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-surface-200 focus:border-accent-400 focus:ring-1 focus:ring-accent-400 outline-none"
                  maxLength={2}
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-surface-600 mb-1">Description</label>
              <input
                type="text"
                value={newHabit.description || ''}
                onChange={e => setNewHabit({ ...newHabit, description: e.target.value })}
                placeholder="e.g., 10+ minutes of mindfulness"
                className="w-full px-3 py-2 text-sm rounded-lg border border-surface-200 focus:border-accent-400 focus:ring-1 focus:ring-accent-400 outline-none"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setAddingHabit(false)}
                className="px-3 py-1.5 text-sm text-surface-600 hover:bg-surface-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAddHabit}
                disabled={!newHabit.label?.trim()}
                className="px-3 py-1.5 text-sm bg-accent-500 text-white rounded-lg hover:bg-accent-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Add Habit
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setAddingHabit(true)}
            className="w-full py-3 text-sm text-surface-500 border border-dashed border-surface-300 rounded-lg hover:border-accent-400 hover:text-accent-600 transition-colors"
          >
            + Add new habit
          </button>
        )}
      </section>

      {/* Preferences section */}
      <section className="bg-white rounded-xl border border-surface-200 p-5">
        <h3 className="text-lg font-medium text-surface-800 mb-4">Preferences</h3>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-surface-700 mb-2">Week starts on</label>
            <div className="flex gap-2">
              <button
                onClick={() => updateSettings({ weekStartsOn: 1 })}
                className={`px-4 py-2 text-sm rounded-lg border transition-colors ${
                  state.settings.weekStartsOn === 1
                    ? 'bg-accent-500 text-white border-accent-500'
                    : 'border-surface-200 text-surface-600 hover:border-surface-300'
                }`}
              >
                Monday
              </button>
              <button
                onClick={() => updateSettings({ weekStartsOn: 0 })}
                className={`px-4 py-2 text-sm rounded-lg border transition-colors ${
                  state.settings.weekStartsOn === 0
                    ? 'bg-accent-500 text-white border-accent-500'
                    : 'border-surface-200 text-surface-600 hover:border-surface-300'
                }`}
              >
                Sunday
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Data section */}
      <section className="bg-white rounded-xl border border-surface-200 p-5">
        <h3 className="text-lg font-medium text-surface-800 mb-4">Data</h3>

        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={handleExport}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-surface-100 text-surface-700 rounded-lg hover:bg-surface-200 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Export Data
            </button>
            <button
              onClick={handleImportClick}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-surface-100 text-surface-700 rounded-lg hover:bg-surface-200 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              Import Data
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleFileChange}
              className="hidden"
            />
          </div>

          {importError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {importError}
            </div>
          )}

          <p className="text-xs text-surface-500">
            Export your data as a JSON file for backup. Import will replace all existing data.
          </p>
        </div>
      </section>

      {/* Import confirmation modal */}
      {showImportConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 max-w-sm w-full shadow-xl">
            <h4 className="text-lg font-medium text-surface-800 mb-2">Import Data?</h4>
            <p className="text-sm text-surface-600 mb-4">
              This will replace all existing data with the imported file. This action cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowImportConfirm(false)}
                className="px-4 py-2 text-sm text-surface-600 hover:bg-surface-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmImport}
                className="px-4 py-2 text-sm bg-accent-500 text-white rounded-lg hover:bg-accent-600 transition-colors"
              >
                Import
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Keyboard shortcuts reference */}
      <section className="bg-white rounded-xl border border-surface-200 p-5">
        <h3 className="text-lg font-medium text-surface-800 mb-4">Keyboard Shortcuts</h3>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="flex items-center gap-3">
            <kbd className="px-2 py-1 bg-surface-100 rounded text-surface-600 font-mono text-xs">T</kbd>
            <span className="text-surface-600">Go to Today</span>
          </div>
          <div className="flex items-center gap-3">
            <kbd className="px-2 py-1 bg-surface-100 rounded text-surface-600 font-mono text-xs">W</kbd>
            <span className="text-surface-600">Week view</span>
          </div>
          <div className="flex items-center gap-3">
            <kbd className="px-2 py-1 bg-surface-100 rounded text-surface-600 font-mono text-xs">Y</kbd>
            <span className="text-surface-600">Year view</span>
          </div>
          <div className="flex items-center gap-3">
            <kbd className="px-2 py-1 bg-surface-100 rounded text-surface-600 font-mono text-xs">&larr; &rarr;</kbd>
            <span className="text-surface-600">Navigate days</span>
          </div>
        </div>
      </section>
    </div>
  );
}
