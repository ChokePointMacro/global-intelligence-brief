import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  etParts,
  etToUtc,
  etTimeString,
  etMinutesOfDay,
  etDateString,
  parseHhMm,
  nextEtWeekdayMidnight,
  normaliseScheduledAt,
} from '../src/services/time.ts';

// ─── Offset correctness across DST ─────────────────────────────────────────────

test('EDT: summer wall clock resolves at UTC-4', () => {
  // 2026-07-01 08:45 ET is EDT → 12:45 UTC
  assert.equal(etToUtc(2026, 7, 1, 8, 45).toISOString(), '2026-07-01T12:45:00.000Z');
});

test('EST: winter wall clock resolves at UTC-5', () => {
  // 2026-01-15 08:45 ET is EST → 13:45 UTC
  assert.equal(etToUtc(2026, 1, 15, 8, 45).toISOString(), '2026-01-15T13:45:00.000Z');
});

test('REGRESSION: October is EDT, not the hardcoded UTC-5', () => {
  // The old code did `now - 5h` and called it EST year-round. On 2026-10-01 Eastern is
  // still EDT (UTC-4), so every slot computed with a fixed -5 landed an hour late.
  const utc = etToUtc(2026, 10, 1, 8, 45);
  assert.equal(utc.toISOString(), '2026-10-01T12:45:00.000Z');
  assert.notEqual(utc.toISOString(), '2026-10-01T13:45:00.000Z', 'UTC-5 would be wrong here');
});

test('the Nov 1 2026 transition flips the offset', () => {
  // The plan calls this date out: ET leaves DST on Sun Nov 1 2026 at 2am.
  // 8:45am ET on Oct 31 is EDT (UTC-4); the same wall clock on Nov 2 is EST (UTC-5).
  assert.equal(etToUtc(2026, 10, 31, 8, 45).toISOString(), '2026-10-31T12:45:00.000Z');
  assert.equal(etToUtc(2026, 11, 2, 8, 45).toISOString(), '2026-11-02T13:45:00.000Z');
});

test('round-trips an instant through parts and back', () => {
  for (const iso of [
    '2026-03-20T14:00:00.000Z',
    '2026-07-04T23:30:00.000Z',
    '2026-11-15T05:05:00.000Z',
    '2026-12-31T23:59:00.000Z',
  ]) {
    const p = etParts(new Date(iso));
    const back = etToUtc(p.year, p.month, p.day, p.hour, p.minute, p.second);
    assert.equal(back.toISOString(), iso, `round-trip failed for ${iso}`);
  }
});

test('spring-forward: 2am does not exist and rolls forward, it does not vanish', () => {
  // 2026-03-08 02:30 ET is skipped by the clock change. The slot must still resolve
  // to a real instant rather than NaN or silently landing a day away.
  const d = etToUtc(2026, 3, 8, 2, 30);
  assert.ok(!Number.isNaN(d.getTime()), 'must resolve to a real instant');
  const p = etParts(d);
  assert.equal(p.day, 8);
  assert.equal(p.hour, 3, 'skipped 2:30am resolves into the 3am hour');
});

test('fall-back: the repeated 1am hour resolves to the earlier instant', () => {
  // 2026-11-01 01:30 ET happens twice. Picking the first keeps slots monotonic.
  const d = etToUtc(2026, 11, 1, 1, 30);
  assert.equal(d.toISOString(), '2026-11-01T05:30:00.000Z');
});

test('midnight normalises to hour 0, never hour 24', () => {
  const p = etParts(etToUtc(2026, 6, 15, 0, 0));
  assert.equal(p.hour, 0);
  assert.equal(p.day, 15);
});

// ─── Formatting helpers ────────────────────────────────────────────────────────

test('etTimeString and etMinutesOfDay agree', () => {
  const d = etToUtc(2026, 9, 10, 16, 20);
  assert.equal(etTimeString(d), '16:20');
  assert.equal(etMinutesOfDay(d), 16 * 60 + 20);
});

test('etDateString reports the ET calendar day, not the UTC one', () => {
  // 03:30 UTC on Oct 2 is still 23:30 ET on Oct 1 — the UTC date is a day ahead.
  const d = new Date('2026-10-02T03:30:00.000Z');
  assert.equal(etDateString(d), '2026-10-01');
});

test('parseHhMm accepts valid times and rejects junk', () => {
  assert.equal(parseHhMm('06:00'), 360);
  assert.equal(parseHhMm('6:00'), 360);
  assert.equal(parseHhMm('16:20'), 980);
  assert.equal(parseHhMm('23:59'), 1439);
  assert.equal(parseHhMm('24:00'), null);
  assert.equal(parseHhMm('12:60'), null);
  assert.equal(parseHhMm('noon'), null);
  assert.equal(parseHhMm(''), null);
});

// ─── Weekday scheduling ────────────────────────────────────────────────────────

