/**
 * Read view.
 *
 * The reading surface for the newsletters library. Email stays the broadcast
 * edition; this is the owner's terminal on the same committed artifacts.
 *
 * The shell owns three things: the palette the whole screen adopts while this
 * view is mounted, the instrument in the header, and the tab rail. Everything
 * below the rail is a surface, and each surface reads its own file.
 */

import { useEffect, useState } from 'react';
import type { ReadSurface } from '../types';
import { SetpointWave } from '../components/SetpointWave';
import { useNewsletters, type NewslettersView } from '../hooks/useNewsletters';
import {
  CanonPane,
  ChartPane,
  EssayPane,
  RawPane,
  TapePane,
} from './readSurfaces';

interface ReadViewProps {
  surface: ReadSurface;
  /** The item path from the route, e.g. ['marks-sea-change', '4'] under canon. */
  item: string[];
  onSurfaceChange: (surface: ReadSurface) => void;
  onNavigate: (surface: ReadSurface, item: string[]) => void;
}

const TABS: { surface: ReadSurface; label: string }[] = [
  { surface: 'tape', label: 'Tape' },
  { surface: 'chart', label: 'Chart' },
  { surface: 'canon', label: 'Canon' },
  { surface: 'essay', label: 'Essays' },
  { surface: 'library', label: 'Library' },
];

/**
 * What the library is doing, in one line, above the rows rather than instead
 * of them: a failed sync still leaves the last synced copy on screen, and says
 * so. A failure that only hid the content would be indistinguishable from an
 * empty corpus.
 */
function LibraryState({ view }: { view: NewslettersView }) {
  if (view.error) {
    return (
      <div className="flex items-baseline gap-2 pb-2 font-mono text-[10.5px] text-error">
        <span>{view.error}</span>
        <button onClick={view.refresh} className="underline underline-offset-2">
          retry
        </button>
      </div>
    );
  }
  if (!view.configured) {
    return (
      <div className="pb-2 font-mono text-[10.5px] text-sp-muted">
        no newsletters token on this device — add a read-only one in settings
      </div>
    );
  }
  if (view.syncing) {
    return <div className="pb-2 font-mono text-[10.5px] text-sp-faint">syncing…</div>;
  }
  if (view.loaded && view.rows.length === 0) {
    return (
      <div className="pb-2 font-mono text-[10.5px] text-sp-faint">
        nothing synced to this device yet
      </div>
    );
  }
  return null;
}

function LibraryPane({
  view,
  readSlugs,
  onToggle,
  onOpen,
}: {
  view: NewslettersView;
  readSlugs: Set<string>;
  onToggle: (slug: string) => void;
  onOpen: (slug: string) => void;
}) {
  return (
    <>
      <LibraryState view={view} />
      {view.rows.map(row => {
        const isRead = readSlugs.has(row.slug);
        return (
          <div
            key={row.slug}
            className="flex items-center gap-3 border-b border-sp-hair px-[2px] py-[11px]"
          >
            <span
              className={`h-[7px] w-[7px] flex-shrink-0 rounded-full ${
                isRead ? 'border border-sp-hair' : 'bg-sp-amber'
              }`}
              style={isRead ? undefined : { boxShadow: '0 0 8px var(--sp-amber)' }}
            />
            <button onClick={() => onOpen(row.slug)} className="min-w-0 flex-1 text-left">
              <div className="font-mono text-[10px] tracking-[0.06em] text-sp-faint">{row.date}</div>
              {/* The slug is the title. The corpus keeps the real one inside
                  the entry's frontmatter, which is a fetch away; the reader
                  shows it the moment the entry opens. */}
              <div
                className={`truncate font-mono text-[12.5px] leading-[1.5] ${
                  isRead ? 'text-sp-muted' : 'text-sp-ink'
                }`}
              >
                {row.name}
              </div>
              {row.gist && (
                <div className="truncate font-read text-[13px] leading-[1.45] text-sp-muted">
                  {row.gist}
                </div>
              )}
            </button>
            <button
              onClick={() => onToggle(row.slug)}
              aria-label={isRead ? `Mark ${row.slug} unread` : `Mark ${row.slug} read`}
              className={`h-5 w-5 flex-shrink-0 rounded-md border-[1.5px] ${
                isRead ? 'border-sp-green bg-sp-green' : 'border-sp-faint hover:border-sp-muted'
              }`}
            >
              {isRead && (
                <span className="block text-center text-[12px] leading-4 text-sp-panel">✓</span>
              )}
            </button>
          </div>
        );
      })}
      {view.rows.length > 0 && (
        <p className="mt-[14px] font-read text-sm italic leading-[1.6] text-sp-muted">
          Marking read here is local to this screen for now — reading becomes cockpit data in a
          later phase, and entries older than the baseline never show as unread.
        </p>
      )}
    </>
  );
}

export function ReadView({ surface, item, onSurfaceChange, onNavigate }: ReadViewProps) {
  // The whole screen becomes the reading surface while this view is mounted:
  // the app's tokens resolve to setpoint values on <html>, so the header and
  // the backup line come along instead of framing the pane in another palette.
  useEffect(() => {
    document.documentElement.setAttribute('data-surface', 'read');
    return () => document.documentElement.removeAttribute('data-surface');
  }, []);

  const view = useNewsletters();

  // Read-state, local to this screen. It exists so the instrument can be
  // judged moving; phase 5 replaces it with folded `readItem` events, and
  // with the baseline that stops day one reading as 300-odd alarms.
  const [readSlugs, setReadSlugs] = useState<Set<string>>(() => new Set());

  const toggleRead = (slug: string) => {
    setReadSlugs(prev => {
      const next = new Set(prev);
      if (!next.delete(slug)) next.add(slug);
      return next;
    });
  };

  // Not zero until the library has actually been read: an instrument that
  // reports "all read" because it has not looked yet is lying.
  const unread =
    view.loaded && view.rows.length > 0
      ? view.rows.filter(row => !readSlugs.has(row.slug)).length
      : null;

  return (
    <div>
      <SetpointWave unread={unread} />

      <div
        role="tablist"
        aria-label="Reading surfaces"
        className="mb-[22px] mt-[18px] flex gap-3 overflow-x-auto border-b border-sp-hair sm:gap-[22px]"
      >
        {TABS.map(tab => (
          <button
            key={tab.surface}
            role="tab"
            aria-selected={surface === tab.surface}
            onClick={() => onSurfaceChange(tab.surface)}
            className={`whitespace-nowrap border-b-2 px-[2px] pb-[10px] pt-2 font-mono text-[10.5px] uppercase tracking-[0.22em] ${
              surface === tab.surface
                ? 'border-sp-amber text-sp-ink'
                : 'border-transparent text-sp-faint hover:text-sp-muted'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {surface === 'tape' && <TapePane item={item} onNavigate={onNavigate} />}
        {surface === 'chart' && <ChartPane item={item} onNavigate={onNavigate} />}
        {surface === 'canon' && <CanonPane item={item} onNavigate={onNavigate} />}
        {surface === 'essay' && <EssayPane item={item} onNavigate={onNavigate} />}
        {surface === 'library' && (
          <LibraryPane
            view={view}
            readSlugs={readSlugs}
            onToggle={toggleRead}
            onOpen={slug => onNavigate('raw', [slug])}
          />
        )}
        {surface === 'raw' && <RawPane item={item} onNavigate={onNavigate} />}
      </div>
    </div>
  );
}
