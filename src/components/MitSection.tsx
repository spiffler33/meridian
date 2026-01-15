/**
 * MIT Section
 *
 * Task list for a single category. Minimal, keyboard-first.
 * Now with first steps and pick-for-me support.
 */

import type React from 'react';
import { useState, useRef, useEffect } from 'react';
import type { TodoItem, MitCategory } from '../types';

interface MitSectionProps {
  category: MitCategory;
  title: string;
  items: TodoItem[];
  pickedItemId?: string | null;
  onAdd: (text: string, firstStep?: string) => void;
  onUpdate: (id: string, text: string) => void;
  onDelete: (id: string) => void;
  onToggle: (id: string) => void;
  onSetFirstStep: (id: string, firstStep: string) => void;
}

interface MitItemProps {
  item: TodoItem;
  isPicked: boolean;
  onUpdate: (text: string) => void;
  onDelete: () => void;
  onToggle: () => void;
  onSetFirstStep: (firstStep: string) => void;
}

function MitItem({ item, isPicked, onUpdate, onDelete, onToggle, onSetFirstStep }: MitItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(item.text);
  const [isEditingFirstStep, setIsEditingFirstStep] = useState(false);
  const [firstStepText, setFirstStepText] = useState(item.firstStep || '');
  const inputRef = useRef<HTMLInputElement>(null);
  const firstStepInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  useEffect(() => {
    if (isEditingFirstStep && firstStepInputRef.current) {
      firstStepInputRef.current.focus();
    }
  }, [isEditingFirstStep]);

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
    if (e.key === 'Enter') handleSubmit();
    if (e.key === 'Escape') {
      setEditText(item.text);
      setIsEditing(false);
    }
  };

  const handleFirstStepSubmit = () => {
    const trimmed = firstStepText.trim();
    if (trimmed !== (item.firstStep || '')) {
      onSetFirstStep(trimmed);
    }
    setIsEditingFirstStep(false);
  };

  const handleFirstStepKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleFirstStepSubmit();
    if (e.key === 'Escape') {
      setFirstStepText(item.firstStep || '');
      setIsEditingFirstStep(false);
    }
  };

  return (
    <div className={`group py-1.5 ${isPicked ? 'bg-accent/10 -mx-2 px-2 rounded border border-accent/30' : ''}`}>
      <div className="flex items-start gap-3">
        <button
          onClick={onToggle}
          className="mt-0.5 text-text-muted hover:text-accent transition-colors"
          aria-label={item.completed ? 'Mark incomplete' : 'Mark complete'}
        >
          {item.completed ? (
            <span className="text-accent">●</span>
          ) : (
            <span>○</span>
          )}
        </button>

        <div className="flex-1 min-w-0">
          {isEditing ? (
            <input
              ref={inputRef}
              type="text"
              value={editText}
              onChange={e => setEditText(e.target.value)}
              onBlur={handleSubmit}
              onKeyDown={handleKeyDown}
              className="w-full text-sm bg-transparent border-b border-border focus:border-accent outline-none text-text"
            />
          ) : (
            <span
              onClick={() => setIsEditing(true)}
              className={`block text-sm cursor-text ${
                item.completed ? 'line-through text-text-muted' : 'text-text'
              }`}
            >
              {isPicked && <span className="text-accent mr-1">→</span>}
              {item.text}
            </span>
          )}

          {/* First step */}
          {!item.completed && (
            isEditingFirstStep ? (
              <input
                ref={firstStepInputRef}
                type="text"
                value={firstStepText}
                onChange={e => setFirstStepText(e.target.value)}
                onBlur={handleFirstStepSubmit}
                onKeyDown={handleFirstStepKeyDown}
                placeholder="first tiny step..."
                className="w-full text-xs bg-transparent border-b border-border/50 focus:border-accent outline-none text-text-muted mt-1"
              />
            ) : item.firstStep ? (
              <span
                onClick={() => setIsEditingFirstStep(true)}
                className="block text-xs text-text-muted mt-0.5 cursor-text hover:text-text-secondary"
              >
                ↳ {item.firstStep}
              </span>
            ) : (
              <button
                onClick={() => setIsEditingFirstStep(true)}
                className="text-xs text-text-muted/50 hover:text-text-muted mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                + first step
              </button>
            )
          )}
        </div>

        <button
          onClick={onDelete}
          className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-error transition-all text-xs"
          aria-label="Delete"
        >
          ×
        </button>
      </div>
    </div>
  );
}

export function MitSection({
  title,
  items,
  pickedItemId,
  onAdd,
  onUpdate,
  onDelete,
  onToggle,
  onSetFirstStep,
}: MitSectionProps) {
  const [newItemText, setNewItemText] = useState('');
  const [newFirstStep, setNewFirstStep] = useState('');
  const [showFirstStepInput, setShowFirstStepInput] = useState(false);
  const firstStepInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showFirstStepInput && firstStepInputRef.current) {
      firstStepInputRef.current.focus();
    }
  }, [showFirstStepInput]);

  const handleAdd = () => {
    const trimmed = newItemText.trim();
    if (trimmed) {
      onAdd(trimmed, newFirstStep.trim() || undefined);
      setNewItemText('');
      setNewFirstStep('');
      setShowFirstStepInput(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (!showFirstStepInput && newItemText.trim()) {
        // Show first step input instead of immediately adding
        setShowFirstStepInput(true);
      } else {
        handleAdd();
      }
    }
    if (e.key === 'Escape') {
      setNewItemText('');
      setNewFirstStep('');
      setShowFirstStepInput(false);
    }
  };

  const handleFirstStepKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleAdd();
    if (e.key === 'Escape') {
      setShowFirstStepInput(false);
      setNewFirstStep('');
    }
  };

  const completedCount = items.filter(i => i.completed).length;

  return (
    <div className="bg-bg-card rounded border border-border p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium text-text-secondary uppercase tracking-wide">
          {title}
        </span>
        {items.length > 0 && (
          <span className="text-xs text-text-muted font-mono">
            {completedCount}/{items.length}
          </span>
        )}
      </div>

      {/* Items */}
      <div className="space-y-0">
        {items.map(item => (
          <MitItem
            key={item.id}
            item={item}
            isPicked={pickedItemId === item.id}
            onUpdate={text => onUpdate(item.id, text)}
            onDelete={() => onDelete(item.id)}
            onToggle={() => onToggle(item.id)}
            onSetFirstStep={firstStep => onSetFirstStep(item.id, firstStep)}
          />
        ))}
      </div>

      {/* Add input */}
      <div className="mt-2 pt-2 border-t border-border space-y-1">
        <div className="flex items-center gap-3">
          <span className="text-text-muted">+</span>
          <input
            type="text"
            value={newItemText}
            onChange={e => setNewItemText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="add item"
            className="flex-1 text-sm bg-transparent outline-none text-text placeholder:text-text-muted"
          />
        </div>
        {showFirstStepInput && (
          <div className="flex items-center gap-3 pl-5">
            <input
              ref={firstStepInputRef}
              type="text"
              value={newFirstStep}
              onChange={e => setNewFirstStep(e.target.value)}
              onKeyDown={handleFirstStepKeyDown}
              placeholder="first tiny step? (enter to add)"
              className="flex-1 text-xs bg-transparent outline-none text-text-muted placeholder:text-text-muted/50"
            />
            <button
              onClick={handleAdd}
              className="text-xs text-accent hover:text-accent-hover"
            >
              add
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
