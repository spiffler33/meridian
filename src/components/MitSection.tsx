/**
 * MIT (Most Important Things) Section Component
 *
 * Displays and manages the todo items for a single MIT category.
 * Supports adding, editing, deleting, and toggling items.
 */

import type React from 'react';
import { useState, useRef, useEffect } from 'react';
import type { TodoItem, MitCategory } from '../types';

interface MitSectionProps {
  category: MitCategory;
  title: string;
  subtitle?: string;
  items: TodoItem[];
  onAdd: (text: string) => void;
  onUpdate: (id: string, text: string) => void;
  onDelete: (id: string) => void;
  onToggle: (id: string) => void;
}

interface MitItemProps {
  item: TodoItem;
  onUpdate: (text: string) => void;
  onDelete: () => void;
  onToggle: () => void;
}

function MitItem({ item, onUpdate, onDelete, onToggle }: MitItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(item.text);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleSubmit = () => {
    const trimmed = editText.trim();
    if (trimmed && trimmed !== item.text) {
      onUpdate(trimmed);
    } else {
      setEditText(item.text);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSubmit();
    } else if (e.key === 'Escape') {
      setEditText(item.text);
      setIsEditing(false);
    }
  };

  return (
    <div className="group flex items-start gap-2 sm:gap-3 py-2 sm:py-1.5">
      {/* Checkbox - larger touch target on mobile */}
      <button
        onClick={onToggle}
        className={`
          w-6 h-6 sm:w-5 sm:h-5 rounded border-2 flex-shrink-0 flex items-center justify-center
          transition-colors cursor-pointer active:scale-95
          ${
            item.completed
              ? 'bg-accent-500 border-accent-500 text-white'
              : 'border-surface-300 hover:border-accent-400 active:border-accent-500'
          }
        `}
        aria-label={item.completed ? 'Mark as incomplete' : 'Mark as complete'}
      >
        {item.completed && (
          <svg className="w-4 h-4 sm:w-3 sm:h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        )}
      </button>

      {/* Text / Edit Input */}
      {isEditing ? (
        <input
          ref={inputRef}
          type="text"
          value={editText}
          onChange={e => setEditText(e.target.value)}
          onBlur={handleSubmit}
          onKeyDown={handleKeyDown}
          className="flex-1 text-sm bg-transparent border-b border-surface-300 focus:border-accent-500 outline-none py-0.5"
        />
      ) : (
        <span
          onClick={() => setIsEditing(true)}
          className={`
            flex-1 text-sm cursor-text
            ${item.completed ? 'line-through text-surface-400' : 'text-surface-700'}
          `}
        >
          {item.text}
        </span>
      )}

      {/* Delete Button - always visible on mobile, hover on desktop */}
      <button
        onClick={onDelete}
        className="opacity-50 sm:opacity-0 group-hover:opacity-100 text-surface-400 hover:text-red-500 active:text-red-600 transition-opacity p-2 -m-1 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 sm:p-1 flex items-center justify-center"
        aria-label="Delete item"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

export function MitSection({
  category,
  title,
  subtitle,
  items,
  onAdd,
  onUpdate,
  onDelete,
  onToggle,
}: MitSectionProps) {
  const [newItemText, setNewItemText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleAdd = () => {
    const trimmed = newItemText.trim();
    if (trimmed) {
      onAdd(trimmed);
      setNewItemText('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleAdd();
    }
  };

  const completedCount = items.filter(i => i.completed).length;
  const progress = items.length > 0 ? Math.round((completedCount / items.length) * 100) : 0;

  return (
    <div className="bg-white rounded-xl border border-surface-200 p-4 sm:p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="font-medium text-surface-800">{title}</h3>
          {subtitle && <p className="text-xs text-surface-500 mt-0.5">{subtitle}</p>}
        </div>
        {items.length > 0 && (
          <div className="text-xs text-surface-500">
            {completedCount}/{items.length}
          </div>
        )}
      </div>

      {/* Progress bar */}
      {items.length > 0 && (
        <div className="h-1 bg-surface-100 rounded-full overflow-hidden mb-3">
          <div
            className="h-full bg-accent-500 transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {/* Items list */}
      <div className="space-y-0.5 mb-3">
        {items.map(item => (
          <MitItem
            key={item.id}
            item={item}
            onUpdate={text => onUpdate(item.id, text)}
            onDelete={() => onDelete(item.id)}
            onToggle={() => onToggle(item.id)}
          />
        ))}
      </div>

      {/* Add new item */}
      <div className="flex items-center gap-2">
        <span className="text-surface-300 text-sm">+</span>
        <input
          ref={inputRef}
          type="text"
          value={newItemText}
          onChange={e => setNewItemText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={`Add ${category === 'self' ? 'a' : 'a'} ${title.toLowerCase()} item...`}
          className="flex-1 text-sm bg-transparent border-none outline-none text-surface-700 placeholder:text-surface-400"
        />
        {newItemText.trim() && (
          <button
            onClick={handleAdd}
            className="text-xs text-accent-600 hover:text-accent-700 font-medium"
          >
            Add
          </button>
        )}
      </div>
    </div>
  );
}
