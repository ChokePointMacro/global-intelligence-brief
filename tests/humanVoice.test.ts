import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HUMAN_VOICE_RULES, HUMAN_VOICE_RULES_COMPACT,
  detectAiTells, scrubAiTells, scrubAiTellsVerbose, summariseTells,
} from '../src/services/humanVoice.ts';
import { X_POST_CRAFT_RULES } from '../src/services/geminiService.ts';
import { checkPost } from '../src/services/ruleCheck.ts';

const EM = '—';
const EN = '–';
const LQ = '“';
const RQ = '”';

const codes = (t: string) => detectAiTells(t).map(f => f.code);

// ─── The prompt blocks actually reach the generators ───────────────────────────

test('the shared X craft rules carry the compact voice rules', () => {
  // Three prompts interpolate X_POST_CRAFT_RULES (weekly, speculation, per-slot). If
  // the voice rules stop riding along, all three silently lose them.
  assert.ok(X_POST_CRAFT_RULES.includes(HUMAN_VOICE_RULES_COMPACT));
});

test('both rule blocks state the absolute dash rule', () => {
  for (const block of [HUMAN_VOICE_RULES, HUMAN_VOICE_RULES_COMPACT]) {
    assert.match(block, /em dash/i);
  }
});

// ─── Detection ─────────────────────────────────────────────────────────────────

test('catches the not-X-but-Y frame in its common forms', () => {
  assert.ok(codes('This is not just a tariff, but a signal.').includes('tell_not_x_but_y'));
  assert.ok(codes("It's not a shortage, it's a allocation decision.").includes('tell_not_x_but_y'));
  assert.ok(codes('Exports fell 12% in March.').length === 0);
});

test('catches dramatic closers, aphorisms and staged openers', () => {
  assert.ok(codes('Make no mistake. The curve inverted.').includes('tell_closer'));
  assert.ok(codes('At its core, this is a funding problem.').includes('tell_aphorism'));
  assert.ok(codes("Let's be honest about the data.").includes('tell_staged_opener'));
});

test('catches inflated significance and -ing riders', () => {
  assert.ok(codes('The ruling marks a pivotal moment for the sector.').includes('tell_inflated'));
  assert.ok(codes('Beijing capped exports, underscoring its leverage.').includes('tell_ing_rider'));
});

test('catches unnamed authority but not a named source', () => {
  assert.ok(codes('Analysts believe the cut lands in June.').includes('tell_unnamed_authority'));
  assert.ok(!codes('Goldman now expects the cut in June.').includes('tell_unnamed_authority'));
});

test('does not flag ordinary macro vocabulary', () => {
  // The checker is worthless if normal market writing trips it. These are the words
  // that a naive word-list version got wrong.
  const clean = [
    'The sell-off hit energy hardest, with WTI down 4.2% on the week.',
    'Short interest in the name rose to 11% of float.',
    'Buyers stepped in near 4,200 and the index closed up 0.8%.',
    'The Fed held the key rate at 5.25%.',
    'A robust hedge ratio kept the book flat.',
  ].join(' ');
  assert.deepEqual(codes(clean), []);
});

test('ignores tells inside URLs, code and link targets', () => {
  const t = `See https://example.com/a${EM}b and \`const x = a ${EM} b\` and [src](https://x.com/at-its-core).`;
  assert.deepEqual(codes(t), []);
});

// ─── Scrub: dashes ─────────────────────────────────────────────────────────────

test('paired dashes inside a sentence become commas', () => {
  const out = scrubAiTells(`The policy ${EM} announced without warning ${EM} hits 40,000 workers.`);
  assert.equal(out, 'The policy, announced without warning, hits 40,000 workers.');
});

test('a single dash becomes a colon, which works for both appositive and explanation', () => {
  assert.equal(
    scrubAiTells(`Beijing restricted two inputs ${EM} gallium and germanium.`),
    'Beijing restricted two inputs: gallium and germanium.',
  );
  assert.equal(
    scrubAiTells(`The policy failed ${EM} markets rallied anyway.`),
    'The policy failed: markets rallied anyway.',
  );
});

test('a sentence that already has a colon falls back to a comma or a period', () => {
  assert.equal(
    scrubAiTells(`Two inputs: gallium and germanium ${EM} both now capped.`),
    'Two inputs: gallium and germanium, both now capped.',
  );
  const long = scrubAiTells(
    `One read: supply is fine ${EM} the shortage is a pricing artefact created by two refiners.`,
  );
  assert.equal(long, 'One read: supply is fine. The shortage is a pricing artefact created by two refiners.');
});

test('en dashes and double hyphens go too', () => {
  assert.ok(!/[–—]/.test(scrubAiTells(`Output fell ${EN} sharply ${EN} in Q3.`)));
  assert.ok(!/ -- /.test(scrubAiTells('Output fell -- sharply -- in Q3.')));
});

