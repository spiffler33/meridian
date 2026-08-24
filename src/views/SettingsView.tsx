/**
 * Settings View
 *
 * Configuration. Theme, habits, data.
 */

import { useState, useEffect } from 'react';
import { useApp } from '../store/AppContext';
import { useTheme, THEMES } from '../store/ThemeContext';
import type { HabitDefinition, HabitCategory } from '../types';
import { DEFAULT_HABITS } from '../types';
import { saveApiKey, loadApiKey, clearApiKey } from '../services/claude';
import type { AiTone } from '../services/claude';
import { createHabit, updateHabit as updateHabitInDb, deleteHabit as deleteHabitInDb } from '../services/data';
import { clearToken, getDeviceId, getToken, requestPersistence, setMeta, setToken } from '../lib/db';
import { NewslettersSettings } from '../components/NewslettersSettings';
import { GITHUB_OWNER, GITHUB_REPO, isJournalDeviceId, listJournal, verifyAccess } from '../lib/github';

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

/**
 * What the browser says about keeping this origin's data, asked live.
 *
 * 'unknown' is a browser that cannot answer at all, which is a different thing
 * from a refusal: an installed home-screen app is often granted persistence
 * without ever being asked, and a grant can be lost again later, so a value
 * cached at the moment the button was last clicked describes nothing.
 */
type PersistenceAnswer = 'granted' | 'denied' | 'unknown';

async function readPersistence(): Promise<PersistenceAnswer> {
  const storage: StorageManager | undefined = navigator.storage;
  if (!storage || typeof storage.persisted !== 'function') return 'unknown';
  try {
    return (await storage.persisted()) ? 'granted' : 'denied';
  } catch {
    return 'unknown';
  }
}

