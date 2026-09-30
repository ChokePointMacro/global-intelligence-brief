import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composePostWithTags, X_POST_CHAR_CEILING } from '../src/services/geminiService.ts';

test('tags are appended after a blank line', () => {
  assert.equal(composePostWithTags('Story.', ['#Macro'], 280), 'Story.\n\n#Macro');
});

test('no tags returns the bare post untouched', () => {
  assert.equal(composePostWithTags('Just this.', [], 280), 'Just this.');
});

test('REGRESSION: long-form posts keep their tags', () => {
  // The composer previously defaulted to a 280-char budget. On any long-form post the
  // base text alone exceeded it, so the trim loop popped every tag and returned the post
  // bare — the hashtag pass ran, cost an AI call, and produced nothing.
  const long = 'x'.repeat(1000);
  const out = composePostWithTags(long, ['#Macro', '#Chokepoints']);
  assert.ok(out.includes('#Macro'), 'first tag must survive on a 1000-char post');
  assert.ok(out.includes('#Chokepoints'), 'second tag must survive on a 1000-char post');
});

test('default budget is the Premium ceiling, not the free-tier 280', () => {
  assert.equal(X_POST_CHAR_CEILING, 25000);
  const out = composePostWithTags('y'.repeat(5000), ['#Macro']);
  assert.ok(out.includes('#Macro'));
});

test('an explicit tight budget trims tags rather than overflowing', () => {
  const post = 'z'.repeat(270);
  const out = composePostWithTags(post, ['#Macro', '#Chokepoints'], 280);
  assert.ok(out.length <= 280, `expected <=280, got ${out.length}`);
  assert.ok(out.startsWith(post), 'the post body must never be truncated to fit tags');
});

test('tags are dropped entirely rather than truncating the post', () => {
  const post = 'q'.repeat(300);
  const out = composePostWithTags(post, ['#Macro'], 280);
  assert.equal(out, post, 'post must survive intact even when it alone exceeds the budget');
});

test('whitespace around the post is normalised', () => {
  assert.equal(composePostWithTags('  Story.  ', ['#Macro'], 280), 'Story.\n\n#Macro');
});

test('empty post with tags does not produce a leading blank block', () => {
  const out = composePostWithTags('', ['#Macro'], 280);
  assert.ok(!out.startsWith('\n\n\n'));
});
