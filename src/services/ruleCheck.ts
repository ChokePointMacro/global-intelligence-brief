/**
 * The rule checker — plain code that runs over a finished draft before it can be
 * approved.
 *
 * Deliberately NOT an LLM call. These are the rules that must hold every time, and a
 * model asked "does this post follow the rules?" will be wrong occasionally and
 * confidently. Everything here is a regex or a count.
 *
 * Severity matters:
 *   error   — blocks approval. The publisher will not send a post with one.
 *   warning — shown, does not block. Mike decides.
 *
 * Most limits come from the post's TYPE (cashtag_min/max, hashtag_max, length_mode),
 * so changing a rule is a settings change on the Post Types screen, not a code change.
 */
// twitter-text is CommonJS and exposes no named ESM exports, so it has to come in as
// a default import and be destructured. This is X's own counting library: a URL weighs
// 23 characters regardless of its real length, and CJK characters weigh 2 — neither of
// which a plain `.length` gets right.
import twitterText from 'twitter-text';
import type { PostType } from './postTypes.ts';

const { parseTweet, extractHashtags, extractCashtags, extractUrls } = twitterText;

export type Severity = 'error' | 'warning';

export interface RuleFinding {
  /** Stable machine-readable code, for UI grouping and tests. */
  code: string;
  severity: Severity;
  message: string;
}

export interface RuleCheckResult {
  ok: boolean;              // no errors (warnings may still be present)
  findings: RuleFinding[];
  errors: RuleFinding[];
  warnings: RuleFinding[];
  /** X's own weighted count — URLs count as 23 regardless of their real length. */
  weightedLength: number;
  hashtags: string[];
  cashtags: string[];
  urls: string[];
}

/** X Premium's long-form ceiling. */
export const X_LONG_MAX = 25000;
/** The fold: X truncates behind "Show more" at ~280, Premium included. */
export const FOLD = 280;

/**
 * Advice-shaped language, which Armed Capital must not publish.
 *
 * The hard part is NOT matching ordinary market commentary. "Sell-off", "buyers",
 * "selling pressure" and "a long position unwound" are all normal macro vocabulary; a
 * checker that flags them gets switched off within a day and then catches nothing.
 * So these match imperative or advisory constructions specifically, not the words.
 */
