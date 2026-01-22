/**
 * Auth Screen
 *
 * Login and signup form with terminal aesthetic.
 * Inline error display, keyboard-first.
 */

import { useState, useCallback } from 'react';
import { useAuth } from '../store/AuthContext';
import { getUsernameError } from '../services/auth';

type AuthMode = 'login' | 'signup';

const MERIDIAN_SYMBOLS = ['◐', '☉', '│', '✦', '◉'];

function getMeridianSymbol(): string {
  const hour = new Date().getHours();
  return MERIDIAN_SYMBOLS[hour % MERIDIAN_SYMBOLS.length];
}

export function AuthScreen() {
  const { login, signup, loading, error, clearError } = useAuth();
  const [mode, setMode] = useState<AuthMode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [showAbout, setShowAbout] = useState(false);

  const handleUsernameChange = useCallback((value: string) => {
    const normalized = value.toLowerCase();
    setUsername(normalized);
    clearError();

    // Only validate on signup mode
    if (mode === 'signup' && normalized.length > 0) {
      setUsernameError(getUsernameError(normalized));
    } else {
      setUsernameError(null);
    }
  }, [mode, clearError]);

  const handlePasswordChange = useCallback((value: string) => {
    setPassword(value);
    clearError();
  }, [clearError]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();

    if (mode === 'signup') {
      const validationError = getUsernameError(username);
      if (validationError) {
        setUsernameError(validationError);
        return;
      }
    }

    if (mode === 'login') {
      await login(username, password);
    } else {
      await signup(username, password);
    }
  }, [mode, username, password, login, signup]);

  const toggleMode = useCallback(() => {
    setMode(prev => prev === 'login' ? 'signup' : 'login');
    setUsernameError(null);
    clearError();
  }, [clearError]);

  const displayError = error || usernameError;

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-4">
      {/* About Modal */}
      {showAbout && (
        <div
          className="fixed inset-0 bg-bg/90 flex items-center justify-center p-4 z-50"
          onClick={() => setShowAbout(false)}
        >
          <div
            className="w-full max-w-md bg-bg-card border border-border rounded p-6 space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="text-xs text-text-muted uppercase tracking-wide">what is meridian</div>

            <div className="text-sm text-text leading-relaxed space-y-3 font-mono">
              <p>
                Most tools try to manage your time. This one manages your attention.
              </p>
              <p>
                Each day, it surfaces what matters now - one thing, then the next.
                The rest waits out of sight. Not forgotten, just quiet.
              </p>
              <p>
                Track habits without fanfare. See patterns emerge over weeks
                and months. Notice what works. Discard what doesn't.
              </p>
              <p>
                No badges. No streaks that punish you for living.
                Just a calm record of days.
              </p>
              <p className="text-text-muted">
                A place to think clearly.
              </p>
            </div>

            <button
              onClick={() => setShowAbout(false)}
              className="w-full mt-4 px-3 py-2 text-xs font-mono text-text-muted hover:text-text border border-border rounded transition-colors"
            >
              close
            </button>
          </div>
        </div>
      )}

      <div className="w-full max-w-xs">
        {/* Title */}
        <h1 className="text-sm font-medium text-text-secondary italic tracking-[0.25em] mb-2 text-center">
          <span className="opacity-50 mr-1">{getMeridianSymbol()}</span>M E R I D I A N
        </h1>

        {/* What is this link */}
        <button
          type="button"
          onClick={() => setShowAbout(true)}
          className="w-full text-center text-xs font-mono text-text-muted hover:text-text mb-8 transition-colors"
        >
          what is this?
        </button>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Username */}
          <div>
            <input
              type="text"
              value={username}
              onChange={e => handleUsernameChange(e.target.value)}
              placeholder="username"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="w-full px-3 py-2 text-sm font-mono rounded border border-border bg-bg-card text-text placeholder:text-text-muted focus:border-accent focus:outline-none transition-colors duration-150"
              disabled={loading}
            />
          </div>

          {/* Password */}
          <div>
            <input
              type="password"
              value={password}
              onChange={e => handlePasswordChange(e.target.value)}
              placeholder="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              className="w-full px-3 py-2 text-sm font-mono rounded border border-border bg-bg-card text-text placeholder:text-text-muted focus:border-accent focus:outline-none transition-colors duration-150"
              disabled={loading}
            />
          </div>

          {/* Error display (inline) */}
          {displayError && (
            <div className="text-xs font-mono text-error">
              {displayError}
            </div>
          )}

          {/* Submit button */}
          <button
            type="submit"
            disabled={loading}
            className="w-full px-3 py-2 text-sm font-mono rounded border border-accent text-accent hover:bg-accent hover:text-bg transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'loading...' : mode === 'login' ? 'Login' : 'Sign up'}
          </button>
        </form>

        {/* Mode toggle */}
        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={toggleMode}
            className="text-xs font-mono text-text-muted hover:text-text transition-colors duration-150"
            disabled={loading}
          >
            {mode === 'login'
              ? "Don't have an account? Create one"
              : 'Already have an account? Login'}
          </button>
        </div>
      </div>
    </div>
  );
}
