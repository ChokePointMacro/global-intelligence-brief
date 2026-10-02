import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkPost, FOLD, X_LONG_MAX } from '../src/services/ruleCheck.ts';
import type { PostType } from '../src/services/postTypes.ts';

const type = (over: Partial<PostType> = {}): PostType => ({
  id: 1, name: 'Headline A', code: 'S4', color: '#0ea5e9',
  default_time_et: '17:30', days_of_week: '0,1,2,3,4,5,6', max_per_day: 1,
  prompt_template: '', card_type: 'headline', cashtag_min: 0, cashtag_max: 0,
  hashtag_max: 1, length_mode: 'short', generation_mode: 'reuse', source_required: 1, staleness_hours: 6,
  active: 1, sort_order: 10, ...over,
});

const codes = (r: ReturnType<typeof checkPost>) => r.findings.map(f => f.code);
const errorCodes = (r: ReturnType<typeof checkPost>) => r.errors.map(f => f.code);

// ─── Baseline ──────────────────────────────────────────────────────────────────

test('a clean short post passes', () => {
  const r = checkPost('Hormuz transits slipped again overnight. Freight rates follow within a week.', { type: type() });
  assert.equal(r.ok, true, `unexpected errors: ${JSON.stringify(r.errors)}`);
});

test('an empty post fails, and reports nothing else', () => {
  const r = checkPost('   ', { type: type() });
  assert.equal(r.ok, false);
  assert.deepEqual(errorCodes(r), ['empty'], 'should not pile on other findings');
});

// ─── Links ─────────────────────────────────────────────────────────────────────

test('a URL in the body is an error', () => {
  const r = checkPost('Report here https://example.com/x', { type: type() });
  assert.ok(errorCodes(r).includes('url_in_body'));
});

test('bare-domain links are caught too', () => {
  const r = checkPost('More at reuters.com/markets today', { type: type() });
  assert.ok(errorCodes(r).includes('url_in_body'), 'twitter-text treats bare domains as links, and so does X');
});

// ─── Tags, driven by the type ──────────────────────────────────────────────────

test('CRITICAL: cashtags are rejected when the type is set to zero', () => {
  // The seeded default. If this stops failing, the no-cashtag decision has been
  // silently reversed somewhere.
  const r = checkPost('Crude bid into the close $CL', { type: type() });
  assert.ok(errorCodes(r).includes('too_many_cashtags'));
  assert.deepEqual(r.cashtags, ['CL']);
});

test('cashtags are allowed when the type permits them', () => {
  const r = checkPost('Crude bid into the close $CL', { type: type({ cashtag_max: 2 }) });
  assert.ok(!errorCodes(r).includes('too_many_cashtags'));
});

test('a type with a cashtag minimum rejects a post without one', () => {
  const r = checkPost('Crude bid into the close', { type: type({ cashtag_min: 1, cashtag_max: 3 }) });
  assert.ok(errorCodes(r).includes('too_few_cashtags'));
});

test('hashtags over the type limit are rejected', () => {
  const r = checkPost('Oil tightens #macro #oil', { type: type({ hashtag_max: 1 }) });
  assert.ok(errorCodes(r).includes('too_many_hashtags'));
  const ok = checkPost('Oil tightens #macro', { type: type({ hashtag_max: 1 }) });
  assert.ok(!errorCodes(ok).includes('too_many_hashtags'));
});

// ─── Length, using X's own weighting ───────────────────────────────────────────

test('a short-type post past the fold is rejected', () => {
  const r = checkPost('x'.repeat(FOLD + 1), { type: type() });
  assert.ok(errorCodes(r).includes('over_short_limit'));
});

test('exactly at the fold is fine', () => {
  const r = checkPost('x'.repeat(FOLD), { type: type() });
  assert.ok(!errorCodes(r).includes('over_short_limit'));
});

test('a long-type post may exceed the fold', () => {
  const r = checkPost('y'.repeat(1500) + ' Not investment advice.', { type: type({ length_mode: 'long' }) });
  assert.ok(!errorCodes(r).includes('over_short_limit'));
});

test('nothing may exceed X\'s hard ceiling', () => {
  const r = checkPost('z'.repeat(X_LONG_MAX + 10) + ' Not investment advice.', { type: type({ length_mode: 'long' }) });
  assert.ok(errorCodes(r).includes('over_hard_limit'));
});

test('length uses X\'s weighted count, so a long URL counts as 23', () => {
  // A 100-char URL would blow a naive .length check but is 23 to X.
  const url = 'https://example.com/' + 'a'.repeat(80);
  const r = checkPost(`Short note. ${url}`, { type: type() });
  assert.ok(r.weightedLength < 60, `expected URL to weigh 23, got total ${r.weightedLength}`);
});

test('a long-form type holding a tiny post warns but does not block', () => {
  const r = checkPost('Brief. Not investment advice.', { type: type({ length_mode: 'long' }) });
  assert.ok(codes(r).includes('long_type_short_post'));
  assert.ok(!errorCodes(r).includes('long_type_short_post'));
});

// ─── Finance compliance: the false-positive cases matter most ──────────────────

