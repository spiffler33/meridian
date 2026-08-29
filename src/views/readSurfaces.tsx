/**
 * The five committed surfaces, plus the source reader they all point at.
 *
 * Every one of these renders what the pipeline already committed — the same
 * artifacts the email edition is built from, drawn for a screen the owner
 * controls instead of one Gmail does. Nothing is recomputed here and nothing
 * is invented: a field the file does not carry renders as absent rather than
 * as the word "undefined".
 *
 * Every source mark here is live. Each surface knows which grammar its own
 * marks are written in and says so; citations.ts turns all three into the one
 * address the reader opens. A citation is never a dead tap: an unplaceable
 * mark stays a mark, and a span the document does not contain opens the
 * document at the top and says why.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Markdown } from '../components/Markdown';
import {
  BackLink,
  Backlog,
  Card,
  Cite,
  Failed,
  Headline,
  Kicker,
  ListRow,
  MarkRead,
  Note,
  Notice,
  OutLink,
  Pending,
  Rail,
  RailItem,
  SectionLabel,
  SrcLine,
  type SurfaceRead,
} from '../components/readUi';
import { useAsync } from '../hooks/useAsync';
import {
  citationRoute,
  findCitedBlock,
  resolveCitation,
  routeTarget,
  type Citation,
  type CitationTarget,
  type SourceFile,
} from '../lib/citations';
import { bodyBlocks, inlineText, parseMarkdown } from '../lib/markdown';
import {
  TAPE_PATH,
  briefDates,
  briefPath,
  cachedJson,
  cachedText,
  cachedTree,
  canonDayNumbers,
  canonDocIds,
  chartIds,
  chartPath,
  dayPath,
  describeReadFailure,
  essayPath,
  essaySlugs,
  fetchEntry,
  syllabusPath,
} from '../lib/newslettersRead';
import { loadLibrary } from '../lib/newslettersSync';
import { signed, sparkline, stateTone, weeksSince } from '../lib/readSurfaces';
import { readItemKey } from '../services/data';
import type { ReadSurface } from '../types';

export interface SurfaceProps {
  item: string[];
  onNavigate: (surface: ReadSurface, item: string[]) => void;
  /** Marking is the surfaces' one write. The keys are minted in readState. */
  read: SurfaceRead;
}

/** Every citation on every surface opens the same way. */
function opener(onNavigate: SurfaceProps['onNavigate']) {
  return (target: CitationTarget) => onNavigate('raw', citationRoute(target));
}

/**
 * A source mark, resolved at the point of drawing.
 *
 * The chip says the document, because that is what the reader is deciding
 * about; the span it lands on is in the title and, for the surfaces that keep
 * one, in the footer underneath.
 */
function CiteChip({
  citation,
  label,
  wide,
  onOpen,
}: {
  citation: Citation;
  label?: string;
  wide?: boolean;
  onOpen: (target: CitationTarget) => void;
}) {
  const target = resolveCitation(citation);
  if (target === null) {
    return <Cite wide={wide}>{label ?? '§'}</Cite>;
  }
  return (
    <Cite
      wide={wide}
      title={target.phrase === null ? target.slug : `${target.slug} §${target.phrase}`}
      onClick={() => onOpen(target)}
    >
      {label ?? target.slug}
    </Cite>
  );
}

/** Nothing has been synced yet, so there is nothing to be wrong about. */
function Unsynced({ what }: { what: string }) {
  return (
    <div className="py-2 text-2xs text-text-muted">
      no {what} on this device yet — open with a token to sync
    </div>
  );
}

function Trouble({ error }: { error: unknown }) {
  const { what, detail } = describeReadFailure(error);
  return <Failed what={what} detail={detail} />;
}

/**
 * What a surface draws before it has a document.
 *
 * Every pane reads a file and every read has the same three ways of not being
 * an answer yet: still out, failed, or settled on nothing. In one place so ten
 * call sites cannot drift into ten dialects of the same three lines.
 *
 * `absent` is what "settled on nothing" looks like to this caller — the
 * surface-wide "nothing synced" line, or the named failure for one document.
 * `null` where the read landed and there is nothing to say.
 */
function AsyncGate({
  state,
  what,
  absent,
}: {
  state: { pending: boolean; error: unknown };
  what: string;
  absent?: React.ReactNode;
}) {
  if (state.pending) return <Pending what={what} />;
  if (state.error) return <Trouble error={state.error} />;
  return <>{absent ?? null}</>;
}

// ---------------------------------------------------------------------------
// Brief
// ---------------------------------------------------------------------------

