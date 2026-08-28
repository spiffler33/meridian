/**
 * AI Service
 *
 * Tower's "why this?" line, and nothing else any more.
 *
 * The Tower-input stub lived here as the seam the server-side parse left
 * behind: one item, exactly as typed. Phase 2 filled it — a Tower submission
 * is now also a pulse, and the coder proposes the fields the parse used to
 * guess, as chips on the item. Nothing replaced the stub in this file; the
 * seam moved to `services/coder.ts` and `captureTowerItem` in
 * `services/data.ts`.
 *
 * What is left has never been AI at all: `explainWhyThis` is arithmetic over
 * dates, named for an ambition the app no longer has.
 */

/**
 * Generate "Why this?" explanation for a tower item
 * Uses thoughtful fallback logic - no AI needed for this
 */
export function explainWhyThis(
  item: { text: string; createdAt: string; expectsBy?: string; effort?: string; lastTouched: string; isEvent?: boolean },
  queuePosition: number
): string {
  return generateFallbackExplanation({ text: item.text, createdAt: item.createdAt, expectsBy: item.expectsBy, isEvent: item.isEvent }, queuePosition);
}

/**
 * Fallback explanation when AI is unavailable - more thoughtful
 */
function generateFallbackExplanation(
  item: { text: string; createdAt: string; expectsBy?: string; isEvent?: boolean },
  queuePosition: number
): string {
  const today = new Date();
  const created = new Date(item.createdAt);
  const daysOld = Math.floor((today.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));

  // Event-specific explanations
  if (item.isEvent && item.expectsBy) {
    const deadline = new Date(item.expectsBy);
    const daysUntil = Math.ceil((deadline.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    if (daysUntil < 0) {
      return `This was ${Math.abs(daysUntil)} day${Math.abs(daysUntil) === 1 ? '' : 's'} ago. Did you miss it, or should this be cleared?`;
    }
    if (daysUntil === 0) {
      return 'Happening today. This is your reminder.';
    }
    if (daysUntil === 1) {
      return 'Tomorrow. Heads up so you can prepare.';
    }
    return `Coming up in ${daysUntil} days. Showing early so it doesn't surprise you.`;
  }

  // Deadline-based reasoning
  if (item.expectsBy) {
    const deadline = new Date(item.expectsBy);
    const daysUntil = Math.ceil((deadline.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (daysUntil < 0) {
      return `This was expected ${Math.abs(daysUntil)} day${Math.abs(daysUntil) === 1 ? '' : 's'} ago. The longer it waits, the harder the conversation becomes.`;
    }
    if (daysUntil === 0) {
      return 'Expected today. Better to act while the context is fresh.';
    }
    if (daysUntil === 1) {
      return 'Due tomorrow. Handling it now means one less thing weighing on you.';
    }
    if (daysUntil <= 3) {
      return `Due in ${daysUntil} days. Early action prevents last-minute stress.`;
    }
  }

  // Age-based reasoning
  if (daysOld === 0) {
    if (queuePosition === 0) {
      return 'Fresh capture. Strike while the intent is clear.';
    }
    return 'Added today. Still has momentum from when you captured it.';
  }

  if (daysOld === 1) {
    return 'From yesterday. The gap between intention and action is still small.';
  }

  if (daysOld <= 3) {
    return `Waiting ${daysOld} days. Each day it sits, the activation energy grows.`;
  }

  if (daysOld <= 7) {
    return `A week-old open loop. Your brain is spending cycles remembering this exists.`;
  }

  return `${daysOld} days in limbo. Either do it, delegate it, or delete it.`;
}