export function SettingsView() {
  const { state, updateSettings, updateHabits, profile, updateProfile } = useApp();
  const { theme, setTheme } = useTheme();
  const [addingHabit, setAddingHabit] = useState(false);
  const [newHabitLabel, setNewHabitLabel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [apiKeySaving, setApiKeySaving] = useState(false);
  const [personalContext, setPersonalContext] = useState(profile?.personal_context || '');
  const [deviceId, setDeviceId] = useState('');
  const [savedDeviceId, setSavedDeviceId] = useState('');
  const [deviceSaved, setDeviceSaved] = useState(false);
  const [deviceProblem, setDeviceProblem] = useState('');
  const [tokenDraft, setTokenDraft] = useState('');
  const [tokenStored, setTokenStored] = useState(false);
  const [accessMessage, setAccessMessage] = useState('');
  // A verify that failed must not read like one that passed.
  const [accessFailed, setAccessFailed] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [persistence, setPersistence] = useState<PersistenceAnswer | null>(null);
  // Null means "not edited yet", so the field follows the profile until it is.
  const [usernameDraft, setUsernameDraft] = useState<string | null>(null);
  const [displayNameDraft, setDisplayNameDraft] = useState<string | null>(null);

  const username = usernameDraft ?? profile?.username ?? '';
  const displayName = displayNameDraft ?? profile?.display_name ?? '';

  useEffect(() => {
    loadApiKey().then(key => setApiKey(key));
  }, []);

  // The device id and whether a token is stored come from IndexedDB; the
  // persistence answer comes from the browser itself, live. Nothing here waits
  // on the network.
  useEffect(() => {
    let live = true;
    Promise.all([
      getDeviceId(),
      // Only ever the fact that one is stored. The token itself never reaches
      // component state, so it can never be rendered back.
      getToken().then(Boolean),
      readPersistence(),
    ]).then(
      ([id, stored, answer]) => {
        if (!live) return;
        setDeviceId(id);
        setSavedDeviceId(id);
        setTokenStored(stored);
        setPersistence(answer);
      },
      () => undefined
    );
    return () => {
      live = false;
    };
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

  /**
   * A second device writing under this id would append to the same journal
   * file, which is the one thing the per-device split exists to prevent. Best
   * effort only: offline, there is nothing to compare against, and the id is
   * saved either way.
   */
  const warnIfDeviceIdIsTaken = async (id: string) => {
    try {
      const token = await getToken();
      if (token === undefined || token.length === 0) return;
      const files = await listJournal(token);
      if (files.some(file => file.device === id)) {
        setDeviceProblem(
          'another device already writes that id. two devices sharing one journal file is what the per-device split exists to prevent.'
        );
      }
    } catch {
      // Nothing to compare against. Silence here is honest.
    }
  };

  const handleDeviceIdSave = async () => {
    const next = deviceId.trim();
    setDeviceSaved(false);
    // The id becomes the middle field of `YYYY-MM.<id>.jsonl`. A dot or a slash
    // in it writes a file the restore never reads, so the edited value is held
    // to the same closed alphabet the generated ones come from.
    if (!isJournalDeviceId(next)) {
      setDeviceProblem(
        'a device id is 8 characters from 0-9 and a-f. anything else names a journal file a restore never reads.'
      );
      return;
    }
    setDeviceProblem('');
    try {
      await setMeta('deviceId', next);
      setDeviceSaved(true);
      setSavedDeviceId(next);
    } catch (err) {
      console.error('Failed to save the device id:', err);
      setDeviceProblem('the device id could not be saved on this device');
      return;
    }
    if (next !== savedDeviceId) await warnIfDeviceIdIsTaken(next);
  };

  const handleTokenSave = async () => {
    const next = tokenDraft.trim();
    if (next.length === 0) return;
    try {
      await setToken(next);
      // Emptied on purpose: the field never shows what was entered, and the
      // placeholder is the only acknowledgement that something is stored.
      setTokenDraft('');
      setTokenStored(true);
      setAccessMessage('');
      setAccessFailed(false);
    } catch {
      // The reason is dropped rather than reported: it was raised while
      // handling the token, and nothing derived from it may be rendered.
      setAccessMessage('the token could not be saved on this device');
      setAccessFailed(true);
    }
  };

  const handleTokenClear = async () => {
    try {
      await clearToken();
      setTokenDraft('');
      setTokenStored(false);
      setAccessMessage('the token is no longer stored on this device');
      setAccessFailed(false);
    } catch {
      setAccessMessage('the token could not be removed from this device');
      setAccessFailed(true);
    }
  };

  const handleVerifyAccess = async () => {
    // Each click is a real request to GitHub. Without this the slower of two
    // answers wins, whichever question it was answering.
    if (verifying) return;
    setVerifying(true);
    setAccessMessage('');
    setAccessFailed(false);
    try {
      // Read straight from the store into a local, so it goes out of scope
      // with the call. A verify is a read-only probe: it writes nothing.
      const token = await getToken();
      if (token === undefined || token.length === 0) {
        setAccessMessage('no token is stored on this device yet');
        return;
      }
      const result = await verifyAccess(token);
      // The probe proves write access rather than asking GitHub to self-report
      // it, so this can claim the real thing. See github.ts for how.
      setAccessMessage(
        result.ok ? 'write access confirmed' : result.reason ?? 'access could not be confirmed'
      );
      setAccessFailed(!result.ok);
    } catch {
      setAccessMessage('access could not be checked');
      setAccessFailed(true);
    } finally {
      setVerifying(false);
    }
  };

  const handleRequestPersistence = async () => {
    try {
      await requestPersistence();
      // The browser's own answer, not what it said last time it was asked: a
      // grant can arrive without being asked for, and can be lost again.
      setPersistence(await readPersistence());
    } catch (err) {
      console.error('Failed to request persistent storage:', err);
    }
  };

  const handleUsernameSave = () => {
    if (usernameDraft === null) return;
    const next = usernameDraft.trim();
    setUsernameDraft(null);
    if (next === (profile?.username ?? '')) return;
    updateProfile({ username: next.length === 0 ? null : next });
  };

  const handleDisplayNameSave = () => {
    if (displayNameDraft === null) return;
    const next = displayNameDraft.trim();
    setDisplayNameDraft(null);
    if (next === (profile?.display_name ?? '')) return;
    updateProfile({ display_name: next.length === 0 ? null : next });
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

      {/* Device */}
      <section className="bg-bg-card rounded border border-border p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs text-text-muted uppercase tracking-wide">device</span>
          {deviceSaved && <span className="text-xs text-text-muted">saved</span>}
        </div>
        <div className="space-y-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={deviceId}
              onChange={e => { setDeviceId(e.target.value); setDeviceSaved(false); setDeviceProblem(''); }}
              placeholder="device id"
              className="flex-1 px-2 py-1.5 text-sm rounded border border-border bg-transparent text-text focus:border-accent outline-none font-mono"
            />
            <button
              onClick={handleDeviceIdSave}
              className="px-3 py-1.5 text-sm rounded border border-border text-text-muted hover:text-accent transition-colors"
            >
              save
            </button>
          </div>
          {deviceProblem && (
            <div className="text-xs text-error">{deviceProblem}</div>
          )}
          <div className="text-xs text-text-muted">
            this id names your journal file in the data repo. changing it starts a
            new file from the next edit on - the old one stays where it is, with
            its history intact.
          </div>
        </div>
      </section>

      {/* GitHub backup */}
      <section className="bg-bg-card rounded border border-border p-4">
        <div className="text-xs text-text-muted uppercase tracking-wide mb-3">github backup</div>
        <div className="space-y-3">
          <div className="flex gap-2">
            <input
              type="password"
              value={tokenDraft}
              onChange={e => setTokenDraft(e.target.value)}
              placeholder={tokenStored ? '•••••••• stored on this device' : 'github_pat_...'}
              // 'off' is ignored on a password field by both WebKit and
              // Chromium; 'new-password' is what actually stops the browser
              // offering to save the pat and refilling it later.
              autoComplete="new-password"
              spellCheck={false}
              className="flex-1 px-2 py-1.5 text-sm rounded border border-border bg-transparent text-text focus:border-accent outline-none font-mono"
            />
            <button
              onClick={handleTokenSave}
              className="px-3 py-1.5 text-sm rounded border border-border text-text-muted hover:text-accent transition-colors"
            >
              save
            </button>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleVerifyAccess}
              disabled={verifying}
              className="px-3 py-1.5 text-sm rounded border border-border text-text-muted hover:text-accent transition-colors disabled:opacity-50"
            >
              {verifying ? 'checking...' : 'verify access'}
            </button>
            {tokenStored && (
              <button
                onClick={handleTokenClear}
                className="px-3 py-1.5 text-sm rounded border border-border text-text-muted hover:text-error transition-colors"
              >
                clear
              </button>
            )}
          </div>
          {accessMessage && (
            <div className={accessFailed ? 'text-xs text-error' : 'text-xs text-text-muted'}>{accessMessage}</div>
          )}
          <div className="text-xs text-text-muted">
            a fine-grained token for {GITHUB_OWNER}/{GITHUB_REPO} with contents
            read and write. it stays on this device, goes nowhere but github,
            and is never shown again once saved.
          </div>
        </div>
      </section>

      {/* Newsletters, the reading pane's source repo */}
      <NewslettersSettings />

      {/* Storage */}
      <section className="bg-bg-card rounded border border-border p-4">
        <div className="text-xs text-text-muted uppercase tracking-wide mb-3">storage</div>
        <div className="space-y-3 text-xs text-text-muted">
          <div className="flex items-center justify-between gap-3">
            <span>
              {persistence === 'granted'
                ? 'persistent storage granted - this browser will keep the local copy'
                : persistence === 'denied'
                  ? 'persistent storage not granted - this browser may clear the local copy'
                  : persistence === 'unknown'
                    ? 'this browser cannot say whether it will keep the local copy'
                    : ''}
            </span>
            <button
              onClick={handleRequestPersistence}
              className="text-xs text-text-muted hover:text-accent transition-colors whitespace-nowrap"
            >
              ask again
            </button>
          </div>
          <p>
            the copy in this browser is the convenient one. the durable one is the
            journal in github - if this browser ever clears its data, that is what
            brings everything back.
          </p>
          <div className="space-y-1">
            <div className="text-text">install on iphone</div>
            <div>open meridian in safari, tap share, then "add to home screen".</div>
            <div>an installed app keeps its data far longer than a tab does.</div>
          </div>
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

      {/* About Meridian */}
      <section className="bg-bg-card rounded border border-border p-4">
        <div className="text-xs text-text-muted uppercase tracking-wide mb-3">about meridian</div>

        <div className="text-sm text-text leading-relaxed space-y-4 font-mono">
          <p className="text-text-muted">
            A place to steer attention, track habits, and see patterns. Nothing more.
          </p>

          <div className="space-y-3 text-xs">
            <div>
              <span className="text-text">[t] tower</span>
              <span className="text-text-muted ml-2">
                - surfaces what needs doing now. one item at a time.
                the rest stays queued, out of mind but not lost.
                blocked items wait patiently in "follow up."
              </span>
            </div>

            <div>
              <span className="text-text">[h] habits</span>
              <span className="text-text-muted ml-2">
                - daily toggles. did you or didn't you. no judgement,
                just data. set your three most important things each day.
              </span>
            </div>

            <div>
              <span className="text-text">[w] week</span>
              <span className="text-text-muted ml-2">
                - seven days at a glance. see which days held together
                and which fell apart. navigate with arrow keys.
              </span>
            </div>

            <div>
              <span className="text-text">[y] year</span>
              <span className="text-text-muted ml-2">
                - the long view. a heatmap of your days.
                patterns emerge that you couldn't see up close.
              </span>
            </div>

            <div>
              <span className="text-text">[s] settings</span>
              <span className="text-text-muted ml-2">
                - you are here. customize habits, themes, ai tone.
              </span>
            </div>
          </div>

          <p className="text-text-muted pt-2 border-t border-border">
            use [0] to return to today. arrow keys to move through time.
            everything saves automatically.
          </p>
        </div>
      </section>

      {/* Account */}
      <section className="bg-bg-card rounded border border-border p-4">
        <div className="text-xs text-text-muted uppercase tracking-wide mb-3">account</div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-text-muted mb-1">username</label>
            <input
              type="text"
              value={username}
              onChange={e => setUsernameDraft(e.target.value)}
              onBlur={handleUsernameSave}
              className="w-full px-2 py-1.5 text-sm rounded border border-border bg-transparent text-text focus:border-accent outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">display name</label>
            <input
              type="text"
              value={displayName}
              onChange={e => setDisplayNameDraft(e.target.value)}
              onBlur={handleDisplayNameSave}
              className="w-full px-2 py-1.5 text-sm rounded border border-border bg-transparent text-text focus:border-accent outline-none"
            />
          </div>
        </div>
      </section>
    </div>
  );
}
