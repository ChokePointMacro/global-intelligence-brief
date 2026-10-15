/**
 * House voice — the anti-AI-tell layer applied to every piece of prose this app
 * generates (Substack article, headline summaries, X posts, Instagram captions).
 *
 * Two halves, deliberately:
 *
 *   1. HUMAN_VOICE_RULES / HUMAN_VOICE_RULES_COMPACT — prompt text. This is the
 *      primary defence. A model told firmly "no em dashes, no not-X-but-Y" mostly
 *      complies, and complying at generation time produces better sentences than
 *      any rewrite can.
 *   2. scrubAiTells() / detectAiTells() — plain code over the finished draft, in
 *      the same spirit as ruleCheck.ts. No LLM call. The scrubber only fixes what
 *      can be fixed mechanically without guessing at meaning; the detector reports
 *      everything else so it reaches the UI instead of the published post.
 *
 * The rules come from the `humanizer` skill (v3.1.0), itself drawn from Wikipedia's
 * "Signs of AI writing". Kept here as ONE copy for the same reason X_POST_CRAFT_RULES
 * is one copy: two divergent sets would mean the article and the posts are written to
 * different standards.
 *
 * Kill switch: HUMANIZE_OUTPUT=off disables the scrub pass (detection still runs).
 */

export const SCRUB_ENABLED = process.env.HUMANIZE_OUTPUT !== 'off';

// ─── Prompt blocks ─────────────────────────────────────────────────────────────

/**
 * Full rules, for long-form prose: the Substack article, headline summaries, the
 * overall analysis. Ordered strongest tell first, which is also the order a first
 * draft produces them in.
 */
export const HUMAN_VOICE_RULES = `VOICE — write like an analyst, not a language model. These rules override any habit
of phrasing. A draft that breaks them is rejected even when the analysis is right.

1. NEVER use the not-X-but-Y frame. Banned in every form: "not just X but Y", "not
   merely X, it's Y", and the split version across two sentences ("This doesn't mean
   X. It means Y."). The negative half names a claim nobody made. State the point.
2. NO one-line closers or dramatic fragments. Do not end a section with a short
   sentence that restates it ("That distinction matters.", "Make no mistake.", "The
   message was clear."). Do not stack fragments for rhythm ("No warning. No buffer.
   No exit."). End on the last concrete fact.
3. NO aphorisms or hidden-truth framing: "the real question is", "at its core", "what
   really matters", "the heart of the matter", "X is the Y of Z", "the architecture
   of", "the currency of". Make the specific claim instead.
4. NO staged run-up: "Let's dive in", "Here's what you need to know", "Here's the
   thing", "Let's be honest", "The thing is". Open on the substance.
5. NO arguing with nobody: "I'm not saying", "To be clear", "Don't get me wrong",
   "Some might say", "A tempting approach would be", "You might think". Delete the
   defence; if it holds a real claim, state the claim.
6. NO forced triads. Three items only when there are genuinely three distinct things.
   Do not reach for a third example, a third adjective, or a third parallel clause to
   sound complete.
7. NO em dashes or en dashes anywhere, and no double hyphen used as a dash. Use a
   period, comma, colon or parentheses. This rule is absolute and is checked in code.
8. NO stacked hedges: "could potentially", "it may arguably", "it's also possible
   that". One qualifier when the evidence is genuinely uncertain, then stop.
9. AVOID these words, which models use far more than people do: delve, deep dive,
   tapestry, testament, underscore, showcase, pivotal, intricate, meticulous,
   interplay, garner, bolster, vibrant, enduring, landscape (figurative), realm,
   pave the way, usher in, navigate (figurative).
10. NO inflated significance: "marks a pivotal moment", "stands as a testament",
    "plays a key role", "underscores the importance of", "reflects a broader",
    "setting the stage for", "signals a new era". Report the fact and its measurable
    consequence. Do not tell the reader it is historic.
11. NO -ing riders bolted onto a fact to deepen it: ", highlighting the...",
    ", underscoring the...", ", reflecting the...", ", signalling...". If the
    consequence is real, write it as its own clause with a named mechanism.
12. NO unnamed authority: "experts argue", "observers note", "analysts believe",
    "some critics", "industry reports suggest". Name the bank, agency, institution
    or person, or drop the claim.
13. USE is / are / has. Not "serves as", "stands as", "functions as", "represents a",
    "boasts", "features".
14. NO sales language: "groundbreaking", "renowned", "stunning", "a rich array",
    "in the heart of". No send-offs: "the future looks bright", "watch this space",
    "exciting times ahead".
15. NO chatbot residue of any kind: no "Here is your article", no "I hope this helps",
    no "Let me know if", no "Would you like me to", no closing offer. The text must
    stand alone as published copy.
16. NO knowledge-limit talk and no filling a gap with a guess: "as of my last update",
    "while specific details are limited", "it is believed that". If the live feed does
    not support it, leave it out.
17. Bold is for a term the reader must carry forward, not decoration. No bulleted list
    where every item is "**Label:** sentence". Headings in sentence case. No emoji and
    no arrows as decoration. Straight quotes only, never curly.
18. Vary sentence length. Real analysis alternates a short declarative with a longer
    causal sentence. Uniform medium-length sentences are the clearest tell of all.

Removing the tells is half the job. The result must still read as a person with a view,
writing for someone who already follows markets.`;

