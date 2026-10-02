import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  nextSlotForType, nextOpenTime, findSpacingConflicts, findEmptySlots,
  parseDays, occupiesSlot, countForTypeOnDay, type SlotPost,
} from '../src/services/slots.ts';
import { etToUtc, etParts, etDateString } from '../src/services/time.ts';
import type { PostType } from '../src/services/postTypes.ts';

const type = (over: Partial<PostType> = {}): PostType => ({
  id: 1, name: 'Close Analysis', code: 'S3', color: '#8b5cf6',
  default_time_et: '16:20', days_of_week: '1,2,3,4,5', max_per_day: 1,
  prompt_template: '', card_type: 'market_chart', cashtag_min: 0, cashtag_max: 0,
  hashtag_max: 1, length_mode: 'short', source_required: 1, staleness_hours: null,
  active: 1, sort_order: 10, ...over,
});

const post = (id: number, at: string | null, over: Partial<SlotPost> = {}): SlotPost =>
  ({ id, type_id: 1, status: 'approved', scheduled_at: at, ...over });

// ─── parseDays / occupiesSlot ──────────────────────────────────────────────────

test('parseDays tolerates whitespace, blanks, duplicates and junk', () => {
  assert.deepEqual([...parseDays('1,2,3')], [1, 2, 3]);
  assert.deepEqual([...parseDays(' 1 , 2 ')], [1, 2]);
  assert.deepEqual([...parseDays('1,1,2')], [1, 2]);
  assert.deepEqual([...parseDays('')], []);
  assert.deepEqual([...parseDays(null)], []);
  assert.deepEqual([...parseDays('1,9,x,-1')], [1], 'out-of-range values are dropped');
});

test('skipped and archived posts free their slot; live ones do not', () => {
  for (const s of ['draft', 'needs_review', 'approved', 'posting', 'posted', 'failed']) {
    assert.equal(occupiesSlot(s), true, `${s} should occupy`);
  }
  for (const s of ['skipped', 'archived']) {
    assert.equal(occupiesSlot(s), false, `${s} should not occupy`);
  }
});

// ─── nextSlotForType ───────────────────────────────────────────────────────────

test('today\'s slot is used when it has not passed yet', () => {
  // Thu 2026-10-01, 09:00 ET. S3 is at 16:20 today — still ahead.
  const from = etToUtc(2026, 10, 1, 9, 0);
  const slot = nextSlotForType(type(), from)!;
  assert.equal(etDateString(slot), '2026-10-01');
  const p = etParts(slot);
  assert.equal(p.hour, 16);
  assert.equal(p.minute, 20);
});

test('once today\'s slot has passed it rolls to the next active day', () => {
  // Thu 2026-10-01, 17:00 ET — 16:20 is gone, so Friday.
  const from = etToUtc(2026, 10, 1, 17, 0);
  assert.equal(etDateString(nextSlotForType(type(), from)!), '2026-10-02');
});

test('a slot exactly now is treated as passed, not as still open', () => {
  // Strictly-future avoids handing the publisher a slot it would fire on instantly.
  const from = etToUtc(2026, 10, 1, 16, 20);
  assert.equal(etDateString(nextSlotForType(type(), from)!), '2026-10-02');
});

test('weekday-only types skip the weekend', () => {
  // Fri 2026-10-02, 18:00 ET → next Mon-Fri slot is Monday the 5th.
  const from = etToUtc(2026, 10, 2, 18, 0);
  assert.equal(etDateString(nextSlotForType(type(), from)!), '2026-10-05');
});

test('a weekly type lands on its one day', () => {
  // Sunday Week Ahead, 18:00 Sun. From Thu Oct 1 → Sun Oct 4.
  const sun = type({ code: 'SUN', default_time_et: '18:00', days_of_week: '0' });
  assert.equal(etDateString(nextSlotForType(sun, etToUtc(2026, 10, 1, 9, 0))!), '2026-10-04');
});

test('CRITICAL: a slot keeps its wall-clock time across the DST boundary', () => {
  // ET leaves DST on Sun 2026-11-01. A 16:20 slot must still be 16:20 ET after it,
  // which is a DIFFERENT absolute offset — 20:20Z before, 21:20Z after.
  const before = nextSlotForType(type(), etToUtc(2026, 10, 29, 9, 0))!;
  assert.equal(before.toISOString(), '2026-10-29T20:20:00.000Z', 'EDT: 16:20 ET = 20:20Z');

  const after = nextSlotForType(type(), etToUtc(2026, 11, 2, 9, 0))!;
  assert.equal(after.toISOString(), '2026-11-02T21:20:00.000Z', 'EST: 16:20 ET = 21:20Z');

  assert.equal(etParts(before).hour, 16);
  assert.equal(etParts(after).hour, 16);
});