test('REGRESSION: ordinary market vocabulary is NOT flagged as advice', () => {
  // These are the phrases that would make Mike switch the checker off. Every one is
  // normal macro commentary and must pass clean.
  const fine = [
    'A sharp sell-off across European equities this morning.',
    'The selloff extended into the afternoon.',
    'Buyers stepped in near the lows.',
    'Sellers remain in control of the front end.',
    'Selling pressure eased after the auction.',
    'Buying interest returned to the long end.',
    'A long position was unwound into the close.',
    'Short interest sits near multi-year highs.',
    'Shorts covered aggressively.',
    'The buy-side is positioned defensively.',
    'Dip buyers have been rewarded all quarter.',
  ];
  for (const text of fine) {
    const r = checkPost(text, { type: type() });
    const advice = r.errors.filter(e => e.code.startsWith('advice_') || e.code === 'price_target');
    assert.deepEqual(advice, [], `false positive on: "${text}" → ${JSON.stringify(advice)}`);
  }
});

test('actual advice IS flagged', () => {
  const bad: Array<[string, string]> = [
    ['Buy NVDA here.',                         'advice_ticker'],
    ['Time to sell crude.',                    'advice_imperative'],
    ['You should buy this dip.',               'advice_imperative'],
    ['Sell now before the print.',             'advice_urgency'],
    ['Price target $240 by year end.',         'price_target'],
    ['PT: $240.',                              'price_target'],
    ['Load up while it is cheap.',             'advice_hype'],
    ['Guaranteed upside from here.',           'advice_hype'],
  ];
  for (const [text, code] of bad) {
    const r = checkPost(text, { type: type() });
    assert.ok(errorCodes(r).includes(code), `missed "${text}" — expected ${code}, got ${JSON.stringify(errorCodes(r))}`);
  }
});

test('long-form posts must carry the disclaimer', () => {
  const without = checkPost('y'.repeat(400), { type: type({ length_mode: 'long' }) });
  assert.ok(errorCodes(without).includes('missing_disclaimer'));

  for (const line of ['Not investment advice.', 'not financial advice', 'NFA']) {
    const r = checkPost('y'.repeat(400) + ' ' + line, { type: type({ length_mode: 'long' }) });
    assert.ok(!errorCodes(r).includes('missing_disclaimer'), `"${line}" should satisfy the disclaimer`);
  }
});

test('short posts do not need the disclaimer', () => {
  const r = checkPost('Freight rates ticked up again.', { type: type() });
  assert.ok(!errorCodes(r).includes('missing_disclaimer'));
});

// ─── Sourcing ──────────────────────────────────────────────────────────────────

test('a figure with no source is flagged', () => {
  const r = checkPost('Transits fell 12% week on week.', { type: type(), sourceCount: 0 });
  assert.ok(codes(r).includes('unsourced_number'));
});

test('a figure WITH a source attached is not flagged', () => {
  const r = checkPost('Transits fell 12% week on week.', { type: type(), sourceCount: 2 });
  assert.ok(!codes(r).includes('unsourced_number'));
});

test('unsourced figures only BLOCK once sources can be attached', () => {
  // Phase C has no UI for attaching sources, so this must warn rather than make every
  // post containing a percentage permanently unapprovable. It hardens to an error when
  // sourceCount is supplied and the type requires sources.
  const phaseC = checkPost('Down 12%.', { type: type({ source_required: 1 }) });   // sourceCount undefined
  assert.equal(phaseC.errors.some(e => e.code === 'unsourced_number'), false, 'must not block before sources exist');
  assert.ok(phaseC.warnings.some(w => w.code === 'unsourced_number'));

  const phaseD = checkPost('Down 12%.', { type: type({ source_required: 1 }), sourceCount: 0 });
  assert.ok(phaseD.errors.some(e => e.code === 'unsourced_number'), 'blocks once sources are attachable');
});

test('years and small integers are not treated as claims needing a source', () => {
  for (const text of ['Echoes of 1973 here.', 'The third round of talks collapsed.', 'Two tankers diverted.']) {
    const r = checkPost(text, { type: type(), sourceCount: 0 });
    assert.ok(!codes(r).includes('unsourced_number'), `false positive on: "${text}"`);
  }
});

test('money, percentages and units DO need a source', () => {
  for (const text of ['Freight up $1,200 a box.', 'Volumes off 8%.', 'Flows near 3.2mb/d.', 'Some 1500 containers held.']) {
    const r = checkPost(text, { type: type(), sourceCount: 0 });
    assert.ok(codes(r).includes('unsourced_number'), `missed figure in: "${text}"`);
  }
});

// ─── Media ─────────────────────────────────────────────────────────────────────

test('a missing image warns but never blocks', () => {
  const r = checkPost('Clean post.', { type: type(), hasMedia: false });
  assert.ok(r.warnings.some(w => w.code === 'no_media'));
  assert.equal(r.ok, true, 'no media support exists yet, so this cannot be a blocker');
});

// ─── Shape ─────────────────────────────────────────────────────────────────────

test('ok reflects errors only, not warnings', () => {
  const r = checkPost('Down 12%.', { type: type() });
  assert.ok(r.warnings.length > 0);
  assert.equal(r.ok, true);
});

test('with no type, it falls back to the strictest sensible defaults', () => {
  const r = checkPost('Oil bid $CL #macro #oil', {});
  assert.ok(errorCodes(r).includes('too_many_cashtags'), 'defaults to no cashtags');
  assert.ok(errorCodes(r).includes('too_many_hashtags'), 'defaults to one hashtag');
});

test('errors and warnings partition the findings', () => {
  const r = checkPost('Buy NVDA now. Down 12%. https://x.com/a', { type: type() });
  assert.equal(r.errors.length + r.warnings.length, r.findings.length);
  assert.ok(r.errors.length >= 2);
});
