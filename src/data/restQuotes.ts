/**
 * Rest Day Quotes
 *
 * Wisdom for intentional rest. Stoic and affirming.
 * Rotates based on day of year.
 */

const REST_QUOTES = [
  "Rest is not idleness. The mind consolidates in stillness.",
  "Strategic withdrawal is not defeat.",
  "Recovery is when adaptation happens.",
  "The pause between notes makes the music.",
  "Doing nothing is sometimes the most productive thing.",
  "Nature does not hurry, yet everything is accomplished.",
  "In the midst of movement and chaos, keep stillness inside of you.",
  "Almost everything will work again if you unplug it for a few minutes.",
  "Rest when you're weary. Refresh and renew yourself.",
  "The time to relax is when you don't have time for it.",
  "Tension is who you think you should be. Relaxation is who you are.",
  "Sometimes the most important thing in a whole day is the rest we take.",
  "Take rest; a field that has rested gives a bountiful crop.",
  "Learn to pause... or nothing worthwhile will catch up to you.",
  "Your calm mind is the ultimate weapon against your challenges.",
];

/**
 * Get a rest quote based on day of year
 */
export function getRestQuote(date: Date = new Date()): string {
  const startOfYear = new Date(date.getFullYear(), 0, 0);
  const diff = date.getTime() - startOfYear.getTime();
  const dayOfYear = Math.floor(diff / (1000 * 60 * 60 * 24));
  return REST_QUOTES[dayOfYear % REST_QUOTES.length];
}