test('crosses month and year boundaries', () => {
  assert.equal(etDateString(nextSlotForType(type(), etToUtc(2026, 10, 30, 18, 0))!), '2026-11-02');
  assert.equal(etDateString(nextSlotForType(type(), etToUtc(2026, 12, 31, 18, 0))!), '2027-01-01');
});

test('types with no slot or no days place by hand, not by calendar', () => {
  assert.equal(nextSlotForType(type({ default_time_et: null }), new Date()), null);
  assert.equal(nextSlotForType(type({ default_time_et: '' }), new Date()), null);
  assert.equal(nextSlotForType(type({ days_of_week: '' }), new Date()), null);
  assert.equal(nextSlotForType(type({ default_time_et: 'noon' }), new Date()), null);
});

// ─── nextOpenTime ──────────────────────────────────────────────────────────────

test('an uncontested time is returned unchanged', () => {
  const want = etToUtc(2026, 10, 1, 16, 20);
  assert.equal(nextOpenTime(want, [], 60).toISOString(), want.toISOString());
});

test('pushes past a conflicting post by the full spacing', () => {
  const existing = [post(1, etToUtc(2026, 10, 1, 16, 0).toISOString())];
  const got = nextOpenTime(etToUtc(2026, 10, 1, 16, 20), existing, 60);
  assert.equal(got.toISOString(), etToUtc(2026, 10, 1, 17, 0).toISOString());
});

test('clears a run of posts in one settle, not minute by minute', () => {
  const existing = [
    post(1, etToUtc(2026, 10, 1, 16, 0).toISOString()),
    post(2, etToUtc(2026, 10, 1, 17, 0).toISOString()),
    post(3, etToUtc(2026, 10, 1, 18, 0).toISOString()),
  ];
  const got = nextOpenTime(etToUtc(2026, 10, 1, 16, 10), existing, 60);
  assert.equal(got.toISOString(), etToUtc(2026, 10, 1, 19, 0).toISOString());
});

test('conflicts are symmetric — an earlier post is still a conflict', () => {
  const existing = [post(1, etToUtc(2026, 10, 1, 16, 50).toISOString())];
  const got = nextOpenTime(etToUtc(2026, 10, 1, 16, 20), existing, 60);
  assert.equal(got.toISOString(), etToUtc(2026, 10, 1, 17, 50).toISOString());
});

test('skipped and archived posts do not block a slot', () => {
  const existing = [
    post(1, etToUtc(2026, 10, 1, 16, 20).toISOString(), { status: 'skipped' }),
    post(2, etToUtc(2026, 10, 1, 16, 20).toISOString(), { status: 'archived' }),
  ];
  const want = etToUtc(2026, 10, 1, 16, 20);
  assert.equal(nextOpenTime(want, existing, 60).toISOString(), want.toISOString());
});

test('zero spacing disables the check', () => {
  const existing = [post(1, etToUtc(2026, 10, 1, 16, 20).toISOString())];
  const want = etToUtc(2026, 10, 1, 16, 20);
  assert.equal(nextOpenTime(want, existing, 0).toISOString(), want.toISOString());
});

// ─── findSpacingConflicts ──────────────────────────────────────────────────────

test('flags posts closer than the minimum', () => {
  const posts = [
    post(1, etToUtc(2026, 10, 1, 16, 0).toISOString()),
    post(2, etToUtc(2026, 10, 1, 16, 30).toISOString()),
  ];
  const c = findSpacingConflicts(posts, 60);
  assert.equal(c.length, 1);
  assert.deepEqual([c[0].a, c[0].b], [1, 2]);
  assert.equal(c[0].minutesApart, 30);
});

test('exactly the minimum apart is not a conflict', () => {
  const posts = [
    post(1, etToUtc(2026, 10, 1, 16, 0).toISOString()),
    post(2, etToUtc(2026, 10, 1, 17, 0).toISOString()),
  ];
  assert.deepEqual(findSpacingConflicts(posts, 60), []);
});

test('reports each adjacent clash in a cluster', () => {
  const posts = [
    post(1, etToUtc(2026, 10, 1, 16, 0).toISOString()),
    post(2, etToUtc(2026, 10, 1, 16, 10).toISOString()),
    post(3, etToUtc(2026, 10, 1, 16, 20).toISOString()),
  ];
  assert.equal(findSpacingConflicts(posts, 60).length, 2);
});

test('unscheduled and non-occupying posts are ignored', () => {
  const posts = [
    post(1, null),
    post(2, etToUtc(2026, 10, 1, 16, 0).toISOString(), { status: 'skipped' }),
    post(3, etToUtc(2026, 10, 1, 16, 5).toISOString()),
  ];
  assert.deepEqual(findSpacingConflicts(posts, 60), []);
});

