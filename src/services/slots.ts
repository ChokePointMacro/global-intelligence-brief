/**
 * Slot placement — where a post lands on the timeline, and what collides with what.
 *
 * Pure functions over plain data, deliberately free of database and Express, because
 * this is the logic most likely to be subtly wrong twice a year and it needs to be
 * testable without standing up a server.
 *
 * Every time here is an absolute instant (a Date) or an Eastern wall clock resolved
 * through src/services/time.ts. There is no arithmetic on raw millisecond offsets
 * across day boundaries: a day is 23 or 25 hours long twice a year, and "midnight plus
 * 16h20m" is the bug that produces.
 */
import { etParts, etToUtc, etDateString, parseHhMm } from './time.ts';
import type { PostType } from './postTypes.ts';

/** The subset of a post the placement logic needs. */
export interface SlotPost {
  id: number;
  type_id: number | null;
  status: string;
  /** ISO-8601 UTC, or null for an unscheduled draft. */
  scheduled_at: string | null;
  time_confirmed?: number;
}

/** Statuses that still occupy a slot. A skipped or archived post frees its slot. */
const OCCUPYING = new Set(['draft', 'needs_review', 'approved', 'posting', 'posted', 'failed']);

export function occupiesSlot(status: string): boolean {
  return OCCUPYING.has(status);
}

/** "1,2,3" → Set{1,2,3}. Tolerates whitespace, blanks and duplicates. */
export function parseDays(days: string | null | undefined): Set<number> {
  return new Set(
    String(days ?? '')
      .split(',')
      .map(d => d.trim())
      .filter(Boolean)
      .map(Number)
      .filter(n => Number.isInteger(n) && n >= 0 && n <= 6),
  );
}

/**
 * The next time this type's default slot comes round, as an absolute instant.
 *
 * Returns null when the type has no slot of its own (Manual, the Substack link reply)
 * or runs on no days — those are placed by hand, not by the calendar.
 *
 * Starts from today: if today is a matching weekday and the slot time has not yet
 * passed, today's slot is the answer. Only once it's passed do we look to the next
 * matching day.
 */
export function nextSlotForType(
  type: Pick<PostType, 'default_time_et' | 'days_of_week'>,
  from: Date = new Date(),
  maxDaysAhead = 14,
): Date | null {
  const minutes = parseHhMm(type.default_time_et ?? '');
  if (minutes === null) return null;

  const days = parseDays(type.days_of_week);
  if (days.size === 0) return null;

  const base = etParts(from);
  for (let offset = 0; offset <= maxDaysAhead; offset++) {
    // Calendar arithmetic on y/m/d via Date.UTC is DST-free; etToUtc applies the
    // correct offset afterwards. Date.UTC normalises overflow (Oct 32 → Nov 1).
    const day = new Date(Date.UTC(base.year, base.month - 1, base.day + offset));
    if (!days.has(day.getUTCDay())) continue;

    const slot = etToUtc(
      day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(),
      Math.floor(minutes / 60), minutes % 60,
    );
    if (slot.getTime() > from.getTime()) return slot;
  }
  return null;
}

/**
 * Push a desired time forward until it is at least `minSpacingMinutes` from every
 * occupied slot. This is the "move to next open time" fix on a spacing conflict.
 *
 * Steps to just past the conflicting post rather than by a fixed increment, so it
 * settles in one or two passes instead of creeping forward a minute at a time.
 */
export function nextOpenTime(
  desired: Date,
  existing: SlotPost[],
  minSpacingMinutes: number,
  maxIterations = 50,
): Date {
  const spacingMs = Math.max(0, minSpacingMinutes) * 60_000;
  if (spacingMs === 0) return desired;

  const taken = existing
    .filter(p => p.scheduled_at && occupiesSlot(p.status))
    .map(p => new Date(p.scheduled_at!).getTime())
    .filter(t => Number.isFinite(t))
    .sort((a, b) => a - b);

  let candidate = desired.getTime();
  for (let i = 0; i < maxIterations; i++) {
    const clash = taken.find(t => Math.abs(t - candidate) < spacingMs);
    if (clash === undefined) return new Date(candidate);
    candidate = clash + spacingMs;
  }
  // Pathological input (hundreds of posts within one spacing window). Return the best
  // effort rather than looping — the caller still shows a conflict flag.
  return new Date(candidate);
}

