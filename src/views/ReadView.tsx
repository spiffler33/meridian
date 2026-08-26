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

import { useEffect } from 'react';
import type { ReadSurface } from '../types';
import { SetpointWave } from '../components/SetpointWave';
import type { SurfaceRead } from '../components/readUi';
import { useAsync } from '../hooks/useAsync';
import { useNewsletters, type NewslettersView } from '../hooks/useNewsletters';
import { useReadState } from '../hooks/useReadState';
import { TAPE_PATH, briefDates, cachedJson, cachedTree, chartIds } from '../lib/newslettersRead';
import type { ReadableItem } from '../lib/readState';
import { readItemKey } from '../services/data';
import {
  BriefPane,
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
  { surface: 'brief', label: 'Brief' },
  { surface: 'tape', label: 'Tape' },
  { surface: 'chart', label: 'Chart' },
  { surface: 'canon', label: 'Canon' },
  { surface: 'essay', label: 'Essays' },
  { surface: 'library', label: 'Library' },
];

/** Just enough of the tape to say which window it is and when it closed. */
interface TapeWindow {
  window?: { key?: string; end?: string };
}

/**
 * The dated material, keyed the way the journal keys it.
 *
 * Only these four surfaces can be behind: an entry, a daily brief, a weekly
 * tape, a chart. The canon is a course and the wiki is a reference — neither
 * carries a date and neither is a queue, so neither appears here and neither
 * ever alarms.
 *
 * Read from the same cache the panes read, so it costs no network and answers
 * in airplane mode.
 */
async function loadDated(): Promise<{
  brief: ReadableItem[];
  tape: ReadableItem[];
  chart: ReadableItem[];
}> {
  const [tape, tree] = await Promise.all([cachedJson<TapeWindow>(TAPE_PATH), cachedTree()]);
  const paths = tree.map(file => file.path);

  const key = tape?.window?.key ?? null;
  return {
    // A brief is named for the day it covers, so the id is the date.
    brief: briefDates(paths).map(date => ({ key: readItemKey('brief', date), date })),
    tape:
      key === null
        ? []
        : [{ key: readItemKey('tape', key), date: tape?.window?.end ?? null }],
    // A chart id leads with its date, which is the date of the chart.
    chart: chartIds(paths).map(id => ({
      key: readItemKey('chart', id),
      date: id.slice(0, 10),
    })),
  };
}

/** The backlog on one tab, drawn only when there is one. */
function Tick({ count }: { count: number | null }) {
  if (count === null || count <= 0) return null;
  return <span className="ml-[6px] tabular-nums text-sp-amber">{count}</span>;
}

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
  read,
  onOpen,
}: {
  view: NewslettersView;
  read: SurfaceRead;
  onOpen: (slug: string) => void;
}) {
  return (
    <>
      <LibraryState view={view} />
      {view.rows.map(row => {
        const key = readItemKey('raw', row.slug);
        const isRead = read.isRead(key);
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
              onClick={() => read.toggle(key)}
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

  // Read-state is folded `readItem` events, and the baseline is established
  // here — the pane having synced on this device is the whole trigger.
  const read = useReadState(view.lastSyncedAt !== null);

  // Module-scope and argument-free, so the reference is stable across renders
  // and the read runs once per mount — which is when the cache can have moved.
  const dated = useAsync(loadDated);

  const entries: ReadableItem[] = view.rows.map(row => ({
    key: readItemKey('raw', row.slug),
    date: row.date.length > 0 ? row.date : null,
  }));

  const entryUnread = read.unread(entries);
  const briefUnread = read.unread(dated.value?.brief ?? []);

  // The wave reports the entries, which are the corpus, plus the briefs. The
  // tape and the charts are digests of those same entries, so adding them
  // would count one week's reading three times; their own backlog is on their
  // own tab. A brief is the one dated digest that is not made of the corpus
  // below it — it sweeps threads that never land in raw/, and carries the book
  // and the market — so an unread one is a thing genuinely still owed.
  // Both are null together — a null is "no baseline yet", which is a property
  // of the device and not of either list.
  const unread =
    entryUnread === null || briefUnread === null ? null : entryUnread + briefUnread;

  const ticks: Partial<Record<ReadSurface, number | null>> = {
    brief: briefUnread,
    tape: read.unread(dated.value?.tape ?? []),
    chart: read.unread(dated.value?.chart ?? []),
    library: entryUnread,
  };

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
            <Tick count={ticks[tab.surface] ?? null} />
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {surface === 'brief' && <BriefPane item={item} onNavigate={onNavigate} read={read} />}
        {surface === 'tape' && <TapePane item={item} onNavigate={onNavigate} read={read} />}
        {surface === 'chart' && <ChartPane item={item} onNavigate={onNavigate} read={read} />}
        {surface === 'canon' && <CanonPane item={item} onNavigate={onNavigate} read={read} />}
        {surface === 'essay' && <EssayPane item={item} onNavigate={onNavigate} read={read} />}
        {surface === 'library' && (
          <LibraryPane view={view} read={read} onOpen={slug => onNavigate('raw', [slug])} />
        )}
        {surface === 'raw' && <RawPane item={item} onNavigate={onNavigate} read={read} />}
      </div>
    </div>
  );
}