test('input order does not matter', () => {
  const posts = [
    post(2, etToUtc(2026, 10, 1, 16, 30).toISOString()),
    post(1, etToUtc(2026, 10, 1, 16, 0).toISOString()),
  ];
  const c = findSpacingConflicts(posts, 60);
  assert.deepEqual([c[0].a, c[0].b], [1, 2], 'reported in time order regardless of input order');
});

// ─── findEmptySlots ────────────────────────────────────────────────────────────

test('reports a weekday slot for each active day in the window', () => {
  // From Thu Oct 1 09:00 ET, 7 days: Thu, Fri, Mon, Tue, Wed = 5 weekday slots.
  const empty = findEmptySlots([type()], [], etToUtc(2026, 10, 1, 9, 0), 7);
  assert.equal(empty.length, 5);
  assert.deepEqual(empty.map(e => e.etDate),
    ['2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06', '2026-10-07']);
});

test('a day with a post of that type is not empty', () => {
  const posts = [post(1, etToUtc(2026, 10, 2, 16, 20).toISOString())];
  const empty = findEmptySlots([type()], posts, etToUtc(2026, 10, 1, 9, 0), 7);
  assert.ok(!empty.some(e => e.etDate === '2026-10-02'));
  assert.equal(empty.length, 4);
});

test('a post moved off the slot time still fills that day', () => {
  // Moved 16:20 → 09:15. S1 is covered for the day; it should not also show as empty.
  const posts = [post(1, etToUtc(2026, 10, 2, 9, 15).toISOString())];
  const empty = findEmptySlots([type()], posts, etToUtc(2026, 10, 1, 9, 0), 7);
  assert.ok(!empty.some(e => e.etDate === '2026-10-02'));
});

test('a skipped post leaves the slot empty again', () => {
  const posts = [post(1, etToUtc(2026, 10, 2, 16, 20).toISOString(), { status: 'skipped' })];
  const empty = findEmptySlots([type()], posts, etToUtc(2026, 10, 1, 9, 0), 7);
  assert.ok(empty.some(e => e.etDate === '2026-10-02'));
});

test('past slots are not reported as empty', () => {
  // From 17:00 Thu, today's 16:20 has gone — a missed slot, not one to fill.
  const empty = findEmptySlots([type()], [], etToUtc(2026, 10, 1, 17, 0), 7);
  assert.ok(!empty.some(e => e.etDate === '2026-10-01'));
});

test('paused types and slotless types produce nothing', () => {
  assert.deepEqual(findEmptySlots([type({ active: 0 })], [], etToUtc(2026, 10, 1, 9, 0), 7), []);
  assert.deepEqual(findEmptySlots([type({ default_time_et: null })], [], etToUtc(2026, 10, 1, 9, 0), 7), []);
  assert.deepEqual(findEmptySlots([type({ days_of_week: '' })], [], etToUtc(2026, 10, 1, 9, 0), 7), []);
});

test('empty slots come back in chronological order across types', () => {
  const types = [
    type({ id: 1, code: 'S5', default_time_et: '20:00', days_of_week: '1,2,3,4,5' }),
    type({ id: 2, code: 'S1', default_time_et: '08:45', days_of_week: '1,2,3,4,5' }),
  ];
  const empty = findEmptySlots(types, [], etToUtc(2026, 10, 1, 7, 0), 2);
  const iso = empty.map(e => e.at);
  assert.deepEqual([...iso].sort(), iso, 'must already be sorted');
  assert.equal(empty[0].code, 'S1', '08:45 comes before 20:00');
});

// ─── countForTypeOnDay ─────────────────────────────────────────────────────────

test('counts only occupying posts of that type on that ET day', () => {
  const posts = [
    post(1, etToUtc(2026, 10, 1, 9, 0).toISOString()),
    post(2, etToUtc(2026, 10, 1, 14, 0).toISOString()),
    post(3, etToUtc(2026, 10, 1, 15, 0).toISOString(), { status: 'skipped' }),
    post(4, etToUtc(2026, 10, 2, 9, 0).toISOString()),
    post(5, etToUtc(2026, 10, 1, 9, 0).toISOString(), { type_id: 2 }),
  ];
  assert.equal(countForTypeOnDay(posts, 1, '2026-10-01'), 2);
  assert.equal(countForTypeOnDay(posts, 1, '2026-10-02'), 1);
});

test('counts by ET day, not UTC day', () => {
  // 23:30 ET on Oct 1 is 03:30Z on Oct 2 — it belongs to Oct 1.
  const posts = [post(1, etToUtc(2026, 10, 1, 23, 30).toISOString())];
  assert.equal(countForTypeOnDay(posts, 1, '2026-10-01'), 1);
  assert.equal(countForTypeOnDay(posts, 1, '2026-10-02'), 0);
});