/**
 * The morning brief — one markdown file a day, rendered whole.
 *
 * There is no renderer to diff against here: the pipeline commits the brief as
 * prose and the prose is the edition. So the pane prints the document, and the
 * only thing it adds is the date rail and the mark.
 *
 * The source marks the brief carries inside its sentences stay prose. They are
 * written in running text rather than in footnote definitions or a field, and
 * lifting an address out of a sentence is pattern-matching over language —
 * which this codebase does not do. When the pipeline emits them structurally
 * they become chips like everywhere else; until then a mark is what it says.
 */
export function BriefPane({ item, onNavigate, read }: SurfaceProps) {
  const [date] = item;

  const loadList = useCallback(async () => {
    const dates = briefDates((await cachedTree()).map(file => file.path));
    const texts = await Promise.all(dates.map(one => cachedText(briefPath(one))));
    return dates.map((one, index) => ({
      date: one,
      title: texts[index] === null ? null : parseMarkdown(texts[index]).title,
    }));
  }, []);
  const list = useAsync(loadList);

  const loadBrief = useCallback(async () => {
    if (date === undefined) return null;
    const text = await cachedText(briefPath(date));
    return text === null ? null : parseMarkdown(text);
  }, [date]);
  const brief = useAsync(loadBrief);

  if (list.pending || list.error || !list.value || list.value.length === 0) {
    return <AsyncGate state={list} what="the briefs" absent={<Unsynced what="briefs" />} />;
  }

  if (date === undefined) {
    return (
      <Backlog
        read={read}
        rows={list.value.map(row => ({
          item: { key: readItemKey('brief', row.date), date: row.date },
          node: (
            <ListRow
              key={row.date}
              onClick={() => onNavigate('brief', [row.date])}
              label={row.date}
              title={row.title ?? row.date}
            />
          ),
        }))}
      />
    );
  }

  return (
    <>
      <BackLink onClick={() => onNavigate('brief', [])}>briefs</BackLink>

      <AsyncGate
        state={brief}
        what="the brief"
        absent={
          brief.value ? null : (
            <Failed what="that brief has not been synced to this device" detail={briefPath(date)} />
          )
        }
      />

      {brief.value && (
        <Card>
          <Kicker>brief</Kicker>
          {brief.value.title && <Headline>{brief.value.title}</Headline>}
          <Markdown blocks={bodyBlocks(brief.value)} />

          <MarkRead read={read} itemKey={readItemKey('brief', date)} />
        </Card>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Tape
// ---------------------------------------------------------------------------

interface TapeRow {
  id?: string;
  display_name?: string;
  label?: string;
  state?: string;
  /** One count per week in `weeks`, oldest first. The sparkline is this. */
  touches?: number[];
  /** The week this theme was first seen. Weeks before it never existed. */
  first_seen?: string;
  this_window?: number;
  delta?: number;
  source_chips?: string[];
}

interface TapeCard extends TapeRow {
  stance_left?: string;
  stance_right?: string;
  pressure_text?: string;
  evidence?: { text?: string; slug?: string; citation?: string }[];
  /** An older entry this week's reading pulled back up. */
  resurfacing?: { slug?: string; text?: string };
}

interface TapeFile {
  window?: { key?: string; start?: string; end?: string };
  stats?: {
    entries_in?: number;
    sources_in?: number;
    figures_in?: number;
    new_voices?: string[];
  };
  /** The eight week-start dates the `touches` arrays are counted over. */
  weeks?: string[];
  /** The day the tape was cut. What a theme's age is measured back from. */
  run_date?: string;
  tape?: TapeRow[];
  cards?: TapeCard[];
  /** What entered the tape this week and what went quiet. */
  ledger?: {
    born?: { id?: string; display_name?: string; label?: string; note?: string }[];
    quiet?: { labels?: string; note?: string }[];
  };
}

export function TapePane({ onNavigate, read }: SurfaceProps) {
  const load = useCallback(() => cachedJson<TapeFile>(TAPE_PATH), []);
  const { value, error, pending } = useAsync(load);
  const open = opener(onNavigate);

  if (pending || error || !value) {
    return (
      <AsyncGate state={{ pending, error }} what="the tape" absent={<Unsynced what="tape" />} />
    );
  }

  const rows = value.tape ?? [];
  const cards = value.cards ?? [];
  const weeks = value.weeks ?? [];
  const voices = value.stats?.new_voices ?? [];
  const born = value.ledger?.born ?? [];
  const quiet = value.ledger?.quiet ?? [];
  // The window is the readable item, not the card: the tape is published once
  // a week and read once a week.
  const key = readItemKey('tape', value.window?.key ?? 'tape');

  return (
    <>
      <div className="mb-4 flex items-baseline justify-between text-2xs text-text-muted">
        <span>
          {value.window?.key ?? 'tape'}
          {value.window?.start && value.window?.end
            ? ` · ${value.window.start} → ${value.window.end}`
            : ''}
        </span>
        {typeof value.stats?.entries_in === 'number' && (
          <span className="tabular-nums">
            {value.stats.entries_in} entries · {value.stats.sources_in ?? 0} sources ·{' '}
            {value.stats.figures_in ?? 0} figures
          </span>
        )}
      </div>

      {/* Who is new to the corpus this week. The edition prints it on the
          masthead; on a phone it needs its own line. */}
      {voices.length > 0 && (
        <div className="mb-4 -mt-2 text-2xs text-text-muted">
          {voices.length} new voice{voices.length === 1 ? '' : 's'}: {voices.join(', ')}
        </div>
      )}

      {rows.length > 0 && (
        <div className="mb-5 border-y border-border py-1">
          {rows.map((row, index) => (
            <div
              key={row.id ?? index}
              className="flex items-baseline justify-between gap-3 py-0.5 text-2xs"
            >
              <span className="truncate text-text-secondary">{row.display_name ?? row.id ?? '—'}</span>
              <span className="flex flex-shrink-0 items-baseline gap-2 tabular-nums">
                {row.touches?.length ? (
                  <span className="text-cite">
                    {sparkline(row.touches, weeks, row.first_seen)}
                  </span>
                ) : null}
                {typeof row.this_window === 'number' && (
                  <span className="text-text-muted">{row.this_window}</span>
                )}
                {signed(row.delta) && <span className="text-text-muted">{signed(row.delta)}</span>}
                <span className={stateTone(row.state)}>{row.state ?? ''}</span>
              </span>
            </div>
          ))}
        </div>
      )}

      {cards.map((card, index) => (
        <Card key={card.id ?? index}>
          <Kicker>
            {card.display_name ?? card.id ?? 'theme'}
            {card.state ? ` · ${card.state}` : ''}
            {card.source_chips?.length ? ` · ${card.source_chips.join(' ')}` : ''}
          </Kicker>
          {/* The card's own eight weeks, the count this one, and how long the
              theme has been running. The edition carries all three on one line
              under the header. */}
          {card.touches?.length ? (
            <div className="mb-2 flex flex-wrap items-baseline gap-x-2 text-2xs text-text-muted">
              <span className="text-cite">
                {sparkline(card.touches, weeks, card.first_seen)}
              </span>
              <span className="tabular-nums">
                {card.this_window ?? 0} touch{card.this_window === 1 ? '' : 'es'} this wk
                {signed(card.delta) ? ` (${signed(card.delta)})` : ''}
              </span>
              {weeksSince(card.first_seen, value.run_date) !== null && (
                <span className="tabular-nums">
                  · wk {weeksSince(card.first_seen, value.run_date)}
                </span>
              )}
            </div>
          ) : null}

          {card.label && <Headline>{card.label}</Headline>}

          {card.stance_left && <p className="prose-read mt-3 text-text">{card.stance_left}</p>}
          {card.stance_right && (
            <>
              <div className="mt-3 text-2xs uppercase tracking-label text-text-muted">
                against
              </div>
              <p className="prose-read mt-1 text-text">{card.stance_right}</p>
            </>
          )}
          {card.pressure_text && <Note>{card.pressure_text}</Note>}

          {/* An older entry this week pulled back up — the thing the tape is
              for. It taps into the entry like any other mark. */}
          {card.resurfacing?.slug && (
            <div className="mt-3 text-2xs leading-relaxed text-accent">
              <span className="mr-1">↞ resurfaces:</span>
              <CiteChip
                citation={{ grammar: 'slug', slug: card.resurfacing.slug }}
                onOpen={open}
              />
              {card.resurfacing.text && (
                <span className="ml-1 text-text-secondary">“{card.resurfacing.text}”</span>
              )}
            </div>
          )}

          {card.evidence?.length ? (
            <SrcLine>
              {card.evidence.map((item, evidenceIndex) => (
                <div key={evidenceIndex} className="mb-2 last:mb-0">
                  {item.text && (
                    <span className="font-read text-sm text-text-secondary">
                      {item.text}{' '}
                    </span>
                  )}
                  {item.citation ? (
                    <CiteChip
                      wide
                      citation={{ grammar: 'path', source: item.citation }}
                      onOpen={open}
                    />
                  ) : item.slug ? (
                    <CiteChip wide citation={{ grammar: 'slug', slug: item.slug }} onOpen={open} />
                  ) : null}
                </div>
              ))}
            </SrcLine>
          ) : null}
        </Card>
      ))}

      {/* What entered the tape this week and what stopped moving. The edition
          closes on it, because a theme arriving is news and a theme going
          quiet is the other half of the same reading. */}
      {(born.length > 0 || quiet.length > 0) && (
        <div className="mt-5 border-t border-border pt-4">
          <div className="mb-2 text-2xs uppercase tracking-label text-text-muted">
            the ledger — born &amp; gone quiet
          </div>
          <div className="text-2xs leading-loose">
            {born.map((entry, index) => (
              <div key={`born-${index}`} className="flex gap-2">
                <span className="flex-shrink-0 text-accent">● born</span>
                <span className="text-text-secondary">
                  {entry.display_name ?? entry.label ?? entry.id ?? '—'}
                  {entry.note ? ` — ${entry.note}` : ''}
                </span>
              </div>
            ))}
            {quiet.map((entry, index) => (
              <div key={`quiet-${index}`} className="flex gap-2">
                <span className="flex-shrink-0 text-cite">○ quiet</span>
                <span className="text-text-secondary">
                  {entry.labels ?? '—'}
                  {entry.note ? ` — ${entry.note}` : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <MarkRead read={read} itemKey={key} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Chart
// ---------------------------------------------------------------------------

interface ChartFile {
  date?: string;
  entries?: string[];
  card?: {
    kicker?: string;
    headline?: string;
    srcline?: string;
    metric?: string;
    note?: string;
    bars?: { label?: string; value?: string; w?: number; group?: number }[];
  };
  /**
   * Everything the published edition prints around the chart.
   *
   * `card` is the picture; this is the piece. The pane drew only the picture
   * until now because the plan's shape for this file only listed `card` — the
   * prose was in every chart the whole time, in the file the pane already
   * fetches. `title` and `subtitle` are deliberately not read: they repeat the
   * card's headline and kicker, which are already on screen above.
   */
  post?: {
    intro?: string;
    why?: string;
    questions?: string[];
    footer?: string;
    /** `pre` and `post` are the text either side of the linked publication. */
    sources?: { pre?: string; text?: string; href?: string; post?: string }[];
  };
}

const GROUP_TONE = ['bg-accent', 'bg-settled', 'bg-cite'];

export function ChartPane({ item, onNavigate, read }: SurfaceProps) {
  const loadIds = useCallback(async () => chartIds((await cachedTree()).map(file => file.path)), []);
  const ids = useAsync(loadIds);

  // The rail leads with what has not been read, so the default chart is the
  // first unread one rather than the first one — otherwise a device opening
  // Chart lands on something already dealt with while its backlog sits behind
  // the reveal.
  const chosen =
    item[0] ??
    ids.value?.find(id => !read.spent({ key: readItemKey('chart', id), date: id.slice(0, 10) })) ??
    ids.value?.[0] ??
    null;
  const load = useCallback(
    () => (chosen === null ? Promise.resolve(null) : cachedJson<ChartFile>(chartPath(chosen))),
    [chosen]
  );
  const chart = useAsync(load);
  const open = opener(onNavigate);

  if (ids.pending || ids.error || !ids.value || ids.value.length === 0) {
    return <AsyncGate state={ids} what="the charts" absent={<Unsynced what="charts" />} />;
  }

  const card = chart.value?.card;
  const bars = card?.bars ?? [];
  const post = chart.value?.post;
  const questions = post?.questions ?? [];
  const sources = post?.sources ?? [];
  // `w` is the quantity itself, not a percentage — the widest bar sets the
  // scale, so a chart of trillions and a chart of vessels per day both draw.
  const widest = bars.reduce((most, bar) => Math.max(most, bar.w ?? 0), 0);

  return (
    <>
      <Rail>
        <Backlog
          read={read}
          rows={ids.value.map(id => ({
            item: { key: readItemKey('chart', id), date: id.slice(0, 10) },
            keep: id === chosen,
            node: (
              <RailItem
                key={id}
                active={id === chosen}
                onClick={() => onNavigate('chart', [id])}
              >
                {id.slice(0, 10)}
              </RailItem>
            ),
          }))}
        />
      </Rail>

      <AsyncGate
        state={chart}
        what="the chart"
        absent={
          !card && chosen !== null ? (
            <Failed what="this chart has no card in it" detail={chartPath(chosen)} />
          ) : null
        }
      />

      {card && (
        <Card>
          {card.kicker && <Kicker>{card.kicker}</Kicker>}
          {card.headline && <Headline>{card.headline}</Headline>}
          {card.metric && (
            <div className="mt-2 text-2xs text-text-secondary">{card.metric}</div>
          )}

          <div className="mt-3.5">
            {bars.map((bar, index) => (
              <div
                key={index}
                className="grid grid-cols-[92px_1fr_64px] items-center gap-2.5 py-1 sm:grid-cols-[132px_1fr_72px]"
              >
                <span className="truncate text-right text-xs text-text-secondary">
                  {bar.label ?? ''}
                </span>
                {/* rounded-[3px], not the app's `rounded`: the bar is 12px
                    tall, and a 6px radius would round it into a pill. */}
                <div className="h-3 overflow-hidden rounded-[3px] bg-bg-hover">
                  <div
                    className={`h-full rounded-[3px] ${GROUP_TONE[(bar.group ?? 0) % GROUP_TONE.length]}`}
                    style={{ width: widest > 0 ? `${((bar.w ?? 0) / widest) * 100}%` : '0%' }}
                  />
                </div>
                {/* Outside the bar, always: it survives a stripped fill in mail
                    and a narrow phone here. */}
                <span className="text-left text-xs tabular-nums text-text">
                  {bar.value ?? ''}
                </span>
              </div>
            ))}
          </div>

          {card.note && <Note>{card.note}</Note>}

          {/* The piece, in the order the published edition prints it: the
              opening, the argument, the three questions, then where the
              numbers came from. Every part is optional and absent renders as
              absent — a chart whose file carries no prose is still a chart. */}
          {post?.intro && <p className="prose-read mt-5 text-text">{post.intro}</p>}

          {post?.why && (
            <>
              <SectionLabel>why it's interesting</SectionLabel>
              <p className="prose-read text-text">{post.why}</p>
            </>
          )}

          {questions.length > 0 && (
            <>
              <SectionLabel>table talk</SectionLabel>
              {questions.map((question, index) => (
                <p key={index} className="prose-read mb-2.5 text-text-secondary last:mb-0">
                  {question}
                </p>
              ))}
            </>
          )}

          {sources.length > 0 && (
            <>
              <SectionLabel>sources</SectionLabel>
              {sources.map((source, index) => (
                <p key={index} className="prose-read mb-1.5 text-sm text-text-secondary last:mb-0">
                  {source.pre ?? ''}
                  {source.href && source.text ? (
                    <OutLink href={source.href}>{source.text}</OutLink>
                  ) : (
                    (source.text ?? '')
                  )}
                  {source.post ?? ''}
                </p>
              ))}
            </>
          )}

          {post?.footer && <Note>{post.footer}</Note>}

          <SrcLine>
            {card.srcline ?? 'src'}
            {chart.value?.entries?.length ? (
              <div className="mt-2">
                {chart.value.entries.map(entry => (
                  <CiteChip
                    key={entry}
                    citation={{ grammar: 'slug', slug: entry }}
                    onOpen={open}
                  />
                ))}
              </div>
            ) : null}
          </SrcLine>

          <MarkRead read={read} itemKey={readItemKey('chart', chosen ?? '')} />
        </Card>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Canon
// ---------------------------------------------------------------------------

interface Syllabus {
  doc_id?: string;
  /** `raw/<slug>` — the source document every day of this course cites. */
  entry?: string;
  days?: { day?: number; title?: string; covers?: string; idea?: string }[];
}

interface CanonDay {
  doc_id?: string;
  entry?: string;
  day?: number;
  of?: number;
  subject?: string;
  text?: string;
  citations?: string[];
}

export function CanonPane({ item, onNavigate, read }: SurfaceProps) {
  const [doc, day] = item;

  const loadDocs = useCallback(async () => {
    const paths = (await cachedTree()).map(file => file.path);
    const ids = canonDocIds(paths);
    const syllabi = await Promise.all(ids.map(id => cachedJson<Syllabus>(syllabusPath(id))));
    // A syllabus declares the whole course on day one; the days arrive one a
    // morning. `arrived` is how much of it exists, which is what decides what
    // can be opened.
    return ids.map((id, index) => ({
      id,
      syllabus: syllabi[index],
      arrived: canonDayNumbers(paths, id),
    }));
  }, []);
  const docs = useAsync(loadDocs);

  const loadDay = useCallback(
    () =>
      doc === undefined || day === undefined
        ? Promise.resolve(null)
        : cachedJson<CanonDay>(dayPath(doc, Number(day))),
    [doc, day]
  );
  const lesson = useAsync(loadDay);
  const open = opener(onNavigate);

  if (docs.pending || docs.error || !docs.value || docs.value.length === 0) {
    return <AsyncGate state={docs} what="the canon" absent={<Unsynced what="canon lessons" />} />;
  }

  if (doc === undefined) {
    return (
      <>
        {docs.value.map(entry => {
          const of = entry.syllabus?.days?.length ?? 0;
          const here = entry.arrived.length;
          return (
            <ListRow
              key={entry.id}
              onClick={() => onNavigate('canon', [entry.id])}
              // A course still being delivered says so, rather than claiming
              // nine days when two have arrived.
              label={here < of ? `${here} of ${of} days` : `${of} days`}
              title={entry.id}
              detail={entry.syllabus?.days?.[0]?.idea ?? null}
            />
          );
        })}
      </>
    );
  }

  const chosen = docs.value.find(entry => entry.id === doc) ?? null;
  const syllabus = chosen?.syllabus ?? null;
  const arrived = chosen?.arrived ?? [];
  const latest = arrived.length > 0 ? arrived[arrived.length - 1] : 0;

  if (day === undefined) {
    return (
      <>
        <BackLink onClick={() => onNavigate('canon', [])}>canon</BackLink>
        {syllabus?.days?.length ? (
          <Backlog
            read={read}
            rows={syllabus.days.map(entry => {
              const number = entry.day ?? 1;
              const here = arrived.includes(number);
              const label = `day ${entry.day ?? '?'}${entry.covers ? ` · ${entry.covers}` : ''}`;
              // A course arrives a day at a time and that is the pleasure of it.
              // The outline stays visible — it is the map — but a day that has
              // not been written is not a door, and saying "not synced" when it
              // was never sent would be a lie about this device.
              return {
                // A day carries no date of its own, so only the owner's own
                // mark can fold it. A day that has not arrived never folds:
                // it is the part of the map still to be walked.
                item: { key: readItemKey('canon', `${doc}/${number}`), date: null },
                keep: !here,
                node: here ? (
                  <ListRow
                    key={number}
                    onClick={() => onNavigate('canon', [doc, String(number)])}
                    label={label}
                    title={entry.title ?? `day ${entry.day ?? '?'}`}
                    detail={entry.idea ?? null}
                  />
                ) : (
                  <div key={number} className="border-b border-border px-0.5 py-3 opacity-45">
                    <div className="text-2xs tracking-caps text-text-muted">
                      {label} · not yet
                    </div>
                    <div className="text-xs text-text-secondary">
                      {entry.title ?? `day ${entry.day ?? '?'}`}
                    </div>
                  </div>
                ),
              };
            })}
          />
        ) : (
          <Failed what="this document has no syllabus on this device" detail={syllabusPath(doc)} />
        )}
      </>
    );
  }

  const current = Number(day);
  const of = lesson.value?.of ?? syllabus?.days?.length ?? 0;
  const title = syllabus?.days?.find(entry => entry.day === current)?.title ?? null;
  // The lesson names its source; the syllabus names it too, and either will
  // do. A course whose files say neither leaves its marks inert rather than
  // pointing them all at a guess.
  const entry = lesson.value?.entry ?? syllabus?.entry ?? null;

  return (
    <>
      <BackLink onClick={() => onNavigate('canon', [doc])}>{doc}</BackLink>

      <AsyncGate
        state={lesson}
        what="the lesson"
        absent={
          lesson.value ? null : latest > 0 && current > latest ? (
            <Notice>
              day {current} has not arrived yet — the course is at day {latest} of {of || '?'}
            </Notice>
          ) : (
            <Failed
              what="that day has not been synced to this device"
              detail={dayPath(doc, current)}
            />
          )
        }
      />

      {lesson.value && (
        <Card>
          <div className="flex items-baseline justify-between">
            <Kicker tone="ice">canon · {lesson.value.doc_id ?? doc}</Kicker>
            <span className="text-2xs tabular-nums text-text-muted">
              day {lesson.value.day ?? current}
              {of ? `/${of}` : ''}
            </span>
          </div>
          {title && <Headline>{title}</Headline>}

          {/* From `text`, never the stored email html: the html is built for a
              mail client, and this is not one. */}
          {lesson.value.text ? (
            <Markdown
              blocks={parseMarkdown(lesson.value.text).blocks}
              links={{ entry, onOpen: open }}
            />
          ) : (
            <div className="mt-3 text-2xs text-text-muted">this lesson carries no text.</div>
          )}

          {lesson.value.citations?.length ? (
            <SrcLine>
              {lesson.value.citations.map(citation => (
                <div key={citation} className="mb-1.5 last:mb-0">
                  <CiteChip
                    wide
                    citation={{ grammar: 'phrase', entry: entry ?? '', phrase: citation }}
                    label={`§${citation}`}
                    onOpen={open}
                  />
                </div>
              ))}
            </SrcLine>
          ) : null}

          <div className="mt-4 flex justify-between text-2xs text-text-muted">
            <button
              disabled={current <= 1}
              onClick={() => onNavigate('canon', [doc, String(current - 1)])}
              className="disabled:opacity-30"
            >
              ← previous
            </button>
            {/* Forward only as far as the course has been delivered. The
                syllabus knows about day nine; day nine does not exist yet. */}
            <button
              disabled={latest > 0 ? current >= latest : of > 0 && current >= of}
              onClick={() => onNavigate('canon', [doc, String(current + 1)])}
              className="disabled:opacity-30"
            >
              next →
            </button>
          </div>

          {/* A course keeps progress, not a backlog: the mark says which days
              are done. It carries no date, so it never reaches the wave. */}
          <MarkRead read={read} itemKey={readItemKey('canon', `${doc}/${current}`)} />
        </Card>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Essays
// ---------------------------------------------------------------------------

export function EssayPane({ item, onNavigate, read }: SurfaceProps) {
  const [slug] = item;
  const open = opener(onNavigate);

  const loadList = useCallback(async () => {
    const slugs = essaySlugs((await cachedTree()).map(file => file.path));
    const [texts, library] = await Promise.all([
      Promise.all(slugs.map(one => cachedText(essayPath(one)))),
      // The same gists the Library shows. A footnote marker is a few pixels
      // wide and the thing it points at is a document, so the popover says
      // which one in the corpus's own words before the reader commits.
      loadLibrary(),
    ]);
    return {
      entries: slugs.map((one, index) => ({
        slug: one,
        title: texts[index] === null ? null : parseMarkdown(texts[index]).title,
      })),
      gists: new Map(library.map(row => [row.slug, row.gist])),
    };
  }, []);
  const list = useAsync(loadList);

  const loadEssay = useCallback(
    async () => {
      if (slug === undefined) return null;
      const text = await cachedText(essayPath(slug));
      return text === null ? null : parseMarkdown(text);
    },
    [slug]
  );
  const essay = useAsync(loadEssay);

  if (list.pending || list.error || !list.value || list.value.entries.length === 0) {
    return <AsyncGate state={list} what="the essays" absent={<Unsynced what="essays" />} />;
  }

  const gists = list.value.gists;

  if (slug === undefined) {
    return (
      <Backlog
        read={read}
        rows={list.value.entries.map(entry => ({
          // An essay carries no date the corpus agrees on, so the mark is the
          // only thing that folds it.
          item: { key: readItemKey('essay', entry.slug), date: null },
          node: (
            <ListRow
              key={entry.slug}
              onClick={() => onNavigate('essay', [entry.slug])}
              label={entry.slug.slice(0, 10)}
              title={entry.title ?? entry.slug}
            />
          ),
        }))}
      />
    );
  }

  // The definitions at the foot of the essay are the only place its markers
  // resolve — there is no sidecar in the repo — so they are what the markers
  // and the strip below both read.
  const definitions = new Map(
    (essay.value?.footnotes ?? []).map(note => [note.label, inlineText(note.children)])
  );

  return (
    <>
      <BackLink onClick={() => onNavigate('essay', [])}>essays</BackLink>

      <AsyncGate
        state={essay}
        what="the essay"
        absent={
          essay.value ? null : (
            <Failed what="that essay has not been synced to this device" detail={essayPath(slug)} />
          )
        }
      />

      {essay.value && (
        <Card>
          <Kicker>essay</Kicker>
          {essay.value.title && <Headline>{essay.value.title}</Headline>}
          <Markdown
            blocks={bodyBlocks(essay.value)}
            links={{
              footnotes: definitions,
              gist: one => gists.get(one) ?? null,
              onOpen: open,
            }}
          />

          {essay.value.footnotes.length > 0 && (
            <SrcLine>
              {/* The footnote strip comes out of the essay itself. The sidecar
                  the plan expected does not exist in the repo; the definitions
                  live at the foot of the markdown, which is one source rather
                  than two that can disagree. */}
              {essay.value.footnotes.map(note => {
                const source = definitions.get(note.label) ?? '';
                const target = resolveCitation({ grammar: 'path', source });
                return (
                  <div key={note.label} className="mb-1.5 last:mb-0">
                    <span className="text-cite">[{note.label}]</span>{' '}
                    {target === null ? (
                      <span className="break-all">{source}</span>
                    ) : (
                      <>
                        <Cite wide title={source} onClick={() => open(target)}>
                          {target.slug}
                        </Cite>
                        {target.phrase && (
                          <span className="ml-1 break-words">§{target.phrase}</span>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </SrcLine>
          )}

          <MarkRead read={read} itemKey={readItemKey('essay', slug)} />
        </Card>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// The source reader
// ---------------------------------------------------------------------------

/**
 * Where every citation lands.
 *
 * The address carries the entry, which file inside it, and the span to open
 * at — so a citation survives a reload, a back button, and being sent to
 * yourself. The span is found in the blocks this pane is actually drawing,
 * not in the file's characters: the parser has already joined a wrapped
 * paragraph's lines and dropped the emphasis marks, and a citation quotes
 * what the document says rather than how it was typed.
 *
 * A span the document does not contain is not an error. The document opens at
 * the top and one hairline says why, because the reader asked for this entry
 * and the entry is what they got.
 */
export function RawPane({ item, read }: SurfaceProps) {
  const target = routeTarget(item);
  const slug = target?.slug;
  const wanted: SourceFile = target?.file ?? 'prose';
  const phrase = target?.phrase ?? null;

  const load = useCallback(
    () => (slug === undefined ? Promise.resolve(null) : fetchEntry(slug)),
    [slug]
  );
  const entry = useAsync(load);

  // The route chooses the file. The toggle overrides it, but only for the
  // route it was made on: opening the next citation starts from what that
  // citation asked for rather than from wherever the last one was left.
  const route = item.join('\u0000');
  const [override, setOverride] = useState<{ route: string; file: SourceFile } | null>(null);
  const chosen = override?.route === route ? override.file : wanted;

  const parsed = useMemo(() => {
    if (!entry.value) return null;
    return {
      prose: parseMarkdown(entry.value.prose),
      figures: entry.value.figures === null ? null : parseMarkdown(entry.value.figures),
    };
  }, [entry.value]);

  const showing: SourceFile = chosen === 'figures' && parsed?.figures ? 'figures' : 'prose';

  const blocks = useMemo(() => {
    if (parsed === null) return [];
    if (showing === 'figures' && parsed.figures !== null) return parsed.figures.blocks;
    return bodyBlocks(parsed.prose);
  }, [parsed, showing]);

  const mark = useMemo(
    () => (phrase === null ? -1 : findCitedBlock(blocks, phrase)),
    [blocks, phrase]
  );

  const landing = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (mark < 0) return;
    const found = landing.current?.querySelector('[data-cite-mark]');
    if (!found || typeof found.scrollIntoView !== 'function') return;
    const still =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    found.scrollIntoView({ block: 'center', behavior: still ? 'auto' : 'smooth' });
  }, [mark, slug, showing]);

  if (slug === undefined) {
    return <Failed what="no entry named in this address" />;
  }
  if (entry.pending || entry.error || !entry.value || parsed === null) {
    return <AsyncGate state={entry} what={slug} absent={<Unsynced what="source entries" />} />;
  }

  const missedFigures = wanted === 'figures' && parsed.figures === null;
  const missedSpan = phrase !== null && mark < 0;
  const entryKey = readItemKey('raw', entry.value.slug);

  return (
    <Card>
      <div className="flex items-baseline justify-between gap-3">
        <Kicker>raw · {entry.value.slug.slice(0, 10)}</Kicker>
        {parsed.figures !== null && (
          <div className="flex flex-shrink-0 gap-2 text-2xs">
            <button
              onClick={() => setOverride({ route, file: 'prose' })}
              className={showing === 'figures' ? 'text-text-muted' : 'text-accent'}
            >
              prose
            </button>
            <span className="text-text-muted">|</span>
            <button
              onClick={() => setOverride({ route, file: 'figures' })}
              className={showing === 'figures' ? 'text-accent' : 'text-text-muted'}
            >
              figures
            </button>
          </div>
        )}
      </div>

      <Headline>{parsed.prose.title ?? entry.value.slug}</Headline>

      {missedFigures && <Notice>no figures in this entry — opened the prose</Notice>}
      {missedSpan && !missedFigures && <Notice>§ not found — opened at top</Notice>}

      <div ref={landing}>
        <Markdown blocks={blocks} mark={mark < 0 ? null : mark} />
      </div>

      {/* The same key the Library row carries: marking here turns the dot
          there, because it is the same entry. */}
      <MarkRead read={read} itemKey={entryKey} />
    </Card>
  );
}
