/**
 * Focus Prompt
 *
 * Morning ritual. Forces you to declare the ONE thing
 * before seeing everything else.
 */

import { useState } from 'react';

interface FocusPromptProps {
  onSetFocus: (focus: string) => void;
  onSkip: () => void;
}

export function FocusPrompt({ onSetFocus, onSkip }: FocusPromptProps) {
  const [focus, setFocus] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (focus.trim()) {
      onSetFocus(focus.trim());
    }
  };

  return (
    <div className="fixed inset-0 bg-bg z-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <h1 className="text-lg font-medium text-text">
              What's the ONE thing today?
            </h1>
            <p className="text-sm text-text-muted">
              If you could only accomplish one thing, what would make today a win?
            </p>
          </div>

          <input
            type="text"
            value={focus}
            onChange={e => setFocus(e.target.value)}
            placeholder="The one thing that matters most..."
            className="w-full px-4 py-3 text-lg rounded border border-border bg-bg-card text-text focus:border-accent outline-none"
            autoFocus
          />

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={!focus.trim()}
              className="flex-1 px-4 py-2 rounded bg-accent text-bg font-medium disabled:opacity-50 transition-opacity"
            >
              lock in
            </button>
            <button
              type="button"
              onClick={onSkip}
              className="px-4 py-2 text-text-muted hover:text-text transition-colors"
            >
              skip
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
