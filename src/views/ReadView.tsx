/**
 * Read view.
 *
 * The reading surface for the newsletters library. Email stays the broadcast
 * edition; this is the owner's terminal on the same committed artifacts.
 *
 * This phase is the shell: the tabs, the routes, the type split and the
 * instrument, rendering fixtures. No token, no fetch, no journal — the
 * newsletters repo arrives in phase 2 (docs/PLAN_READING_PANE.md).
 */

import { useEffect, useState } from 'react';
import type { ReadSurface } from '../types';
import { SetpointWave } from '../components/SetpointWave';
import { useNewsletters, type NewslettersView } from '../hooks/useNewsletters';
import {
  CANON_DAY,
  CHART_CARD,
  ESSAY_CARD,
  TAPE_CARDS,
  type ChartBar,
  type Segment,
} from './readFixtures';

interface ReadViewProps {
  surface: ReadSurface;
  /** The item path from the route, e.g. ['risk-memos', '04'] under canon. */
  item: string[];
  onSurfaceChange: (surface: ReadSurface) => void;
}

const TABS: { surface: ReadSurface; label: string }[] = [
  { surface: 'tape', label: 'Tape' },
  { surface: 'chart', label: 'Chart' },
  { surface: 'canon', label: 'Canon' },
  { surface: 'essay', label: 'Essays' },
  { surface: 'library', label: 'Library' },
];

const BAR_TONE: Record<ChartBar['tone'], string> = {
  amber: 'bg-sp-amber',
  green: 'bg-sp-green',
  ice: 'bg-sp-ice',
};

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-4 rounded border border-sp-hair bg-sp-panel px-[18px] pb-4 pt-[18px]">
      {children}
    </div>
  );
}

function Kicker({ children, tone }: { children: React.ReactNode; tone?: 'ice' }) {
  return (
    <div
      className={`mb-2 font-mono text-[9.5px] uppercase tracking-[0.22em] ${
        tone === 'ice' ? 'text-sp-ice' : 'text-sp-amber'
      }`}
    >
      {children}
    </div>
  );
}

function Headline({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-read text-[18px] font-bold leading-[1.35] tracking-[-0.01em] text-sp-ink">
      {children}
    </h2>
  );
}

/**
 * A citation, drawn but not yet live: chips become tappable in phase 4, and a
 * button that goes nowhere would be a lie about what this pane can do today.
 */
function Cite({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="mx-px whitespace-nowrap rounded-[9px] border border-sp-rim px-[7px] pb-[2px] pt-px align-[0.12em] font-mono text-[10.5px] text-sp-ice"
    >
      {children}
    </span>
  );
}

function Prose({ paragraphs }: { paragraphs: Segment[][] }) {
  return (
    <>
      {paragraphs.map((segments, p) => (
        <p key={p} className="prose-read mt-3 text-sp-ink">
          {segments.map((segment, s) => {
            if (typeof segment === 'string') return <span key={s}>{segment}</span>;
            if ('cite' in segment) return <Cite key={s}>{segment.cite}</Cite>;
            return (
              <sup key={s} className="font-mono text-[10px] text-sp-ice">
                {segment.fn}
              </sup>
            );
          })}
        </p>
      ))}
    </>
  );
}

function SrcLine({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-[14px] border-t border-sp-hair pt-3 font-mono text-[10.5px] leading-[1.7] text-sp-faint">
      {children}
    </div>
  );
}

function TapePane() {
  return (
    <>
      {TAPE_CARDS.map(card => (
        <Card key={card.id}>
          <Kicker>{card.kicker}</Kicker>
          <Headline>{card.headline}</Headline>
          <Prose paragraphs={card.prose} />
          <SrcLine>
            {card.srcCount} ·{' '}
            {card.cites.map(cite => (
              <Cite key={cite}>{cite}</Cite>
            ))}
          </SrcLine>
        </Card>
      ))}
    </>
  );
}

