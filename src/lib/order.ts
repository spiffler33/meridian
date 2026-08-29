/**
 * The one string comparison every replica agrees on.
 *
 * Pure: no imports, no state, no clock.
 */

/**
 * Plain code-unit comparison — deliberately NOT `localeCompare`.
 *
 * Locale-aware collation is a property of the machine doing the comparing: it
 * folds case, ignores punctuation, and orders accents differently per locale
 * and per ICU version. Every list here is sorted independently on each device
 * from the same journal, so a comparison whose answer depends on the browser
 * would let two devices show the same data in two different orders — and where
 * the comparison is a tiebreak in a fold, disagree about which write won.
 *
 * `journal.ts`'s `compareEvents` is this same rule, inlined: that module is
 * kept import-free on purpose, so it carries its own copy.
 */
export function compareCodeUnits(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