test('dashes inside code, URLs and link targets survive the scrub', () => {
  const t = `Run \`a ${EM} b\` and open https://example.com/x${EM}y now.`;
  assert.equal(scrubAiTells(t), t);
});

test('a leading dash on a list item is not treated as a connector', () => {
  const out = scrubAiTells(`${EM} gallium\n${EM} germanium`);
  assert.equal(out, 'gallium\ngermanium');
});

// ─── Scrub: the rest ───────────────────────────────────────────────────────────

test('curly quotes become straight quotes', () => {
  assert.equal(scrubAiTells(`He said ${LQ}on track${RQ} anyway.`), 'He said "on track" anyway.');
});

test('chatbot residue is removed entirely', () => {
  const out = scrubAiTells('Here is your article:\n\nOil fell 4%.\n\nLet me know if you want a longer version.');
  assert.equal(out, 'Oil fell 4%.');
});

test('the scrub reports what it changed', () => {
  const { changed } = scrubAiTellsVerbose(`He said ${LQ}fine${RQ} ${EM} nobody agreed.`);
  assert.ok(changed.includes('curly_quotes'));
  assert.ok(changed.includes('dashes'));
});

test('clean copy is returned untouched', () => {
  const clean = 'Gallium exports fell 92% year on year. Two Western refiners carry the shortfall.';
  assert.equal(scrubAiTells(clean), clean);
  assert.deepEqual(scrubAiTellsVerbose(clean).changed, []);
});

test('the scrub removes every tell it claims to handle', () => {
  const dirty = `Here is your article:\n\nThe ruling ${EM} unexpected ${EM} lands today. He said ${LQ}fine${RQ}.`;
  const out = scrubAiTells(dirty);
  const left = codes(out);
  for (const gone of ['tell_dash', 'tell_curly_quotes', 'tell_chatbot_residue']) {
    assert.ok(!left.includes(gone), `${gone} survived the scrub: ${out}`);
  }
});

// ─── Reporting ─────────────────────────────────────────────────────────────────

test('summariseTells is null on clean text and names the errors otherwise', () => {
  assert.equal(summariseTells(detectAiTells('Oil fell 4% on the week.')), null);
  const line = summariseTells(detectAiTells('At its core, this is not just policy, but strategy.'));
  assert.match(String(line), /Voice check: \d+ AI tells?/);
});

// ─── The publish gate sees them ────────────────────────────────────────────────

test('checkPost surfaces AI tells as warnings, never as blockers', () => {
  const res = checkPost(`At its core, this is not just a tariff, but a signal ${EM} and it matters.`);
  const voice = res.findings.filter(f => f.code.startsWith('tell_'));
  assert.ok(voice.length >= 3, `expected several voice findings, got ${voice.length}`);
  assert.ok(voice.every(f => f.severity === 'warning'), 'voice findings must not block approval');
  assert.equal(res.errors.filter(e => e.code.startsWith('tell_')).length, 0);
});

test('a clean post raises no voice warnings', () => {
  const res = checkPost('Gallium exports fell 92% year on year. Two Western refiners carry the shortfall.');
  assert.deepEqual(res.findings.filter(f => f.code.startsWith('tell_')), []);
});

// ─── Ranges and compounds are not connectors ──────────────────────────────────

test('REGRESSION: a numeric range keeps its range, it does not become a colon', () => {
  // Found by running the detector over 22 stored reports: the en dash in the Fed's
  // target band was the most common dash in the corpus, and the first version of the
  // scrub turned "3.5%-3.75%" into "3.5%: 3.75%".
  assert.equal(
    scrubAiTells(`The Fed held rates in the 3.5%${EN}3.75% range.`),
    'The Fed held rates in the 3.5%-3.75% range.',
  );
  assert.equal(scrubAiTells(`March 18${EN}20, 2026`), 'March 18-20, 2026');
  assert.equal(scrubAiTells(`guidance of $1.2bn${EN}$1.5bn`), 'guidance of $1.2bn-$1.5bn');
  assert.equal(scrubAiTells(`Q3${EN}Q4 shipments`), 'Q3-Q4 shipments');
});

test('REGRESSION: a compound of two proper nouns keeps its hyphen', () => {
  assert.equal(scrubAiTells(`US${EN}China talks resume.`), 'US-China talks resume.');
  assert.equal(scrubAiTells(`The Israel${EM}Iran corridor stayed open.`), 'The Israel-Iran corridor stayed open.');
});

test('ranges and compounds are not reported as dash tells', () => {
  assert.deepEqual(codes(`The 3.5%${EN}3.75% band held through the US${EN}China talks.`), []);
});

test('a spaced dash next to a number is still a connector', () => {
  // The range rule must not swallow an ordinary connector that happens to sit near
  // a figure: this one is prose, not a band.
  assert.equal(
    scrubAiTells(`Output fell 12% ${EM} the steepest drop since 2020.`),
    'Output fell 12%: the steepest drop since 2020.',
  );
});
