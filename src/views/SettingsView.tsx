/**
 * Settings View
 *
 * Configuration. Theme, habits, data.
 */

import { useCallback, useState, useEffect, useRef } from 'react';
import { useApp } from '../store/AppContext';
import { useTheme, THEMES } from '../store/ThemeContext';
import type { HabitDefinition, HabitCategory } from '../types';
import { DEFAULT_HABITS } from '../types';
import { saveApiKey, loadApiKey, clearApiKey } from '../services/claude';
import type { AiTone } from '../services/claude';
import {
  backfillPulseCoding,
  countPulseCodingWork,
  createHabit,
  updateHabit as updateHabitInDb,
  deleteHabit as deleteHabitInDb,
  getPulseEffectAutoApply,
  setPulseEffectAutoApply,
} from '../services/data';
import type { BackfillProgress, CodingScope, CodingWork } from '../services/data';
import { PULSE_EFFECT_TYPES } from '../lib/entities';
import type { PulseEffectType } from '../lib/entities';
import { clearToken, getDeviceId, getToken, requestPersistence, setMeta, setToken } from '../lib/db';
import { Section } from '../components/Section';
import { NewslettersSettings } from '../components/NewslettersSettings';
import { CalendarSettings } from '../components/CalendarSettings';
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
            className="px-2 py-1 text-xs text-accent"
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
 * What the keys actually do, read off `useKeyboardShortcuts`.
 *
 * The old list claimed a day view and a week view, and neither exists: `t` is
 * the tower, and the week is a lens `w` opens inside the year rather than a
 * place you go. A shortcut list that is wrong is worse than none.
 */
const SHORTCUTS: { key: string; meaning: string }[] = [
  {
    key: 't',
    meaning:
      'tower — what needs doing now, one item at a time. the rest stays queued, out of mind but not lost. blocked items wait in "follow up".',
  },
  { key: 'p', meaning: 'pulse — the stream.' },
  {
    key: 'h',
    meaning:
      'habits — daily toggles. did you or didn\'t you. no judgement, just data. set your three most important things each day.',
  },
  {
    key: 'y',
    meaning:
      'year — the long view. a heatmap of your days. patterns emerge that you couldn\'t see up close.',
  },
  { key: 'r', meaning: 'read — the reading pane.' },
  { key: 's', meaning: 'settings — you are here.' },
  { key: '0', meaning: 'today.' },
  { key: '←', meaning: 'previous day.' },
  { key: '→', meaning: 'next day.' },
  {
    key: 'w',
    meaning:
      'opens the week lens inside year — seven days at a glance, which held together and which fell apart. not a view of its own.',
  },
];

/**
 * What each of Appendix C's effects would do, in the owner's words.
 *
 * One is left after phase 4. The vocabulary proposal is deliberately not here
 * and must never be: it is the only proposal with no automatic path at all,
 * because it edits the vocabulary the coder reads on every subsequent call.
 */
const EFFECT_LABELS: Record<PulseEffectType, string> = {
  claimEvent: 'claim an event',
};