/**
 * Compact version, for X posts and captions where the prompt already carries the
 * craft rules and every token competes with the story. Same rules, strongest only.
 */
export const HUMAN_VOICE_RULES_COMPACT = `  VOICE — no AI tells. Hard rules:
  * NO em dashes, en dashes or double hyphens. Period, comma, colon or parentheses.
  * NO not-X-but-Y ("not just X, but Y", "it's not X, it's Y"), in any form.
  * NO one-line closer restating the post ("That distinction matters.", "Make no
    mistake."). No stacked fragments for rhythm. End on the last concrete fact.
  * NO staged opener ("Here's the thing", "Let's be clear", "Honestly").
  * NO aphorisms ("the real question is", "at its core", "X is the Y of Z").
  * NO inflated significance ("pivotal", "marks a turning point", "underscores",
    "signals a new era", "testament", "landscape", "showcase", "delve").
  * NO -ing riders (", highlighting the...", ", underscoring...", ", reflecting...").
  * NO unnamed authority ("experts say", "analysts believe"). Name the source.
  * Use is/are/has, not "serves as" or "represents a".
  * Straight quotes only, never curly. No emoji.
  * Vary sentence length. Uniform medium sentences read as machine-written.`;

// ─── Detection ─────────────────────────────────────────────────────────────────

export type VoiceSeverity = 'error' | 'warning';

export interface VoiceFinding {
  code: string;
  severity: VoiceSeverity;
  message: string;
  /** Up to three literal matches from the text, so the UI can show what tripped it. */
  samples: string[];
}

interface TellPattern {
  code: string;
  severity: VoiceSeverity;
  re: RegExp;
  message: string;
}

const EM_DASH = '—';
const EN_DASH = '–';
const DASH_CLASS = `[${EN_DASH}${EM_DASH}]`;

/**
 * The detectors. Each must be specific enough to survive real macro prose: "sell-off",
 * "short interest", "the energy sector" and "key rate" are ordinary vocabulary here, so
 * these match constructions and figurative uses, not bare words.
 */
