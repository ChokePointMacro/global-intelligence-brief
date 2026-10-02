import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SEED_POST_TYPES, validatePostType, describeDays, CARD_TYPES,
} from '../src/services/postTypes.ts';
import { parseHhMm } from '../src/services/time.ts';

// ─── The seeded types ──────────────────────────────────────────────────────────

test('ships the nine types from the build plan', () => {
  assert.equal(SEED_POST_TYPES.length, 9);
  const codes = SEED_POST_TYPES.map(t => t.code);
  assert.deepEqual(codes, ['S1', 'S2', 'S3', 'S4', 'S5', 'FRI', 'SUN', 'LINK', 'MAN']);
});

test('CRITICAL: every seeded type ships with cashtags OFF', () => {
  // The build plan specifies 1-3 cashtags on several types; Mike's standing instruction
  // is "no cashtags, ever". Resolved by seeding 0/0 and leaving the limits editable.
  // If this test fails, a seed edit has silently reversed that decision.
  for (const t of SEED_POST_TYPES) {
    assert.equal(t.cashtag_min, 0, `${t.code} cashtag_min must be 0`);
    assert.equal(t.cashtag_max, 0, `${t.code} cashtag_max must be 0`);
  }
});

test('no seeded type exceeds the 2-hashtag engagement cliff', () => {
  // Measured: 1-2 tags ~ +21% engagement, 3+ ~ -17%.
  for (const t of SEED_POST_TYPES) {
    assert.ok(t.hashtag_max <= 2, `${t.code} hashtag_max ${t.hashtag_max} exceeds 2`);
  }
});

test('short codes are unique', () => {
  const codes = SEED_POST_TYPES.map(t => t.code);
  assert.equal(new Set(codes).size, codes.length);
});

test('every seeded slot time is a parseable ET wall clock, or deliberately null', () => {
  for (const t of SEED_POST_TYPES) {
    if (t.default_time_et === null) {
      // Only the two types that have no slot of their own.
      assert.ok(['LINK', 'MAN'].includes(t.code), `${t.code} should not have a null slot`);
    } else {
      assert.notEqual(parseHhMm(t.default_time_et), null, `${t.code} slot "${t.default_time_et}" is unparseable`);
    }
  }
});

test('seeded slot times match the build plan', () => {
  const bySlot = Object.fromEntries(SEED_POST_TYPES.map(t => [t.code, t.default_time_et]));
  assert.equal(bySlot.S1, '08:45');
  assert.equal(bySlot.S3, '16:20');
  assert.equal(bySlot.S4, '17:30');
  assert.equal(bySlot.S5, '20:00');
  assert.equal(bySlot.SUN, '18:00');
});

test('every seeded type passes its own validator', () => {
  for (const t of SEED_POST_TYPES) {
    const { ok, errors } = validatePostType(t);
    assert.ok(ok, `${t.code} failed validation: ${errors.join(' ')}`);
  }
});

test('every seeded card type is a known value', () => {
  const known = new Set(CARD_TYPES.map(c => c.value));
  for (const t of SEED_POST_TYPES) {
    assert.ok(known.has(t.card_type), `${t.code} has unknown card type ${t.card_type}`);
  }
});

test('the long-form types are the ones the plan says', () => {
  const long = SEED_POST_TYPES.filter(t => t.length_mode === 'long').map(t => t.code);
  assert.deepEqual(long.sort(), ['S3', 'SUN']);
});

// ─── Validation ────────────────────────────────────────────────────────────────

test('accepts a minimal valid type', () => {
  assert.ok(validatePostType({ name: 'Test', code: 'TST' }).ok);
});

test('requires a name and a code', () => {
  assert.ok(validatePostType({ code: 'TST' }).errors.some(e => /Name is required/.test(e)));
  assert.ok(validatePostType({ name: 'Test' }).errors.some(e => /Short code is required/.test(e)));
});

test('rejects a malformed short code', () => {
  for (const code of ['has space', 'TOOLONGCODE', 'a-b', '$$']) {
    const { ok } = validatePostType({ name: 'Test', code });
    assert.equal(ok, false, `"${code}" should be rejected`);
  }
});

test('rejects a non-hex colour', () => {
  assert.equal(validatePostType({ name: 'T', code: 'T', color: 'orange' }).ok, false);
  assert.equal(validatePostType({ name: 'T', code: 'T', color: '#f7931a' }).ok, true);
});

test('rejects an unparseable slot but allows a blank one', () => {
  assert.equal(validatePostType({ name: 'T', code: 'T', default_time_et: '25:00' }).ok, false);
  assert.equal(validatePostType({ name: 'T', code: 'T', default_time_et: 'morning' }).ok, false);
  // null and '' both mean "no fixed slot" — Manual and the link reply rely on this.
  assert.equal(validatePostType({ name: 'T', code: 'T', default_time_et: null }).ok, true);
  assert.equal(validatePostType({ name: 'T', code: 'T', default_time_et: '' }).ok, true);
  assert.equal(validatePostType({ name: 'T', code: 'T', default_time_et: '16:20' }).ok, true);
});

test('rejects malformed day lists', () => {
  assert.equal(validatePostType({ name: 'T', code: 'T', days_of_week: '1,2,7' }).ok, false);
  assert.equal(validatePostType({ name: 'T', code: 'T', days_of_week: 'Mon' }).ok, false);
  assert.equal(validatePostType({ name: 'T', code: 'T', days_of_week: '1,2,3,4,5' }).ok, true);
  assert.equal(validatePostType({ name: 'T', code: 'T', days_of_week: '' }).ok, true);
});

test('rejects a cashtag minimum above its maximum', () => {
  const { ok, errors } = validatePostType({ name: 'T', code: 'T', cashtag_min: 3, cashtag_max: 1 });
  assert.equal(ok, false);
  assert.ok(errors.some(e => /cannot exceed/.test(e)));
});

test('rejects more than 2 hashtags', () => {
  assert.equal(validatePostType({ name: 'T', code: 'T', hashtag_max: 3 }).ok, false);
  assert.equal(validatePostType({ name: 'T', code: 'T', hashtag_max: 2 }).ok, true);
});

test('rejects an unknown card type or length mode', () => {
  assert.equal(validatePostType({ name: 'T', code: 'T', card_type: 'hologram' as any }).ok, false);
  assert.equal(validatePostType({ name: 'T', code: 'T', length_mode: 'medium' as any }).ok, false);
});

test('reports every problem at once, not just the first', () => {
  const { errors } = validatePostType({ name: '', code: '!!', hashtag_max: 9, days_of_week: 'xyz' });
  assert.ok(errors.length >= 4, `expected several errors, got: ${JSON.stringify(errors)}`);
});

// ─── Day formatting ────────────────────────────────────────────────────────────

test('describeDays collapses a contiguous run into a range', () => {
  assert.equal(describeDays('1,2,3,4,5'), 'Mon–Fri');
  assert.equal(describeDays('0,1,2,3,4,5,6'), 'Every day');
});

test('describeDays lists non-contiguous days', () => {
  assert.equal(describeDays('0,6'), 'Sun, Sat');
  assert.equal(describeDays('1,5'), 'Mon, Fri');
});

test('describeDays handles the empty and single cases', () => {
  assert.equal(describeDays(''), 'Never');
  assert.equal(describeDays('5'), 'Fri');
});

test('describeDays tolerates unsorted and duplicated input', () => {
  assert.equal(describeDays('5,1,3,2,4'), 'Mon–Fri');
  assert.equal(describeDays('1,1,2,3,4,5'), 'Mon–Fri');
});
