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
      <div className="fixed inset-0 bg-bg z-50 flex items-center justify-center p-4">
        <div className="max-w-sm w-full bg-bg-card rounded border border-border p-6 space-y-4">
          <div className="text-sm text-text">done</div>
          {/* The task is the owner's own words, so it is set in the reading face. */}
          <div className="font-read text-base text-text-secondary">{taskName}</div>
          <div className="text-sm text-text-muted">keep going?</div>
          <div className="flex gap-3">
            <button
              onClick={onComplete}
              className="px-4 py-2 rounded bg-accent text-bg font-medium text-sm"
            >
              mark done
            </button>
            <button
              onClick={onStop}
              className="px-4 py-2 text-sm text-text-muted hover:text-text"
            >
              keep working
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 bg-bg-card rounded border border-border p-4 z-40 min-w-[200px]">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-text-muted uppercase tracking-caps">just 2 min</span>
          <button
            onClick={onStop}
            className="text-xs text-text-muted hover:text-text"
          >
            stop
          </button>
        </div>

        <div className="font-read text-base text-text truncate" title={taskName}>
          {taskName}
        </div>

        <div className="text-lg text-accent text-center tabular-nums">
          {formatTime(secondsLeft)}
        </div>

        {/*
          The bar steps once a second with the readout. No transition: motion
          here is the instrument reporting, and width is not one of the three
          properties allowed to move.
        */}
        <div className="h-1 bg-border rounded overflow-hidden">
          <div className="h-full bg-accent" style={{ width: `${progress}%` }} />
        </div>
      </div>
    </div>
  );
}
