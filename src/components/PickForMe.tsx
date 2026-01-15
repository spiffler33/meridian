/**
 * Pick For Me
 *
 * Eliminates decision paralysis by randomly selecting
 * one incomplete task. Do this now.
 */

import { useState, useCallback } from 'react';
import type { TodoItem, MitCategory } from '../types';

interface PickedTask {
  item: TodoItem;
  category: MitCategory;
}

interface PickForMeProps {
  workItems: TodoItem[];
  selfItems: TodoItem[];
  familyItems: TodoItem[];
  onPick: (category: MitCategory, itemId: string) => void;
  onClear: () => void;
  pickedTask: PickedTask | null;
}

export function PickForMe({
  workItems,
  selfItems,
  familyItems,
  onPick,
  onClear,
  pickedTask,
}: PickForMeProps) {
  const [isAnimating, setIsAnimating] = useState(false);

  const getAllIncomplete = useCallback(() => {
    const incomplete: PickedTask[] = [];
    workItems.filter(i => !i.completed).forEach(item => incomplete.push({ item, category: 'work' }));
    selfItems.filter(i => !i.completed).forEach(item => incomplete.push({ item, category: 'self' }));
    familyItems.filter(i => !i.completed).forEach(item => incomplete.push({ item, category: 'family' }));
    return incomplete;
  }, [workItems, selfItems, familyItems]);

  const handlePick = () => {
    const incomplete = getAllIncomplete();
    if (incomplete.length === 0) return;

    setIsAnimating(true);

    // Quick shuffle animation
    let count = 0;
    const interval = setInterval(() => {
      const random = incomplete[Math.floor(Math.random() * incomplete.length)];
      onPick(random.category, random.item.id);
      count++;
      if (count >= 8) {
        clearInterval(interval);
        setIsAnimating(false);
        // Final pick
        const final = incomplete[Math.floor(Math.random() * incomplete.length)];
        onPick(final.category, final.item.id);
      }
    }, 80);
  };

  const incompleteCount = getAllIncomplete().length;

  if (incompleteCount === 0 && !pickedTask) {
    return null;
  }

  return (
    <div className="flex items-center gap-3">
      {pickedTask ? (
        <>
          <span className="text-xs text-accent font-medium">
            → do this now
          </span>
          <button
            onClick={onClear}
            className="text-xs text-text-muted hover:text-text"
          >
            clear
          </button>
        </>
      ) : (
        <button
          onClick={handlePick}
          disabled={isAnimating}
          className="text-xs text-text-muted hover:text-accent transition-colors disabled:opacity-50"
        >
          {isAnimating ? 'picking...' : `pick for me (${incompleteCount})`}
        </button>
      )}
    </div>
  );
}
