/**
 * Renders its children into the Layout's dock — the strip directly above the
 * backup-status line. See `useDock` for why that beats a `fixed` bar.
 */

import { createPortal } from 'react-dom';

import { useDock } from '../hooks/useDock';

export function Dock({ children }: { children: React.ReactNode }) {
  const node = useDock();
  if (node === undefined) return <>{children}</>;
  if (node === null) return null;
  return createPortal(children, node);
}