const ADVICE_PATTERNS: Array<{ re: RegExp; code: string; message: string }> = [
  {
    // The verb is case-insensitive but the TICKER must be uppercase, so this cannot be
    // written with a /i flag — that would let [A-Z] match lowercase and turn "short
    // interest" or "sell into" into false positives. Hence the explicit casing.
    // The required space after the verb is what keeps "sell-off", "buyers" and
    // "Shorts covered" clean: none of them has a space in that position.
    re: /\b(?:[Bb]uy|[Ss]ell|[Ss]hort|[Aa]ccumulate|[Dd]ump)\s+(?:the\s+)?\$?[A-Z]{1,5}\b/,
    code: 'advice_ticker',
    message: 'Reads as a direct instruction to trade a specific ticker.',
  },
  {
    re: /\b(?:should|must|need to|ought to|time to|got to|gotta)\s+(?:buy|sell|short|accumulate)\b/i,
    code: 'advice_imperative',
    message: 'Reads as advice to act ("should buy", "time to sell").',
  },
  {
    re: /\b(?:buy|sell|short)\s+(?:now|here|today|immediately|this dip)\b/i,
    code: 'advice_urgency',
    message: 'Reads as a timed call to action ("buy now", "sell here").',
  },
  {
    re: /\bprice\s+targets?\b|\bPT:?\s*\$?\d|\btargets?\s+\$\s?\d/i,
    code: 'price_target',
    message: 'Contains a price target. The brand does not publish targets.',
  },
  {
    re: /\b(?:load up|all in|back up the truck|free money|can'?t lose|guaranteed)\b/i,
    code: 'advice_hype',
    message: 'Hype phrasing that reads as a recommendation.',
  },
];

/** Phrases that satisfy the disclaimer requirement on long-form posts. */
const DISCLAIMER = /not (?:investment|financial) advice|nfa\b/i;

/**
 * A number that would need sourcing: a percentage, a money figure, a multi-digit
 * quantity, or a unit like "3.2mb/d". Deliberately ignores years (1900-2099), ordinary
 * small integers, and times, which are not the kind of claim that needs a citation.
 */
const SOURCEABLE_NUMBER =
  /(?<![\w.])(?:\$\s?\d[\d,.]*|\d[\d,.]*\s?%|\d[\d,.]*\s?(?:bn|bbl|mb\/d|kt|mt|tn|k|m|b)\b|\d{3,})(?![\w%])/i;

const YEAR_ONLY = /^(?:19|20)\d{2}$/;

function hasSourceableNumber(text: string): boolean {
  const matches = text.match(new RegExp(SOURCEABLE_NUMBER, 'gi')) ?? [];
  return matches.some(m => {
    const bare = m.replace(/[^\d]/g, '');
    // A bare four-digit year on its own is not a claim needing a source.
    if (YEAR_ONLY.test(bare) && !/[$%]/.test(m)) return false;
    return true;
  });
}

export interface CheckContext {
  /** The post's type, which carries the configurable limits. */
  type?: Pick<PostType, 'cashtag_min' | 'cashtag_max' | 'hashtag_max' | 'length_mode' | 'source_required' | 'code'> | null;
  /** How many sources are attached (post_sources). */
  sourceCount?: number;
  /** Whether an image is attached (post_media). */
  hasMedia?: boolean;
}

export function checkPost(body: string, ctx: CheckContext = {}): RuleCheckResult {
  const text = String(body ?? '');
  const findings: RuleFinding[] = [];
  const add = (severity: Severity, code: string, message: string) => findings.push({ code, severity, message });

  const parsed = parseTweet(text);
  const hashtags = extractHashtags(text);
  const cashtags = extractCashtags(text);
  const urls = extractUrls(text);

  const type = ctx.type ?? null;
  const isLong = type?.length_mode === 'long';
  const cashMax = type?.cashtag_max ?? 0;
  const cashMin = type?.cashtag_min ?? 0;
  const hashMax = type?.hashtag_max ?? 1;

  // ── Content presence ──
  if (!text.trim()) {
    add('error', 'empty', 'The post is empty.');
    // Everything below is meaningless on an empty body.
    return summarise(findings, parsed.weightedLength, hashtags, cashtags, urls);
  }

  // ── Links ──
  // A URL in the body costs 30-50% of reach and is billed at 13x. The source belongs in
  // a reply, which is what POST_SOURCE_AS_REPLY does.
  if (urls.length) {
    add('error', 'url_in_body',
      `Contains ${urls.length === 1 ? 'a link' : `${urls.length} links`} (${urls.join(', ')}). Links cut reach 30-50% — put the source in a reply instead.`);
  }

  // ── Tags ──
  if (hashtags.length > hashMax) {
    add('error', 'too_many_hashtags',
      `${hashtags.length} hashtags; this type allows ${hashMax}. Measured: 3+ tags costs about 17% engagement.`);
  }
  if (cashtags.length > cashMax) {
    add('error', 'too_many_cashtags',
      cashMax === 0
        ? `Contains ${cashtags.length} cashtag${cashtags.length === 1 ? '' : 's'} ($${cashtags.join(', $')}). This type is set to no cashtags.`
        : `${cashtags.length} cashtags; this type allows ${cashMax}.`);
  }
  if (cashtags.length < cashMin) {
    add('error', 'too_few_cashtags', `This type requires at least ${cashMin} cashtag${cashMin === 1 ? '' : 's'}; found ${cashtags.length}.`);
  }

  // ── Length ──
  if (parsed.weightedLength > X_LONG_MAX) {
    add('error', 'over_hard_limit', `${parsed.weightedLength} characters exceeds X's ${X_LONG_MAX} ceiling. X will reject it.`);
  } else if (!isLong && parsed.weightedLength > FOLD) {
    add('error', 'over_short_limit',
      `${parsed.weightedLength} characters; this type is set to ${FOLD}. Switch it to a long post, or cut it.`);
  } else if (isLong && parsed.weightedLength <= FOLD) {
    add('warning', 'long_type_short_post',
      `This type is set to long-form but the post is only ${parsed.weightedLength} characters.`);
  }

  // ── Finance compliance ──
  for (const p of ADVICE_PATTERNS) {
    if (p.re.test(text)) add('error', p.code, p.message);
  }
  if (isLong && !DISCLAIMER.test(text)) {
    add('error', 'missing_disclaimer', 'Long-form posts must carry the "Not investment advice" line.');
  }

  // ── Sourcing ──
  // The spec says a post with an unsourced number should be REJECTED. That becomes an
  // error once sources can actually be attached (post_sources, Phase D) — until then it
  // would make every post containing a percentage permanently unapprovable, so it warns.
  if (hasSourceableNumber(text) && !(ctx.sourceCount ?? 0)) {
    add(
      (ctx.sourceCount === undefined ? 'warning' : type?.source_required ? 'error' : 'warning'),
      'unsourced_number',
      'Contains a figure with no source attached.',
    );
  }

  // Same reasoning: no media support exists yet, so this cannot be a blocker.
  if (ctx.hasMedia === false) {
    add('warning', 'no_media', 'No image attached. Every post is meant to carry one.');
  }

  return summarise(findings, parsed.weightedLength, hashtags, cashtags, urls);
}

function summarise(
  findings: RuleFinding[], weightedLength: number,
  hashtags: string[], cashtags: string[], urls: string[],
): RuleCheckResult {
  const errors = findings.filter(f => f.severity === 'error');
  const warnings = findings.filter(f => f.severity === 'warning');
  return { ok: errors.length === 0, findings, errors, warnings, weightedLength, hashtags, cashtags, urls };
}
