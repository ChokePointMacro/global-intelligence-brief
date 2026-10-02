/**
 * Eastern-time helpers.
 *
 * Every slot time in this app is defined in New York time, because the content is
 * keyed to US market hours. The machine running the app is NOT on Eastern time
 * (it's America/Los_Angeles), so "6am" has to mean 6am ET regardless of where the
 * laptop is, and it has to survive the DST transitions that ET observes and
 * Phoenix does not.
 *
 * The previous implementation hardcoded `UTC-5` and called it EST. That is correct
 * for roughly four months of the year and an hour off for the other eight — during
 * EDT every slot landed an hour late and the engagement-hour table was keyed to the
 * wrong hour entirely. There is no fixed offset for "Eastern"; the only correct
 * approach is to ask the platform's timezone database, which is what Intl does.
 */

export const ET_ZONE = 'America/New_York';

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: ET_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

export interface EtParts {
  year: number;
  month: number;   // 1-12
  day: number;     // 1-31
  hour: number;    // 0-23
  minute: number;
  second: number;
  weekday: number; // 0=Sun … 6=Sat
}

/** Break an instant into its Eastern-time wall-clock parts. */
export function etParts(instant: Date = new Date()): EtParts {
  const map: Record<string, string> = {};
  for (const p of partsFormatter.formatToParts(instant)) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  // `hour12: false` yields hour 24 at midnight in some ICU versions; normalise it.
  const hour = Number(map.hour) % 24;
  const year = Number(map.year);
  const month = Number(map.month);
  const day = Number(map.day);
  return {
    year,
    month,
    day,
    hour,
    minute: Number(map.minute),
    second: Number(map.second),
    // Derive the weekday from the ET calendar date rather than a second format pass,
    // so it can never disagree with the y/m/d above.
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
  };
}

/**
 * Eastern's UTC offset at a given instant, in milliseconds.
 * Negative, since ET is behind UTC: -5h under EST, -4h under EDT.
 */
function etOffsetMs(instant: Date): number {
  const p = etParts(instant);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asIfUtc - instant.getTime();
}

/**
 * Convert an Eastern wall-clock time to the UTC instant it refers to.
 *
 * A fixed offset can't do this, and nor can a single pass: the offset you need in
 * order to do the conversion is itself a function of the instant you're trying to
 * compute. So we generate candidates and keep the ones that actually render back to
 * the wall clock we asked for.
 *
 * The two DST edge cases are resolved deliberately, because "whatever falls out" is
 * how schedulers end up firing an hour early:
 *
 *   - Fall back (1:30am ET happens twice): returns the FIRST, earlier instant.
 *   - Spring forward (2:30am ET never happens): rolls FORWARD into the 3am hour.
 *     Rolling backward would be equally "valid" arithmetic but could place a slot
 *     before the slot that precedes it, breaking the ordering the publisher relies on.
 *
 * Neither case arises for this app's real slot times, but a scheduler that is subtly
 * wrong twice a year is worse than one that is obviously wrong, so it's pinned down
 * and covered by tests.
 */
export function etToUtc(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute, second);

  // Two candidate instants: one using the offset in effect at the naive timestamp,
  // one using the offset in effect at that first candidate. Away from a transition
  // these are identical; within an hour of one they straddle it.
  const candidates = new Set<number>();
  const first = naive - etOffsetMs(new Date(naive));
  candidates.add(first);
  candidates.add(naive - etOffsetMs(new Date(first)));

  // Keep only candidates that genuinely render back to the requested wall clock.
  const exact = [...candidates].filter(ms => {
    const p = etParts(new Date(ms));
    return p.year === year && p.month === month && p.day === day
      && p.hour === hour && p.minute === minute && p.second === second;
  });

  // Ambiguous (fall back) → earliest match. Non-existent (spring forward) → the
  // later candidate, which lands an hour past the gap.
  const chosen = exact.length ? Math.min(...exact) : Math.max(...candidates);
  return new Date(chosen);
}