test('nextEtWeekdayMidnight lands on the right weekday at ET midnight', () => {
  // 2026-10-01 is a Thursday (weekday 4).
  const from = etToUtc(2026, 10, 1, 12, 0);
  const friday = nextEtWeekdayMidnight(5, from);
  const p = etParts(friday);
  assert.equal(p.weekday, 5, 'must be a Friday');
  assert.equal(p.hour, 0, 'must be ET midnight');
  assert.equal(p.minute, 0);
  assert.equal(etDateString(friday), '2026-10-02');
});

test('asking for today returns next week, not the past', () => {
  const from = etToUtc(2026, 10, 1, 12, 0); // Thursday
  const nextThursday = nextEtWeekdayMidnight(4, from);
  assert.equal(etDateString(nextThursday), '2026-10-08');
  assert.ok(nextThursday.getTime() > from.getTime(), 'must be in the future');
});

test('crossing the DST boundary still yields ET midnight', () => {
  // From Thu Oct 29 2026, the next Monday is Nov 2 — after the Nov 1 change.
  const from = etToUtc(2026, 10, 29, 12, 0);
  const monday = nextEtWeekdayMidnight(1, from);
  assert.equal(etDateString(monday), '2026-11-02');
  const p = etParts(monday);
  assert.equal(p.hour, 0, 'still midnight ET on the far side of the transition');
  assert.equal(monday.toISOString(), '2026-11-02T05:00:00.000Z', 'EST → midnight is 05:00 UTC');
});

test('crossing a month boundary advances the calendar correctly', () => {
  const from = etToUtc(2026, 12, 30, 12, 0); // Wednesday
  const friday = nextEtWeekdayMidnight(5, from);
  assert.equal(etDateString(friday), '2027-01-01');
});

// ─── normaliseScheduledAt: the early-posting bug ───────────────────────────────

test('REGRESSION: space-separated datetime no longer sorts below an ISO string', () => {
  // The bug: SQLite compares DATETIME as text, and ' ' (0x20) < 'T' (0x54), so
  // '2026-10-01 23:59' <= '2026-10-01T00:00:00.000Z' was TRUE — a post scheduled for
  // late tonight was treated as due at UTC midnight and went out ~18 hours early.
  const raw = '2026-10-01 23:59';
  const nowIso = '2026-10-01T00:00:00.000Z';
  assert.ok(raw <= nowIso, 'precondition: the raw form really does mis-sort');

  const normalised = normaliseScheduledAt(raw)!;
  assert.ok(normalised > nowIso, 'normalised form must sort AFTER the current instant');
  assert.equal(normalised, '2026-10-02T03:59:00.000Z', '23:59 EDT is 03:59 UTC next day');
});

test('zone-less input is interpreted as Eastern wall clock', () => {
  assert.equal(normaliseScheduledAt('2026-07-01 08:45'), '2026-07-01T12:45:00.000Z');
  assert.equal(normaliseScheduledAt('2026-01-15T08:45'), '2026-01-15T13:45:00.000Z');
  assert.equal(normaliseScheduledAt('2026-07-01 08:45:30'), '2026-07-01T12:45:30.000Z');
});

test('a single-digit hour is accepted', () => {
  assert.equal(normaliseScheduledAt('2026-07-01 8:45'), '2026-07-01T12:45:00.000Z');
});

test('input that already carries a zone is preserved, not re-shifted', () => {
  assert.equal(normaliseScheduledAt('2026-07-01T12:45:00.000Z'), '2026-07-01T12:45:00.000Z');
  assert.equal(normaliseScheduledAt('2026-07-01T08:45:00-04:00'), '2026-07-01T12:45:00.000Z');
  assert.equal(normaliseScheduledAt('2026-07-01T08:45:00-0400'), '2026-07-01T12:45:00.000Z');
});

test('date-only input becomes ET midnight', () => {
  assert.equal(normaliseScheduledAt('2026-07-01'), '2026-07-01T04:00:00.000Z');
});

test('Date objects are accepted', () => {
  const d = new Date('2026-07-01T12:45:00.000Z');
  assert.equal(normaliseScheduledAt(d), '2026-07-01T12:45:00.000Z');
});

test('unparseable input returns null so callers can reject it', () => {
  for (const bad of ['', '   ', 'tomorrow', 'next friday', '01/10/2026', null, undefined, 42, {}, new Date('nope')]) {
    assert.equal(normaliseScheduledAt(bad as any), null, `should reject ${JSON.stringify(bad)}`);
  }
});

test('every normalised value is directly text-comparable', () => {
  // The whole point: one canonical format means SQLite text comparison is chronological.
  const inputs = [
    '2026-01-15 08:45',
    '2026-07-01T08:45:00-04:00',
    '2026-10-01 23:59',
    '2026-11-02 08:45',
    '2026-12-31T23:59:00.000Z',
  ];
  const normalised = inputs.map(i => normaliseScheduledAt(i)!);
  for (const n of normalised) {
    assert.match(n, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  }
  const byText = [...normalised].sort();
  const byTime = [...normalised].sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
  assert.deepEqual(byText, byTime, 'text order must equal chronological order');
});
