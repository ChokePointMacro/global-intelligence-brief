import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_WEIGHTS, normaliseWeights, scorePost, WEIGHT_META, type SampleRow } from '../src/services/scoring.ts';

const NOW = Date.parse('2026-09-30T12:00:00Z');

const sample = (over: Partial<SampleRow> = {}): SampleRow => ({
  tweet_id: 't1',
  created_at: new Date(NOW - 3_600_000).toISOString(), // 1h old
  text: 'test',
  followers: 1000,
  likes: 100, reposts: 20, replies: 10, quotes: 5, bookmarks: 15,
  impressions: 10_000,
  ...over,
});

test('score is deterministic for a fixed now', () => {
  const a = scorePost(sample(), DEFAULT_WEIGHTS, NOW);
  const b = scorePost(sample(), DEFAULT_WEIGHTS, NOW);
  assert.equal(a.score, b.score);
});

test('rate-based dimensions are suppressed below the impressions floor', () => {
  const low = scorePost(sample({ impressions: 10 }), DEFAULT_WEIGHTS, NOW);
  assert.equal(low.contributions.engagementRate, 0);
  assert.equal(low.contributions.virality, 0);
  assert.equal(low.contributions.conversation, 0);
});

test('identical rates rank equally regardless of absolute size', () => {
  // 10x the audience and 10x the engagement is the same performance.
  const small = scorePost(sample({ impressions: 10_000, likes: 100, reposts: 20, replies: 10, quotes: 5, bookmarks: 15 }), DEFAULT_WEIGHTS, NOW);
  const large = scorePost(sample({ impressions: 100_000, likes: 1000, reposts: 200, replies: 100, quotes: 50, bookmarks: 150 }), DEFAULT_WEIGHTS, NOW);
  const diff = Math.abs(small.contributions.engagementRate - large.contributions.engagementRate);
  assert.ok(diff < 1e-9, `rate contributions should match, differed by ${diff}`);
});

test('negative reach weight demotes large accounts', () => {
  const w = { ...DEFAULT_WEIGHTS, reach: -2 };
  const big = scorePost(sample({ followers: 1_000_000 }), w, NOW).score;
  const small = scorePost(sample({ followers: 100 }), w, NOW).score;
  assert.ok(small > big, `small (${small}) should outrank big (${big}) when reach is negative`);
});

test('positive reach weight promotes large accounts', () => {
  const w = { ...DEFAULT_WEIGHTS, reach: 2 };
  const big = scorePost(sample({ followers: 1_000_000 }), w, NOW).score;
  const small = scorePost(sample({ followers: 100 }), w, NOW).score;
  assert.ok(big > small);
});

test('recency half-life halves the score at exactly one half-life', () => {
  const w = { ...DEFAULT_WEIGHTS, recencyHalfLifeHours: 24, velocity: 0 }; // velocity is age-dependent
  const fresh = scorePost(sample({ created_at: new Date(NOW - 3_600_000).toISOString() }), w, NOW);
  const aged = scorePost(sample({ created_at: new Date(NOW - 25 * 3_600_000).toISOString() }), w, NOW);
  const ratio = aged.score / fresh.score;
  assert.ok(Math.abs(ratio - 0.5) < 0.02, `expected ~0.5 decay ratio, got ${ratio}`);
});

test('zero engagement scores at or below a post with engagement', () => {
  const none = scorePost(sample({ likes: 0, reposts: 0, replies: 0, quotes: 0, bookmarks: 0 }), DEFAULT_WEIGHTS, NOW);
  const some = scorePost(sample(), DEFAULT_WEIGHTS, NOW);
  assert.ok(some.score > none.score);
});

test('contributions sum to the score', () => {
  const r = scorePost(sample(), DEFAULT_WEIGHTS, NOW);
  const sum = Object.values(r.contributions).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - r.score) < 1e-6, `contributions ${sum} should equal score ${r.score}`);
});

test('missing topic_lag_hours scores neutral, not zero', () => {
  const unknown = scorePost(sample({ topic_lag_hours: null }), DEFAULT_WEIGHTS, NOW);
  const late = scorePost(sample({ topic_lag_hours: 48 }), DEFAULT_WEIGHTS, NOW);
  assert.ok(unknown.contributions.trendHopping > late.contributions.trendHopping);
});

test('normaliseWeights clamps out-of-range values instead of trusting input', () => {
  const w = normaliseWeights({ like: 9999, reach: -9999, recencyHalfLifeHours: 0 });
  const likeMeta = WEIGHT_META.find(m => m.key === 'like')!;
  const reachMeta = WEIGHT_META.find(m => m.key === 'reach')!;
  assert.equal(w.like, likeMeta.max);
  assert.equal(w.reach, reachMeta.min);
  assert.ok(w.recencyHalfLifeHours >= 2);
});

test('normaliseWeights fills gaps from defaults so new dimensions never break saved config', () => {
  const w = normaliseWeights({ like: 2 });
  assert.equal(w.like, 2);
  assert.equal(w.virality, DEFAULT_WEIGHTS.virality);
});

test('normaliseWeights survives garbage input', () => {
  assert.deepEqual(normaliseWeights(null), DEFAULT_WEIGHTS);
  assert.deepEqual(normaliseWeights('nonsense'), DEFAULT_WEIGHTS);
  assert.equal(normaliseWeights({ like: NaN }).like, DEFAULT_WEIGHTS.like);
});