/** "HH:MM" in Eastern time — the format `scheduled_reports.schedule_time` uses. */
export function etTimeString(instant: Date = new Date()): string {
  const p = etParts(instant);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

/** Minutes since ET midnight. Used to compare against a stored "HH:MM". */
export function etMinutesOfDay(instant: Date = new Date()): number {
  const p = etParts(instant);
  return p.hour * 60 + p.minute;
}

/** Parse "HH:MM" into minutes since midnight, or null if malformed. */
export function parseHhMm(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((value || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * "YYYY-MM-DD HH:MM" in Eastern — the exact format the schedule prompt accepts and
 * that normaliseScheduledAt() reads back as Eastern wall clock.
 *
 * Used for the default value in the UI. Building that default from toISOString() gave a
 * UTC wall clock, which the server then read as Eastern — a silent 4-5 hour shift.
 */
export function etInputValue(instant: Date = new Date()): string {
  const p = etParts(instant);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)} ${pad2(p.hour)}:${pad2(p.minute)}`;
}

const displayTimeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: ET_ZONE,
  hour: 'numeric',
  minute: '2-digit',
});

/**
 * An instant rendered as a human-readable Eastern clock time, e.g. "4:20 PM".
 *
 * The schedule list previously used toLocaleTimeString() — i.e. the *browser's* zone —
 * while labelling the result "EST". Viewed from Phoenix that was an hour or three off
 * from the label it carried.
 */
export function etDisplayTime(instant: Date): string {
  return displayTimeFormatter.format(instant);
}

/**
 * Mike's own timezone. Phoenix does NOT observe daylight saving, so its offset to
 * Eastern changes twice a year: 3 hours behind under EDT, 2 under EST. The timeline
 * shows both, because "4:20 PM ET" means two different local times depending on the
 * month and getting that wrong is how you miss your own post.
 */
export const LOCAL_ZONE = 'America/Phoenix';

const localTimeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: LOCAL_ZONE,
  hour: 'numeric',
  minute: '2-digit',
});

/** An instant rendered as a Phoenix clock time, e.g. "1:20 PM". */
export function localDisplayTime(instant: Date): string {
  return localTimeFormatter.format(instant);
}

/**
 * Whether Eastern is observing DST at an instant, for labelling output "EDT" vs "EST".
 *
 * The instant is truncated to whole seconds before comparing. etParts() has only
 * second resolution, so differencing it against a millisecond-precision timestamp
 * leaves a sub-second remainder and the offset never equals exactly -4h — which made
 * this return "EST" all year round, including in October.
 */
export function etZoneAbbrev(instant: Date = new Date()): 'EDT' | 'EST' {
  const p = etParts(instant);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const wholeSeconds = Math.floor(instant.getTime() / 1000) * 1000;
  return asIfUtc - wholeSeconds === -4 * 3_600_000 ? 'EDT' : 'EST';
}

/** ET calendar date as "YYYY-MM-DD" — for once-per-ET-day guards. */
export function etDateString(instant: Date = new Date()): string {
  const p = etParts(instant);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/**
 * Midnight Eastern on the next occurrence of `targetDay` (0=Sun…6=Sat).
 * If today already is that weekday in ET, returns next week's — scheduling into
 * the same day would put slots in the past.
 */
export function nextEtWeekdayMidnight(targetDay: number, from: Date = new Date()): Date {
  const p = etParts(from);
  let daysUntil = (targetDay - p.weekday + 7) % 7;
  if (daysUntil === 0) daysUntil = 7;
  // Advance the ET calendar date, then resolve that wall-clock midnight to UTC.
  // Using Date.UTC for the arithmetic keeps it DST-free: it's pure calendar maths
  // on y/m/d, and etToUtc applies the correct offset afterwards.
  const advanced = new Date(Date.UTC(p.year, p.month - 1, p.day + daysUntil));
  return etToUtc(
    advanced.getUTCFullYear(),
    advanced.getUTCMonth() + 1,
    advanced.getUTCDate(),
    0, 0, 0,
  );
}

/**
 * Normalise a user- or client-supplied datetime to an ISO-8601 UTC string.
 *
 * This exists because SQLite compares DATETIME columns as text. A value like
 * "2026-10-01 23:59" (space separator, no zone) sorts BELOW "2026-10-01T00:00:00.000Z"
 * because ' ' (0x20) < 'T' (0x54) — so a post scheduled for tonight compared as due
 * at UTC midnight and published ~18 hours early. Every write path must go through
 * here so the column holds exactly one comparable format.
 *
 * A value carrying no timezone is interpreted as Eastern wall-clock, matching how
 * slot times are defined everywhere else in the app.
 *
 * Returns null if the input cannot be parsed, so callers can reject rather than
 * store something that will compare unpredictably.
 */
export function normaliseScheduledAt(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;

  // Already carries a zone (trailing Z or ±HH:MM) — trust it and canonicalise.
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)) {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  // Zone-less wall clock: "YYYY-MM-DD[ T]HH:MM[:SS]" → interpret as Eastern.
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(raw);
  if (m) {
    const d = etToUtc(
      Number(m[1]), Number(m[2]), Number(m[3]),
      Number(m[4]), Number(m[5]), Number(m[6] ?? 0),
    );
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  // Date only → midnight Eastern.
  const dOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (dOnly) {
    const d = etToUtc(Number(dOnly[1]), Number(dOnly[2]), Number(dOnly[3]), 0, 0, 0);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  return null;
}