/** Every switch off — what a device that has never been asked answers. */
const NO_AUTO_APPLY: Record<PulseEffectType, boolean> = {
  claimEvent: false,
};

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
  // Device-local, and off until the store says otherwise: a fresh device must
  // never apply anything by itself before it has been told to.
  const [autoApply, setAutoApply] = useState<Record<PulseEffectType, boolean>>(NO_AUTO_APPLY);
  // Null means "not edited yet", so the field follows the profile until it is.
  const [usernameDraft, setUsernameDraft] = useState<string | null>(null);
  const [displayNameDraft, setDisplayNameDraft] = useState<string | null>(null);
  const [kcalTargetDraft, setKcalTargetDraft] = useState<string | null>(null);
  const [personalContextDraft, setPersonalContextDraft] = useState<string | null>(null);
  // The whole coding UI is four pieces of state: the two piles of work and what
  // they would cost, what a run has done so far, whether one is running, and the
  // controller that stops it.
  const [codingWork, setCodingWork] = useState<{ uncoded: CodingScope; staleRev: CodingScope } | null>(null);
  const [backfillProgress, setBackfillProgress] = useState<BackfillProgress | null>(null);
  const [backfilling, setBackfilling] = useState(false);
  const backfillStop = useRef<AbortController | null>(null);

  const username = usernameDraft ?? profile?.username ?? '';
  const displayName = displayNameDraft ?? profile?.display_name ?? '';
  const personalContext = personalContextDraft ?? profile?.personal_context ?? '';

  useEffect(() => {
    loadApiKey().then(key => setApiKey(key));
  }, []);

  // The auto-apply switches, from `meta`. A read that fails leaves every
  // switch DRAWN off — which is all this panel can say, not what the device
  // will do: `autoApplyEffects` reads `meta` itself at apply time, so a type
  // that is really on keeps applying while these say it does not.
  useEffect(() => {
    let live = true;
    Promise.all(PULSE_EFFECT_TYPES.map(type => getPulseEffectAutoApply(type))).then(
      answers => {
        if (!live) return;
        const next = { ...NO_AUTO_APPLY };
        PULSE_EFFECT_TYPES.forEach((type, index) => { next[type] = answers[index]; });
        setAutoApply(next);
      },
      () => undefined
    );
    return () => {
      live = false;
    };
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

  const handleToneChange = (tone: AiTone) => {
    updateProfile({ ai_tone: tone });
  };

  const handleContextSave = () => {
    if (personalContextDraft === null) return;
    const next = personalContextDraft;
    setPersonalContextDraft(null);
    if (next === (profile?.personal_context ?? '')) return;
    updateProfile({ personal_context: next });
  };

  /**
   * Save the calorie target, or clear it.
   *
   * Blank means off, and so does anything that is not a positive number: the
   * field is one box and there is no error state for it, because a target the
   * app could not read is the same as no target — the line simply stops
   * printing "of ...". Stored as a number so nothing downstream has to parse
   * a string the owner typed.
   */
  const handleKcalTargetSave = () => {
    if (kcalTargetDraft === null) return;
    const parsed = Number(kcalTargetDraft.trim());
    const next = kcalTargetDraft.trim().length > 0 && Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    setKcalTargetDraft(null);
    updateProfile({ kcal_target: next });
  };

  /**
   * Read both piles of work and show them.
   *
   * It runs on mount rather than waiting for a tap. Answering costs nothing —
   * it is a read of the local store — and the tap it used to require was pure
   * fuss: the owner had to already suspect something was owed before the app
   * would tell them. The price still sits next to each run button before it is
   * pressed, which is the confirmation that matters and the reason there is no
   * "are you sure" modal.
   */
  const refreshCodingWork = useCallback(async () => {
    try {
      setCodingWork(await countPulseCodingWork());
    } catch {
      setCodingWork(null);
    }
  }, []);

  useEffect(() => {
    void refreshCodingWork();
  }, [refreshCodingWork]);

  /**
   * Run it. Sequential inside, so this awaits the whole run; the progress
   * callback is what moves the number on screen while it does.
   *
   * A run that fails partway is not an error state here — the tool reports
   * how many failed and the button says run again, which is the entire retry
   * story (each success wrote its rev, so a rerun skips what landed).
   */
  const handleBackfillRun = async (which: CodingWork) => {
    const controller = new AbortController();
    backfillStop.current = controller;
    setBackfillProgress(null);
    setBackfilling(true);
    try {
      const final = await backfillPulseCoding(which, setBackfillProgress, controller.signal);
      setBackfillProgress(final);
      await refreshCodingWork();
    } catch {
      // Nothing here throws in practice — every per-pulse failure is counted
      // rather than raised — and if one ever does, the numbers on screen are
      // still the truth about what landed.
    } finally {
      setBackfilling(false);
      backfillStop.current = null;
    }
  };

  /**
   * Flip one effect's auto-apply. Optimistic, and put back if the write fails
   * — a switch that reads on while the store says off would auto-apply
   * nothing, which is a lie the owner would only find out about later.
   */
  const handleAutoApplyChange = (type: PulseEffectType, on: boolean) => {
    setAutoApply(previous => ({ ...previous, [type]: on }));
    setPulseEffectAutoApply(type, on).catch(() => {
      setAutoApply(previous => ({ ...previous, [type]: !on }));
    });
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
    <div className="space-y-8 max-w-xl">
      <h2 className="text-lg font-medium text-text">settings</h2>

      <Section label="appearance">
        <div className="grid grid-cols-3 gap-2">
          {THEMES.map(t => (
            <button
              key={t.name}
              onClick={() => setTheme(t.name)}
              className={`px-2 py-2 rounded border text-sm transition-colors ${
                theme === t.name
                  ? 'border-accent text-accent'
                  : 'border-border text-text-muted hover:text-text hover:border-border-focus'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="space-y-2">
          <div className="text-xs text-text-secondary">week starts</div>
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
        </div>
      </Section>

      <Section
        label="habits"
        aside={
          <button
            onClick={() => updateHabits(DEFAULT_HABITS)}
            className="text-xs text-text-muted hover:text-text"
          >
            reset
          </button>
        }
      >
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
          <div className="flex items-center gap-2">
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
            className="w-full text-xs text-text-muted hover:text-accent text-left"
          >
            + add habit
          </button>
        )}
      </Section>

      <Section label="data">
        {/* Device */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-secondary">device</span>
            {deviceSaved && <span className="text-xs text-text-muted">saved</span>}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={deviceId}
              onChange={e => { setDeviceId(e.target.value); setDeviceSaved(false); setDeviceProblem(''); }}
              placeholder="device id"
              className="flex-1 px-2 py-1.5 text-sm rounded border border-border bg-transparent text-text focus:border-accent outline-none"
            />
            <button
              onClick={handleDeviceIdSave}
              className="px-3 py-1.5 text-sm rounded border border-border text-text-muted hover:text-accent transition-colors"
            >
              save
            </button>
          </div>
          {deviceProblem && <div className="text-xs text-error">{deviceProblem}</div>}
          <div className="text-xs text-text-muted">
            this id names your journal file in the data repo. changing it starts a
            new file from the next edit on - the old one stays where it is, with
            its history intact.
          </div>
        </div>

        {/* GitHub backup */}
        <div className="space-y-2">
          <div className="text-xs text-text-secondary">github backup</div>
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
              className="flex-1 px-2 py-1.5 text-sm rounded border border-border bg-transparent text-text focus:border-accent outline-none"
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

        {/* Newsletters, the reading pane's source repo */}
        <NewslettersSettings />

        <CalendarSettings />

        {/* Storage, and what installing it buys */}
        <div className="space-y-2">
          <div className="text-xs text-text-secondary">storage</div>
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
        </div>

        {/* Account */}
        <div className="space-y-2">
          <div className="text-xs text-text-secondary">account</div>
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
        </div>
      </Section>

      <Section label="ai">
        {/* Claude API */}
        <div className="space-y-2">
          <div className="text-xs text-text-secondary">claude api key</div>
          <div className="flex gap-2">
            <input
              type={apiKeyVisible ? 'text' : 'password'}
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="sk-ant-..."
              className="flex-1 px-2 py-1.5 text-sm rounded border border-border bg-transparent text-text focus:border-accent outline-none"
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

        {/* Tone. Read by the daily insight: `AiInsight` hands it to
            `generateEnhancedInsight`, which opens the prompt with it. */}
        <div className="space-y-2">
          <div className="text-xs text-text-secondary">tone</div>
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

        {/* Personal context — the owner's own words, so the reading face. */}
        <div className="space-y-2">
          <div className="text-xs text-text-secondary">personal context</div>
          <textarea
            value={personalContext}
            onChange={e => setPersonalContextDraft(e.target.value)}
            onBlur={handleContextSave}
            placeholder="health goals, struggles, what matters this year..."
            className="w-full px-2 py-1.5 font-read text-base rounded border border-border bg-transparent text-text focus:border-accent outline-none resize-none"
            rows={3}
          />
        </div>

        {/* Pulse effects */}
        <div className="space-y-2">
          <div className="text-xs text-text-secondary">pulse effects</div>
          <div className="text-xs text-text-muted leading-relaxed">
            a coding proposes; you tap. switch one on and it applies itself as a coding lands —
            never reaching back over pulses already coded. vocabulary is always confirmed by hand.
          </div>
          {PULSE_EFFECT_TYPES.map(type => (
            <label key={type} className="flex items-center gap-2 cursor-pointer group">
              <input
                type="checkbox"
                checked={autoApply[type]}
                onChange={e => handleAutoApplyChange(type, e.target.checked)}
                className="accent-accent"
              />
              <span className="text-sm text-text group-hover:text-accent transition-colors">
                {EFFECT_LABELS[type]}
              </span>
            </label>
          ))}
        </div>

        {/* Coding: two disjoint piles, two decisions */}
        <div className="space-y-3">
          <div className="text-xs text-text-secondary">coding</div>

          {/*
            The backlog. This is the number that answers "is anything still
            owed?", and it is normally zero — the sweep walks it on open and
            again whenever the app comes back to the foreground, so a coding
            dropped by a bad connection heals when the phone is next picked up.
            The button is the escape hatch for when that keeps failing, not the
            way the backlog is meant to be cleared.
          */}
          <div className="space-y-1.5">
            {codingWork !== null && backfillProgress === null && (
              <div className="text-sm text-text tabular-nums">
                {codingWork.uncoded.count === 0
                  ? 'every pulse is coded'
                  : `${codingWork.uncoded.count} not yet coded, roughly $${codingWork.uncoded.approxCostUsd.toFixed(2)}`}
              </div>
            )}
            {!backfilling && codingWork !== null && codingWork.uncoded.count > 0 && (
              <button
                onClick={() => void handleBackfillRun('uncoded')}
                className="px-3 py-1.5 text-sm rounded border border-accent text-accent hover:bg-bg-hover transition-colors"
              >
                code {codingWork.uncoded.count}
              </button>
            )}
          </div>

          {/* The catch-up tool. A different decision at a different price. */}
          <div className="space-y-1.5">
            <div className="text-xs text-text-muted leading-relaxed">
              re-reads past pulses through the current coder, so older ones gain the fields newer
              ones have. it writes coding only — never the text you typed, and no chips about last
              tuesday. it costs one api call per pulse. resume by pressing it again.
            </div>
            {codingWork !== null && backfillProgress === null && (
              <div className="text-sm text-text tabular-nums">
                {codingWork.staleRev.count === 0
                  ? 'nothing to re-code — every coded pulse is current'
                  : `${codingWork.staleRev.count} at an older revision, roughly $${codingWork.staleRev.approxCostUsd.toFixed(2)}`}
              </div>
            )}
            {!backfilling && codingWork !== null && codingWork.staleRev.count > 0 && (
              <button
                onClick={() => void handleBackfillRun('staleRev')}
                className="px-3 py-1.5 text-sm rounded border border-border text-text hover:border-accent transition-colors"
              >
                re-code {codingWork.staleRev.count}
              </button>
            )}
          </div>

          {/*
            `done` is what LANDED, never what was attempted. This line used to
            read `done + failed` as "done", so a run of one pulse that failed
            said "1 of 1 done · 1 failed" — two numbers contradicting each
            other about one pulse, on the surface whose whole job is to say
            whether anything is owed.
          */}
          {backfillProgress !== null && (
            <div className="text-sm text-text tabular-nums">
              {backfillProgress.done === 0 && backfillProgress.failed > 0
                ? `none of ${backfillProgress.total} coded · try again`
                : `${backfillProgress.done} of ${backfillProgress.total} coded`}
              {backfillProgress.done > 0 && backfillProgress.failed > 0 && ` · ${backfillProgress.failed} failed, run again`}
            </div>
          )}

          {backfilling && (
            <button
              onClick={() => backfillStop.current?.abort()}
              className="px-3 py-1.5 text-sm rounded border border-border text-error hover:border-error transition-colors"
            >
              stop
            </button>
          )}
        </div>
      </Section>

      <Section label="nutrition">
        <div className="text-xs text-text-muted leading-relaxed">
          a daily calorie target, printed beside today's total. nothing compares against it and
          nothing is said about the gap — it is a number next to a number. blank turns it off.
        </div>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          value={kcalTargetDraft ?? (profile?.kcal_target === null || profile?.kcal_target === undefined ? '' : String(profile.kcal_target))}
          onChange={e => setKcalTargetDraft(e.target.value)}
          onBlur={handleKcalTargetSave}
          placeholder="daily kcal target"
          aria-label="daily kcal target"
          className="w-full px-2 py-1.5 text-sm tabular-nums rounded border border-border bg-transparent text-text focus:border-accent outline-none"
        />
      </Section>

      <Section label="shortcuts">
        <div className="space-y-1 text-xs">
          {SHORTCUTS.map(shortcut => (
            <div key={shortcut.key} className="grid grid-cols-[2rem_1fr] gap-3">
              <span className="text-text-muted">{shortcut.key}</span>
              <span className="text-text-secondary">{shortcut.meaning}</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-text-muted">
          a place to steer attention, track habits, and see patterns. nothing more.
          everything saves automatically.
        </p>
      </Section>
    </div>
  );
}
