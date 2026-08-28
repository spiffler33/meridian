/**
 * The dock: the strip a view owns at the very bottom of the screen.
 *
 * Both capture bars want to sit there, and both used to do it with
 * `fixed bottom-0` — which puts them underneath the sticky backup-status
 * footer and slices the placeholder in half. A `fixed` bar cannot know how
 * tall that footer is, and an offset would be a magic number that breaks the
 * first time the backup line wraps.
 *
 * So the footer holds both, stacked, and a view portals its bar into the slot
 * above the backup line. Overlap stops being possible.
 *
 * Three states, and the difference between the last two is what stops a flash:
 * `undefined` means no Layout is above us at all — a view rendered on its own,
 * as tests do — and the bar renders in place. `null` means the Layout is there
 * but has not attached its node yet, on the very first render pass, and
 * rendering in place then would put the bar mid-page for one frame.
 */

import { createContext, useContext } from 'react';

export const DockContext = createContext<HTMLElement | null | undefined>(undefined);

export function useDock(): HTMLElement | null | undefined {
  return useContext(DockContext);
}