function ChartPane() {
  return (
    <Card>
      <Kicker>{CHART_CARD.kicker}</Kicker>
      <Headline>{CHART_CARD.headline}</Headline>
      {/* The value lives outside the bar. It survives a stripped fill in mail,
          and it survives a narrow phone here — same reason, different medium. */}
      <div className="mt-[14px]">
        {CHART_CARD.bars.map(bar => (
          <div
            key={bar.label}
            className="grid grid-cols-[92px_1fr_58px] items-center gap-[10px] py-[5px] sm:grid-cols-[112px_1fr_58px]"
          >
            <span className="text-right font-mono text-[11px] text-sp-muted">{bar.label}</span>
            <div className="h-3 overflow-hidden rounded-[3px] bg-sp-panel2">
              <div
                className={`h-full rounded-[3px] ${BAR_TONE[bar.tone]}`}
                style={{ width: `${bar.percent}%` }}
              />
            </div>
            <span className="text-left font-mono text-[11.5px] tabular-nums text-sp-ink">
              {bar.value}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-[10px] font-read text-sm italic leading-[1.6] text-sp-muted">
        {CHART_CARD.note}
      </p>
      <SrcLine>
        src ·{' '}
        {CHART_CARD.cites.map(cite => (
          <Cite key={cite}>{cite}</Cite>
        ))}
      </SrcLine>
    </Card>
  );
}

function CanonPane() {
  return (
    <Card>
      <div className="flex items-baseline justify-between">
        <Kicker tone="ice">{CANON_DAY.kicker}</Kicker>
        <span className="font-mono text-[10.5px] tabular-nums text-sp-faint">
          day {CANON_DAY.day}/{CANON_DAY.of}
        </span>
      </div>
      <Headline>{CANON_DAY.headline}</Headline>
      <Prose paragraphs={CANON_DAY.prose} />
      <SrcLine>{CANON_DAY.citations}</SrcLine>
    </Card>
  );
}

function EssayPane() {
  return (
    <Card>
      <Kicker>{ESSAY_CARD.kicker}</Kicker>
      <Headline>{ESSAY_CARD.headline}</Headline>
      <p className="prose-read mt-[6px] text-[14.5px] text-sp-muted">{ESSAY_CARD.subtitle}</p>
      <Prose paragraphs={ESSAY_CARD.prose} />
      <SrcLine>{ESSAY_CARD.footnotes}</SrcLine>
    </Card>
  );
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
  readSlugs,
  onToggle,
}: {
  view: NewslettersView;
  readSlugs: Set<string>;
  onToggle: (slug: string) => void;
}) {
  return (
    <>
      <LibraryState view={view} />
      {view.rows.map(row => {
        const isRead = readSlugs.has(row.slug);
        return (
          <div key={row.slug} className="flex items-center gap-3 border-b border-sp-hair px-[2px] py-[11px]">
            <span
              className={`h-[7px] w-[7px] flex-shrink-0 rounded-full ${
                isRead ? 'border border-sp-hair' : 'bg-sp-amber'
              }`}
              style={isRead ? undefined : { boxShadow: '0 0 8px var(--sp-amber)' }}
            />
            <div className="min-w-0 flex-1">
              <div className="font-mono text-[10px] tracking-[0.06em] text-sp-faint">{row.date}</div>
              {/* The slug is the title. The corpus has no other one that can be
                  known without opening the entry, and inventing a prettier
                  version of an identifier would only make it harder to match
                  against a citation. */}
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
            </div>
            <button
              onClick={() => onToggle(row.slug)}
              aria-label={isRead ? `Mark ${row.slug} unread` : `Mark ${row.slug} read`}
              className={`h-5 w-5 flex-shrink-0 rounded-md border-[1.5px] ${
                isRead ? 'border-sp-green bg-sp-green' : 'border-sp-faint hover:border-sp-muted'
              }`}
            >
              {isRead && <span className="block text-center text-[12px] leading-4 text-sp-panel">✓</span>}
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

function RawPane({ item }: { item: string[] }) {
  const slug = item.join('/');
  return (
    <Card>
      <Kicker>raw</Kicker>
      <Headline>{slug || 'No entry named'}</Headline>
      <p className="prose-read mt-3 text-sp-muted">
        Source prose is fetched on open, and this route is already the one every citation resolves
        to. The reader itself lands with the surfaces.
      </p>
    </Card>
  );
}

export function ReadView({ surface, item, onSurfaceChange }: ReadViewProps) {
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
  const unread = view.loaded && view.rows.length > 0
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
        {surface === 'tape' && <TapePane />}
        {surface === 'chart' && <ChartPane />}
        {surface === 'canon' && <CanonPane />}
        {surface === 'essay' && <EssayPane />}
        {surface === 'library' && (
          <LibraryPane view={view} readSlugs={readSlugs} onToggle={toggleRead} />
        )}
        {surface === 'raw' && <RawPane item={item} />}
      </div>
    </div>
  );
}