export interface SpacingConflict {
  a: number;
  b: number;
  minutesApart: number;
}

/**
 * Pairs of posts closer together than the minimum spacing.
 *
 * Compares neighbours in time order rather than every pair: if A and C are far enough
 * apart, nothing between them can be too close to both without also being too close to
 * its immediate neighbour, which this does catch.
 */
export function findSpacingConflicts(posts: SlotPost[], minSpacingMinutes: number): SpacingConflict[] {
  const spacingMs = Math.max(0, minSpacingMinutes) * 60_000;
  if (spacingMs === 0) return [];

  const timed = posts
    .filter(p => p.scheduled_at && occupiesSlot(p.status))
    .map(p => ({ id: p.id, t: new Date(p.scheduled_at!).getTime() }))
    .filter(p => Number.isFinite(p.t))
    .sort((x, y) => x.t - y.t);

  const out: SpacingConflict[] = [];
  for (let i = 1; i < timed.length; i++) {
    const gap = timed[i].t - timed[i - 1].t;
    if (gap < spacingMs) {
      out.push({
        a: timed[i - 1].id,
        b: timed[i].id,
        minutesApart: Math.round(gap / 60_000),
      });
    }
  }
  return out;
}

export interface EmptySlot {
  typeId: number;
  code: string;
  name: string;
  color: string;
  /** ISO-8601 UTC instant of the unfilled slot. */
  at: string;
  /** ET calendar day, for grouping on the timeline. */
  etDate: string;
}

/**
 * Slots in the window where an active type should have a post and doesn't.
 *
 * These render as the dashed placeholder cards ("S5 Headline B, no post yet") with a
 * Generate button. Only types with both a slot time and at least one active day can
 * produce one — a Manual post is never "missing".
 *
 * A type is considered filled for a day if it has any occupying post that ET day, not
 * specifically at the slot time: a post moved from 8:45 to 9:15 still fills S1.
 */
export function findEmptySlots(
  types: PostType[],
  posts: SlotPost[],
  from: Date,
  daysAhead: number,
): EmptySlot[] {
  const out: EmptySlot[] = [];

  // Index occupied (typeId, ET day) pairs once rather than rescanning per slot.
  const filled = new Set<string>();
  for (const p of posts) {
    if (!p.scheduled_at || p.type_id == null || !occupiesSlot(p.status)) continue;
    const d = new Date(p.scheduled_at);
    if (!Number.isFinite(d.getTime())) continue;
    filled.add(`${p.type_id}:${etDateString(d)}`);
  }

  const base = etParts(from);
  for (const type of types) {
    if (!type.active) continue;
    const minutes = parseHhMm(type.default_time_et ?? '');
    if (minutes === null) continue;
    const days = parseDays(type.days_of_week);
    if (days.size === 0) continue;

    for (let offset = 0; offset < daysAhead; offset++) {
      const day = new Date(Date.UTC(base.year, base.month - 1, base.day + offset));
      if (!days.has(day.getUTCDay())) continue;

      const at = etToUtc(
        day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(),
        Math.floor(minutes / 60), minutes % 60,
      );
      // A slot already in the past is a missed opportunity, not something to fill.
      if (at.getTime() <= from.getTime()) continue;

      const etDate = etDateString(at);
      if (filled.has(`${type.id}:${etDate}`)) continue;

      out.push({ typeId: type.id, code: type.code, name: type.name, color: type.color, at: at.toISOString(), etDate });
    }
  }

  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/**
 * How many posts of this type already occupy the given ET day — the max_per_day check.
 */
export function countForTypeOnDay(posts: SlotPost[], typeId: number, etDate: string): number {
  return posts.filter(p =>
    p.type_id === typeId &&
    p.scheduled_at &&
    occupiesSlot(p.status) &&
    etDateString(new Date(p.scheduled_at)) === etDate,
  ).length;
}