const TELL_PATTERNS: TellPattern[] = [
  {
    code: 'tell_not_x_but_y',
    severity: 'error',
    re: /\bnot\s+(?:just|only|merely|simply)\b[^.?!]{1,140}?\bbut\b|\bit'?s\s+not\s+[^.?!]{1,80}?,\s*it'?s\s+/gi,
    message: 'Not-X-but-Y construction. State the point directly.',
  },
  {
    code: 'tell_closer',
    severity: 'error',
    re: /\b(?:that(?:'s| is) the real (?:win|story|point)|that distinction matters|read that again|let that sink in|make no mistake|the message (?:was|is) clear|this shows the importance of|and that changes everything)\b/gi,
    message: 'Dramatic one-line closer. End on the last concrete fact.',
  },
  {
    code: 'tell_aphorism',
    severity: 'error',
    re: /\b(?:the real question is|at its core|the heart of the matter|what really matters|the deeper (?:issue|truth)|the architecture of|the currency of|the language of)\b/gi,
    message: 'Hidden-truth framing. Make the specific claim instead.',
  },
  {
    code: 'tell_staged_opener',
    severity: 'error',
    re: /(?:^|\n)\s*(?:let'?s (?:dive|explore|break this down|be honest|be clear)|here'?s (?:what you need to know|the thing)|the thing is|without further ado|real talk|look,)\b/gi,
    message: 'Staged run-up before the point. Open on the substance.',
  },
  {
    code: 'tell_strawman',
    severity: 'warning',
    re: /\b(?:i'?m not saying|to be clear,|don'?t get me wrong|this is not to say|some might (?:say|argue)|a tempting approach|one might be tempted|you might think)\b/gi,
    message: 'Answers an objection nobody raised.',
  },
  {
    code: 'tell_dash',
    severity: 'error',
    re: new RegExp(`${DASH_CLASS}|(?:^|\\s)--(?:\\s|$)`, 'g'),
    message: 'Em dash, en dash or double hyphen. Use a period, comma, colon or parentheses.',
  },
  {
    code: 'tell_curly_quotes',
    severity: 'warning',
    re: /[“”‘’]/g,
    message: 'Curly quotation marks. Use straight quotes.',
  },
  {
    code: 'tell_ai_word',
    severity: 'warning',
    // Figurative uses only where the word has a legitimate technical sense here:
    // "robust growth" is a tell, a "robust hedge" is not, and "the energy landscape"
    // is a tell while "landscape orientation" is not. Hence the required context.
    re: /\b(?:delve|deep dive|tapestry|testament|underscor(?:e|es|ed|ing)|showcas(?:e|es|ed|ing)|pivotal|intricac(?:y|ies)|intricate|meticulous(?:ly)?|interplay|garner(?:ed|ing)?|bolster(?:ed|ing)?|vibrant|enduring|pave the way|usher(?:ed|ing)? in|navigat(?:e|es|ing) the|(?:evolving|shifting|changing|geopolitical|economic|energy) landscape|realm of)\b/gi,
    message: 'Stock AI vocabulary.',
  },
  {
    code: 'tell_inflated',
    severity: 'error',
    re: /\b(?:stands? as a testament|marks? a (?:pivotal|crucial|defining) (?:moment|shift)|plays? a (?:key|crucial|vital) role|underscor(?:es|ing) (?:the|its) (?:importance|significance)|reflects? a broader|setting the stage for|signals? a new era|lasting legacy|indelible mark|the future looks bright|exciting times (?:ahead|lie ahead)|watch this space)\b/gi,
    message: 'Inflated significance. Report the fact and its measurable consequence.',
  },
  {
    code: 'tell_ing_rider',
    severity: 'warning',
    re: /,\s+(?:highlighting|underscoring|emphasi[sz]ing|ensuring|reflecting|symboli[sz]ing|signalling|signaling|showcasing|fostering|cultivating|encompassing|contributing to)\b/gi,
    message: 'Shallow -ing rider bolted onto a fact. Write the consequence as its own clause.',
  },
  {
    code: 'tell_unnamed_authority',
    severity: 'warning',
    re: /\b(?:experts?|observers?|analysts?|some critics|several publications|industry reports?|market watchers)\s+(?:argue|believe|say|suggest|note|have cited|contend|warn)\b/gi,
    message: 'Unnamed authority. Name the institution or drop the claim.',
  },
  {
    code: 'tell_avoids_is',
    severity: 'warning',
    re: /\b(?:serves? as|stands? as|functions? as|operates? as|represents? an?|boasts?)\b/gi,
    message: 'Longer phrase standing in for is / are / has.',
  },
  {
    code: 'tell_sales',
    severity: 'warning',
    re: /\b(?:groundbreaking|renowned|breathtaking|stunning|must-(?:read|watch|visit)|nestled|in the heart of|a (?:rich|diverse) (?:array|tapestry)|profound(?:ly)?)\b/gi,
    message: 'Sales language. State what the thing is.',
  },
  {
    code: 'tell_hedge_stack',
    severity: 'warning',
    re: /\b(?:could potentially|might (?:arguably|possibly)|it(?:'s| is) also possible that|in some cases it may|it could be argued that)\b/gi,
    message: 'Stacked hedges. One qualifier, then stop.',
  },
  {
    code: 'tell_chatbot_residue',
    severity: 'error',
    re: /\b(?:i hope this helps|great question|you'?re absolutely right|would you like me to|let me know if|here(?:'s| is) (?:your|the) (?:article|post|caption|summary|report)|certainly!|of course!)/gi,
    message: 'Chatbot residue. The text must stand alone as published copy.',
  },
  {
    code: 'tell_knowledge_limit',
    severity: 'error',
    re: /\b(?:as of my (?:last )?(?:training|knowledge|update)|while specific details are (?:limited|scarce)|based on available information|not (?:publicly|widely) (?:available|documented)|it is believed that)\b/gi,
    message: 'Knowledge-limit disclaimer or an unsupported guess.',
  },
  {
    code: 'tell_bold_label_list',
    severity: 'warning',
    re: /^\s*[-*]\s+\*\*[^*\n]{1,48}\*\*\s*:/gm,
    message: 'Bulleted list where every item is a bold label. Write it as prose.',
  },
  {
    code: 'tell_decorative_heading',
    severity: 'warning',
    re: /^#{1,6}\s+.*(?:[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]|→)/gmu,
    message: 'Emoji or arrow decorating a heading.',
  },
  {
    code: 'tell_title_case_heading',
    severity: 'warning',
    // A heading is title-cased when a short word that sentence case would lowercase
    // (and, the, of, in, for...) appears capitalised mid-heading.
    re: /^#{1,6}\s+\S+(?:\s+\S+)*?\s+(?:And|The|Of|In|For|With|To|On|At|From|As|By)\s+\S+/gm,
    message: 'Title Case heading. Use sentence case.',
  },
];

/**
 * A dash that joins a range or a compound, not two clauses: "3.5%-3.75%", "$1.2bn-$1.5bn",
 * "March 18-20", "Q3-Q4", "US-China", "Israel-Iran". Always unspaced, and either side
 * carries a digit or both sides are capitalised.
 *
 * These are not AI tells and they must never become a colon. They are normalised to a
 * plain hyphen, which is what the target formats (X, Substack markdown) want anyway.
 * Found by running the detector over 22 stored reports: the en dash in a Fed target
 * range was the single most common dash in the corpus.
 */
const RANGE_DASH = new RegExp(
  `(?<=\\d[\\w.%$,]{0,6}|[A-Z][\\w.]{0,11})${DASH_CLASS}(?=\\$?\\d|[A-Z])`,
  'g',
);

/** Regions whose contents must never be rewritten or flagged: code, URLs, link targets. */
const PROTECTED = /```[\s\S]*?```|`[^`\n]+`|\bhttps?:\/\/\S+|\]\([^)\s]+\)/g;

/** Private-use sentinel, so a masked region can never collide with real text. */
const MASK_OPEN = '';
const MASK_CLOSE = '';

/**
 * Replace every protected region with an opaque token, so a dash inside a URL or a
 * code fence is never rewritten and never reported.
 */
function maskProtected(text: string): { masked: string; restore: (s: string) => string } {
  const stash: string[] = [];
  const masked = text.replace(PROTECTED, m => {
    stash.push(m);
    return `${MASK_OPEN}${stash.length - 1}${MASK_CLOSE}`;
  });
  const restore = (s: string) =>
    s.replace(new RegExp(`${MASK_OPEN}(\\d+)${MASK_CLOSE}`, 'g'), (_m, i) => stash[Number(i)] ?? '');
  return { masked, restore };
}

/** Everything the text still gets wrong, strongest first. */
export function detectAiTells(text: string): VoiceFinding[] {
  // Range and compound dashes are normalised out first, so a Fed target band or
  // "US-China" never shows up as a dash tell.
  const { masked } = maskProtected(String(text ?? '').replace(RANGE_DASH, '-'));
  const findings: VoiceFinding[] = [];
  for (const p of TELL_PATTERNS) {
    const re = new RegExp(p.re.source, p.re.flags);
    const hits = masked.match(re);
    if (!hits?.length) continue;
    const samples = [...new Set(hits.map(h => h.trim()).filter(Boolean))].slice(0, 3);
    findings.push({
      code: p.code,
      severity: p.severity,
      message: hits.length > 1 ? `${p.message} (${hits.length} occurrences)` : p.message,
      samples,
    });
  }
  return findings.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
}

/** One-line summary of the findings, for a report's _warnings array. */
export function summariseTells(findings: VoiceFinding[], label = 'Voice check'): string | null {
  if (!findings.length) return null;
  const errors = findings.filter(f => f.severity === 'error');
  const head = errors.length ? errors : findings;
  const names = head.slice(0, 3).map(f => f.code.replace(/^tell_/, '').replace(/_/g, ' '));
  const more = head.length > 3 ? ', ...' : '';
  return `${label}: ${findings.length} AI tell${findings.length === 1 ? '' : 's'} left after the scrub (${names.join(', ')}${more}).`;
}

// ─── Mechanical scrub ──────────────────────────────────────────────────────────

const CHATBOT_LINE =
  /^[^\n]*\b(?:i hope this helps|hope that helps|let me know if|would you like me to|here(?:'s| is) (?:your|the) (?:article|post|caption|summary|report))\b[^\n]*$/gim;

/**
 * Dash removal.
 *
 * The prompt is the real defence; this exists because the rule is absolute and models
 * still slip. Choices, all of which produce grammatical output:
 *   paired dashes inside one sentence  -> commas  (parenthetical)
 *   single dash, no colon in the head  -> colon   (appositive or explanation)
 *   single dash, colon already present -> comma for a short tail, else a period
 *
 * A colon is the safe single-dash substitute in analytic prose: it works for both an
 * appositive ("gallium and germanium") and an explanation ("markets rallied anyway"),
 * where a comma would produce a splice and a period a fragment.
 */
function fixDashes(text: string): string {
  // Normalise the double hyphen first so one code path handles all three forms, then
  // take ranges and compounds out of play before anything is treated as a connector.
  const out = text
    .replace(/(^|\s)--(\s|$)/g, `$1${EM_DASH}$2`)
    .replace(RANGE_DASH, '-');
  if (!new RegExp(DASH_CLASS).test(out)) return out;

  // Sentence-ish units: everything up to and including a terminator or newline.
  return out.replace(/[^.!?\n]*(?:[.!?]+|\n|$)/g, sentence => {
    if (!sentence) return sentence;
    const dashes = sentence.match(new RegExp(DASH_CLASS, 'g'));
    if (!dashes) return sentence;

    if (dashes.length >= 2) {
      // Parenthetical: "the policy, announced without warning, affects...".
      return sentence.replace(new RegExp(`\\s*${DASH_CLASS}\\s*`, 'g'), ', ');
    }

    const idx = sentence.search(new RegExp(DASH_CLASS));
    const head = sentence.slice(0, idx).replace(/\s+$/, '');
    const tail = sentence.slice(idx + 1).replace(/^\s+/, '');
    if (!head) return tail;              // a leading dash is a bullet, not a connector
    if (!tail) return head;
    if (!head.includes(':')) return `${head}: ${tail}`;

    const tailWords = tail.replace(/[.!?]+\s*$/, '').split(/\s+/).filter(Boolean).length;
    if (tailWords <= 7) return `${head}, ${tail}`;
    return `${head}. ${tail.charAt(0).toUpperCase()}${tail.slice(1)}`;
  });
}

export interface ScrubResult {
  text: string;
  /** Codes of the things actually changed, for logging. */
  changed: string[];
}

/**
 * Fix the tells that can be fixed without guessing at meaning. Everything else is left
 * alone and reported by detectAiTells, because a wrong mechanical rewrite of an
 * argument is worse than a surviving tell.
 *
 * Content inside code fences, inline code, URLs and markdown link targets is untouched.
 */
export function scrubAiTellsVerbose(input: string): ScrubResult {
  const original = String(input ?? '');
  if (!original.trim() || !SCRUB_ENABLED) return { text: original, changed: [] };

  const { masked, restore } = maskProtected(original);
  let t = masked;
  const changed: string[] = [];
  const track = (code: string, next: string) => {
    if (next !== t) changed.push(code);
    t = next;
  };

  // Chatbot wrapper: a whole line of it goes, along with a leading "Sure!" preamble.
  track('chatbot_residue', t.replace(CHATBOT_LINE, ''));
  track('preamble', t.replace(/^\s*(?:sure|certainly|of course|absolutely)[!,.][^\n]*\n+/i, ''));

  track('curly_quotes', t.replace(/[“”]/g, '"').replace(/[‘’]/g, "'"));

  track('dashes', fixDashes(t));

  // Decorative arrows, and emoji leading a heading or list item. An emoji inside a
  // sentence is left alone; the tell is decoration in the furniture.
  track('decoration', t
    .replace(/^(\s*(?:[-*]|#{1,6})\s*)[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]+\s*/gmu, '$1')
    .replace(/(^|\s)→(\s)/g, '$1to$2'));

  // Collapse whatever whitespace the edits above left behind.
  track('whitespace', t.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim());

  return { text: restore(t), changed: [...new Set(changed)] };
}

/** scrubAiTellsVerbose, when only the text is wanted. */
export function scrubAiTells(input: string): string {
  return scrubAiTellsVerbose(input).text;
}

/**
 * Scrub a value when it is a non-empty string, otherwise return it unchanged. Saves
 * repeating the guard across every optional field on a report.
 */
export function scrubField<T>(value: T): T {
  return typeof value === 'string' && value.trim() ? (scrubAiTells(value) as unknown as T) : value;
}

/**
 * Scrub every string in a record of prose fields and return the findings that survive,
 * so a generator can fold them into its _warnings in one call.
 */
export function scrubAndReport(
  texts: Array<string | undefined>,
): { cleaned: string[]; findings: VoiceFinding[] } {
  const cleaned = texts.map(t => (t ? scrubAiTells(t) : ''));
  const findings = detectAiTells(cleaned.join('\n\n'));
  return { cleaned, findings };
}
