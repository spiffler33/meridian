/**
 * Two Minute Timer
 *
 * The "just start" hack. Commit to 2 minutes only.
 * Brain trick: once you start, you usually keep going.
 */

import { useState, useEffect } from 'react';

interface TwoMinuteTimerProps {
  taskName: string;
  onComplete: () => void;
  onStop: () => void;
}

export function TwoMinuteTimer({ taskName, onComplete, onStop }: TwoMinuteTimerProps) {
  const [secondsLeft, setSecondsLeft] = useState(120);
  const [isRunning, setIsRunning] = useState(true);
  const [isFinished, setIsFinished] = useState(false);

  useEffect(() => {
    if (!isRunning || isFinished) return;

    const interval = setInterval(() => {
      setSecondsLeft(prev => {
        if (prev <= 1) {
          setIsFinished(true);
          setIsRunning(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isRunning, isFinished]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const progress = ((120 - secondsLeft) / 120) * 100;

  if (isFinished) {
    return (
      <div className="fixed inset-0 bg-bg/95 z-50 flex items-center justify-center p-4">
        <div className="max-w-sm w-full bg-bg-card rounded border border-border p-6 text-center space-y-4">
          <div className="text-lg text-text">2 minutes done!</div>
          <div className="text-sm text-text-muted">"{taskName}"</div>
          <div className="text-sm text-text-secondary">Keep going?</div>
          <div className="flex gap-3 justify-center">
            <button
              onClick={onComplete}
              className="px-4 py-2 rounded bg-accent text-bg font-medium"
            >
              I'm done
            </button>
            <button
              onClick={onStop}
              className="px-4 py-2 text-text-muted hover:text-text"
            >
              keep working
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 bg-bg-card rounded border border-border p-4 shadow-lg z-40 min-w-[200px]">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-text-muted uppercase tracking-wide">just 2 min</span>
          <button
            onClick={onStop}
            className="text-xs text-text-muted hover:text-text"
          >
            stop
          </button>
        </div>

        <div className="text-sm text-text truncate" title={taskName}>
          {taskName}
        </div>

        <div className="text-2xl font-mono text-accent text-center">
          {formatTime(secondsLeft)}
        </div>

        {/* Progress bar */}
        <div className="h-1 bg-border rounded-full overflow-hidden">
          <div
            className="h-full bg-accent transition-all duration-1000"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  );
}
