/**
 * `Intl.DateTimeFormat` parts, read by name and paid for once.
 *
 * Every zone-aware answer in the app is read off `formatToParts` rather than a
 * formatted string: the parts are looked up by name, so no locale's date
 * order or separator can change the answer. A locale-shaped `format()` call
 * would put the month first for an en-US device and silently bucket events
 * into the wrong day.
 *
 * Pure: no imports, no clock of its own.
 */

const ZONE_FORMATS = new Map<string, Intl.DateTimeFormat>();

/**
 * One formatter per zone, reused.
 *
 * Constructing an `Intl.DateTimeFormat` is the expensive part of every zone
 * lookup in this app, and a week's fold asks for hundreds.
 *
 * It carries the whole wall clock — date and time — because both callers read
 * from the same instance: the ledger wants every field, `dayKey` wants only
 * the date three. Requesting the extra fields does not change the date ones.
 * `hourCycle: 'h23'` is load-bearing for the time fields: an en-US default
 * renders midnight as hour 24 on some engines and 0 on others, and a 24 pushes
 * every early-morning instant into the following day's bucket.
 */
export function zoneFormat(timeZone: string): Intl.DateTimeFormat {
  const cached = ZONE_FORMATS.get(timeZone);
  if (cached) return cached;
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  ZONE_FORMATS.set(timeZone, format);
  return format;
}

/** One named part's value, or undefined where the formatter did not emit it. */
export function partsOf(parts: readonly Intl.DateTimeFormatPart[], type: string): string | undefined {
  return parts.find(part => part.type === type)?.value;
}
