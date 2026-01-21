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

export function AuthScreen() {
  const { login, signup, loading, error, clearError } = useAuth();
  const [mode, setMode] = useState<AuthMode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [usernameError, setUsernameError] = useState<string | null>(null);

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
      <div className="w-full max-w-xs">
        {/* Title */}
        <h1 className="text-lg font-mono text-text-secondary mb-8 text-center tracking-wider">
          MERIDIAN
        </h1>

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
