/**
 * Settings View
 *
 * Configuration. Theme, habits, data.
 */

import { useState, useEffect } from 'react';
import { useApp } from '../store/AppContext';
import { useAuth } from '../store/AuthContext';
import { useTheme, THEMES } from '../store/ThemeContext';
import type { HabitDefinition, HabitCategory } from '../types';
import { DEFAULT_HABITS } from '../types';
import { saveApiKey, loadApiKey, clearApiKey } from '../services/claude';
import type { AiTone } from '../services/claude';
import { createHabit, updateHabit as updateHabitInDb, deleteHabit as deleteHabitInDb } from '../services/data';

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
      <div className="p-3 bg-bg-hover rounded border border-border space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-text-muted mb-1">label</label>
            <input
              type="text"
              value={editHabit.label}
              onChange={e => setEditHabit({ ...editHabit, label: e.target.value })}
              className="w-full px-2 py-1.5 text-sm rounded border border-border bg-bg-card text-text focus:border-accent outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">category</label>
            <select
              value={editHabit.category}
              onChange={e => setEditHabit({ ...editHabit, category: e.target.value as HabitCategory })}
              className="w-full px-2 py-1.5 text-sm rounded border border-border bg-bg-card text-text focus:border-accent outline-none"
            >
              {categories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="block text-xs text-text-muted mb-1">description</label>
          <input
            type="text"
            value={editHabit.description || ''}
            onChange={e => setEditHabit({ ...editHabit, description: e.target.value })}
            className="w-full px-2 py-1.5 text-sm rounded border border-border bg-bg-card text-text focus:border-accent outline-none"
          />
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={() => { setEditHabit(habit); setIsEditing(false); }}
            className="px-2 py-1 text-xs text-text-muted hover:text-text"
          >
            cancel
          </button>
          <button
            onClick={handleSave}
            className="px-2 py-1 text-xs text-accent hover:text-accent-hover"
          >
            save
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between py-2 group">
      <div>
        <div className="text-sm text-text">{habit.label}</div>
        {habit.description && (
          <div className="text-xs text-text-muted">{habit.description}</div>
        )}
      </div>
      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={() => setIsEditing(true)}
          className="text-xs text-text-muted hover:text-text"
        >
          edit
        </button>
        <button
          onClick={onDelete}
          className="text-xs text-text-muted hover:text-error"
        >
          ×
        </button>
      </div>
    </div>
  );
}

const AI_TONES: { value: AiTone; label: string; description: string }[] = [
  { value: 'stoic', label: 'stoic', description: 'minimal, focused on leverage' },
  { value: 'friendly', label: 'friendly', description: 'warm, supportive coach' },
  { value: 'wise', label: 'wise', description: 'thoughtful friend, conversational' },
];

export function SettingsView() {
  const { state, updateSettings, updateHabits } = useApp();
  const { profile, updateProfile, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const [addingHabit, setAddingHabit] = useState(false);
  const [newHabitLabel, setNewHabitLabel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [apiKeySaving, setApiKeySaving] = useState(false);
  const [personalContext, setPersonalContext] = useState(profile?.personal_context || '');

  useEffect(() => {
    loadApiKey().then(key => setApiKey(key));
  }, []);

  useEffect(() => {
    setPersonalContext(profile?.personal_context || '');
  }, [profile?.personal_context]);

  const handleToneChange = (tone: AiTone) => {
    updateProfile({ ai_tone: tone });
  };

  const handleContextSave = () => {
    updateProfile({ personal_context: personalContext });
  };

  const handleSaveApiKey = async () => {
    setApiKeySaving(true);
    try {
      await saveApiKey(apiKey);
    } catch (err) {
      console.error('Failed to save API key:', err);
    } finally {
      setApiKeySaving(false);
    }
  };

  const handleClearApiKey = async () => {
    setApiKeySaving(true);
    try {
      await clearApiKey();
      setApiKey('');
    } catch (err) {
      console.error('Failed to clear API key:', err);
    } finally {
      setApiKeySaving(false);
    }
  };

  const handleAddHabit = async () => {
    if (!newHabitLabel.trim()) return;
    try {
      const newHabit = await createHabit({
        label: newHabitLabel.trim(),
        description: '',
        category: 'health',
        emoji: '',
      });
      // Convert to HabitDefinition format and update local state
      const habitDef: HabitDefinition = {
        id: newHabit.id,
        label: newHabit.label,
        description: newHabit.description || undefined,
        category: newHabit.category as HabitDefinition['category'],
        emoji: newHabit.emoji || undefined,
      };
      updateHabits([...state.settings.habits, habitDef]);
      setNewHabitLabel('');
      setAddingHabit(false);
    } catch (err) {
      console.error('Failed to create habit:', err);
    }
  };

  const handleUpdateHabit = async (index: number, habit: HabitDefinition) => {
    try {
      await updateHabitInDb(habit.id, {
        label: habit.label,
        description: habit.description || null,
        category: habit.category,
        emoji: habit.emoji || null,
      });
      const newHabits = [...state.settings.habits];
      newHabits[index] = habit;
      updateHabits(newHabits);
    } catch (err) {
      console.error('Failed to update habit:', err);
    }
  };

  const handleDeleteHabit = async (index: number) => {
    const habit = state.settings.habits[index];
    try {
      await deleteHabitInDb(habit.id);
      updateHabits(state.settings.habits.filter((_, i) => i !== index));
    } catch (err) {
      console.error('Failed to delete habit:', err);
    }
  };

  return (
    <div className="space-y-6 max-w-xl">
      <h2 className="text-lg font-medium text-text">settings</h2>

      {/* Theme */}
      <section className="bg-bg-card rounded border border-border p-4">
        <div className="text-xs text-text-muted uppercase tracking-wide mb-3">theme</div>
        <div className="grid grid-cols-5 gap-2">
          {THEMES.map(t => (
            <button
              key={t.name}
              onClick={() => setTheme(t.name)}
              className={`
                px-2 py-2 rounded border text-xs transition-all
                ${theme === t.name
                  ? 'border-accent text-accent'
                  : 'border-border text-text-muted hover:text-text hover:border-border-focus'
                }
              `}
            >
              {t.label.toLowerCase()}
            </button>
          ))}
        </div>
      </section>

      {/* Habits */}
      <section className="bg-bg-card rounded border border-border p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs text-text-muted uppercase tracking-wide">habits</span>
          <button
            onClick={() => updateHabits(DEFAULT_HABITS)}
            className="text-xs text-text-muted hover:text-text"
          >
            reset
          </button>
        </div>

        <div className="divide-y divide-border">
          {state.settings.habits.map((habit, index) => (
            <HabitEditor
              key={habit.id}
              habit={habit}
              onUpdate={h => handleUpdateHabit(index, h)}
              onDelete={() => handleDeleteHabit(index)}
            />
          ))}
        </div>

        {addingHabit ? (
          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border">
            <input
              type="text"
              value={newHabitLabel}
              onChange={e => setNewHabitLabel(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAddHabit(); if (e.key === 'Escape') setAddingHabit(false); }}
              placeholder="habit name"
              className="flex-1 px-2 py-1.5 text-sm rounded border border-border bg-transparent text-text focus:border-accent outline-none"
              autoFocus
            />
            <button onClick={handleAddHabit} className="text-xs text-accent">add</button>
            <button onClick={() => setAddingHabit(false)} className="text-xs text-text-muted">cancel</button>
          </div>
        ) : (
          <button
            onClick={() => setAddingHabit(true)}
            className="w-full mt-3 pt-3 border-t border-border text-xs text-text-muted hover:text-accent text-left"
          >
            + add habit
          </button>
        )}
      </section>

      {/* Week start */}
      <section className="bg-bg-card rounded border border-border p-4">
        <div className="text-xs text-text-muted uppercase tracking-wide mb-3">week starts</div>
        <div className="flex gap-2">
          <button
            onClick={() => updateSettings({ weekStartsOn: 1 })}
            className={`px-3 py-1.5 text-sm rounded border transition-colors ${
              state.settings.weekStartsOn === 1
                ? 'border-accent text-accent'
                : 'border-border text-text-muted hover:text-text'
            }`}
          >
            monday
          </button>
          <button
            onClick={() => updateSettings({ weekStartsOn: 0 })}
            className={`px-3 py-1.5 text-sm rounded border transition-colors ${
              state.settings.weekStartsOn === 0
                ? 'border-accent text-accent'
                : 'border-border text-text-muted hover:text-text'
            }`}
          >
            sunday
          </button>
        </div>
      </section>

      {/* Claude API */}
      <section className="bg-bg-card rounded border border-border p-4">
        <div className="text-xs text-text-muted uppercase tracking-wide mb-3">ai insights (claude api)</div>
        <div className="space-y-3">
          <div className="flex gap-2">
            <input
              type={apiKeyVisible ? 'text' : 'password'}
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="sk-ant-..."
              className="flex-1 px-2 py-1.5 text-sm rounded border border-border bg-transparent text-text focus:border-accent outline-none font-mono"
            />
            <button
              onClick={() => setApiKeyVisible(!apiKeyVisible)}
              className="px-2 py-1.5 text-xs text-text-muted hover:text-text border border-border rounded"
            >
              {apiKeyVisible ? 'hide' : 'show'}
            </button>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSaveApiKey}
              disabled={apiKeySaving}
              className="px-3 py-1.5 text-sm rounded border border-border text-text-muted hover:text-accent transition-colors disabled:opacity-50"
            >
              {apiKeySaving ? 'saving...' : 'save key'}
            </button>
            {apiKey && (
              <button
                onClick={handleClearApiKey}
                disabled={apiKeySaving}
                className="px-3 py-1.5 text-sm rounded border border-border text-text-muted hover:text-error transition-colors disabled:opacity-50"
              >
                clear
              </button>
            )}
          </div>
          <div className="text-xs text-text-muted">
            get your key from{' '}
            <a
              href="https://console.anthropic.com/settings/keys"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline"
            >
              console.anthropic.com
            </a>
          </div>
        </div>
      </section>

      {/* AI Assistant */}
      <section className="bg-bg-card rounded border border-border p-4">
        <div className="text-xs text-text-muted uppercase tracking-wide mb-3">ai assistant</div>
        <div className="space-y-4">
          {/* Tone selector */}
          <div>
            <div className="text-xs text-text-muted mb-2">tone</div>
            <div className="space-y-2">
              {AI_TONES.map(tone => (
                <label key={tone.value} className="flex items-start gap-2 cursor-pointer group">
                  <input
                    type="radio"
                    name="ai-tone"
                    value={tone.value}
                    checked={(profile?.ai_tone || 'stoic') === tone.value}
                    onChange={() => handleToneChange(tone.value)}
                    className="mt-0.5 accent-accent"
                  />
                  <div>
                    <span className="text-sm text-text group-hover:text-accent transition-colors">
                      {tone.label}
                    </span>
                    <span className="text-xs text-text-muted ml-2">
                      - {tone.description}
                    </span>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Personal context */}
          <div>
            <div className="text-xs text-text-muted mb-2">
              personal context
              <span className="ml-2 text-text-muted opacity-60">(also editable in year view)</span>
            </div>
            <textarea
              value={personalContext}
              onChange={e => setPersonalContext(e.target.value)}
              onBlur={handleContextSave}
              placeholder="health goals, struggles, what matters this year..."
              className="w-full px-2 py-1.5 text-sm rounded border border-border bg-transparent text-text focus:border-accent outline-none resize-none"
              rows={3}
            />
          </div>
        </div>
      </section>

      {/* Shortcuts */}
      <section className="bg-bg-card rounded border border-border p-4">
        <div className="text-xs text-text-muted uppercase tracking-wide mb-3">shortcuts</div>
        <div className="text-xs text-text-muted font-mono space-y-1">
          <div>[t] day view</div>
          <div>[w] week view</div>
          <div>[y] year view</div>
          <div>[←][→] navigate</div>
        </div>
      </section>

      {/* Account */}
      <section className="bg-bg-card rounded border border-border p-4">
        <div className="text-xs text-text-muted uppercase tracking-wide mb-3">account</div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-text">{profile?.username || 'unknown'}</span>
          <button
            onClick={logout}
            className="px-3 py-1.5 text-sm rounded border border-border text-text-muted hover:text-error hover:border-error transition-colors"
          >
            logout
          </button>
        </div>
      </section>
    </div>
  );
}
