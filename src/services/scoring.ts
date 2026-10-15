/**
 * Performance scoring model — the single source of truth.
 *
 * Imported by the server (canonical scoring + API), the Weights & Measures UI (live
 * preview as you drag sliders), and the weekly sampler. Previously these weights were
 * hardcoded in three places and silently drifted apart.
 *
 * Design note: every dimension is normalised to roughly 0–1 BEFORE the weight is applied,
 * so a weight of 1.0 means the same thing everywhere and the sliders are comparable to
 * each other. Without that, "reply weight 2" and "virality weight 2" would mean wildly
 * different amounts of influence and the UI would be lying to you.
 */

export interface ScoringWeights {
  // ── Raw engagement: relative value of each interaction type ──
  like: number;
  repost: number;
  quote: number;
  reply: number;
  bookmark: number;

  // ── Composite dimensions, each 0–1 normalised then weighted ──
  /** Engagement per impression — rewards punching above your reach. */
  engagementRate: number;
  /** (reposts + quotes) / impressions — spread BEYOND the author's own followers. */
  virality: number;
  /** Replies per impression — conversation depth, the strongest follow driver. */
  conversation: number;
  /** Bookmarks per impression — "I want this later"; a quality signal, not a popularity one. */
  reference: number;
  /** Engagement accrued per hour since posting — catches fast movers early. */
  velocity: number;
  /** How early into a topic's lifecycle the post landed. Rewards leading, not following. */
  trendHopping: number;
  /** Author reach (log-scaled followers). Positive favours big accounts; NEGATIVE surfaces
   *  under-followed accounts that outperform — usually the better signal to learn from. */
  reach: number;

  // ── Shape ──
  /** Hours at which a post's score is halved. Lower = more aggressively recency-biased. */
  recencyHalfLifeHours: number;
  /** Impressions required before rate-based dimensions are trusted (avoids divide-by-noise). */
  minImpressions: number;
}

export const DEFAULT_WEIGHTS: ScoringWeights = {
  like: 1,
  repost: 2,
  quote: 3,
  reply: 1.5,
  bookmark: 2,

  engagementRate: 1.0,
  virality: 1.2,
  conversation: 1.0,
  reference: 0.6,
  velocity: 0.8,
  trendHopping: 0.5,
  reach: 0.3,

  recencyHalfLifeHours: 33,
  minImpressions: 500,
};

export interface WeightMeta {
  key: keyof ScoringWeights;
  label: string;
  group: 'engagement' | 'dimension' | 'shape';
  min: number;
  max: number;
  step: number;
  help: string;
}

export const WEIGHT_META: WeightMeta[] = [
  { key: 'like', label: 'Like', group: 'engagement', min: 0, max: 5, step: 0.1, help: 'Cheapest interaction. Weighting it high biases toward broad, agreeable posts.' },
  { key: 'repost', label: 'Repost', group: 'engagement', min: 0, max: 5, step: 0.1, help: 'Costs the reposter reputation — a stronger endorsement than a like.' },
  { key: 'quote', label: 'Quote', group: 'engagement', min: 0, max: 5, step: 0.1, help: 'Strongest distribution signal: adds commentary and reaches a new graph.' },
  { key: 'reply', label: 'Reply', group: 'engagement', min: 0, max: 5, step: 0.1, help: 'Conversation. Drives follows harder than likes, but includes disagreement.' },
  { key: 'bookmark', label: 'Bookmark', group: 'engagement', min: 0, max: 5, step: 0.1, help: 'Private save. Correlates with genuine usefulness rather than reaction.' },

  { key: 'engagementRate', label: 'Engagement rate', group: 'dimension', min: 0, max: 3, step: 0.05, help: 'Total weighted engagement per impression. The core efficiency measure.' },
  { key: 'virality', label: 'Virality', group: 'dimension', min: 0, max: 3, step: 0.05, help: 'Reposts + quotes per impression — how far it travelled past the author’s own audience.' },
  { key: 'conversation', label: 'Conversation', group: 'dimension', min: 0, max: 3, step: 0.05, help: 'Replies per impression. Highest correlation with gaining followers.' },
  { key: 'reference', label: 'Reference value', group: 'dimension', min: 0, max: 3, step: 0.05, help: 'Bookmarks per impression. Finds durable, saved-for-later content.' },
  { key: 'velocity', label: 'Velocity', group: 'dimension', min: 0, max: 3, step: 0.05, help: 'Engagement per hour since posting. Surfaces fast movers before they peak.' },
  { key: 'trendHopping', label: 'Trend hopping', group: 'dimension', min: 0, max: 3, step: 0.05, help: 'How early into a topic’s life the post landed. High = reward leading the story, not chasing it.' },
  { key: 'reach', label: 'Author reach', group: 'dimension', min: -2, max: 2, step: 0.05, help: 'Positive favours large accounts. NEGATIVE surfaces small accounts that outperform — usually more instructive.' },

  { key: 'recencyHalfLifeHours', label: 'Recency half-life (h)', group: 'shape', min: 2, max: 168, step: 1, help: 'Hours until a post’s score halves. Low = only fresh content ranks.' },
  { key: 'minImpressions', label: 'Min impressions', group: 'shape', min: 0, max: 5000, step: 50, help: 'Floor before rate-based dimensions are trusted. Too low and noise dominates.' },
];

export interface SampleRow {
  tweet_id: string;
  theme?: string;
  username?: string | null;
  followers?: number;
  created_at: string;
  text: string;
  chars?: number;
  hashtag_count?: number;
  has_link?: number;
  likes: number;
  reposts: number;
  replies: number;
  quotes: number;
  bookmarks: number;
  impressions: number;
  /** Hours between the topic first appearing in the sample and this post. Optional. */
  topic_lag_hours?: number | null;
}

export interface ScoreBreakdown {
  score: number;
  /** Per-dimension contribution to the final score — this is what the UI charts. */
  contributions: Record<string, number>;
  weightedEngagement: number;
  engagementRate: number;
  ageHours: number;
  recencyFactor: number;
}

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/**
 * Score one sampled post.
 *
 * `now` is injectable so the UI can score a stored sample deterministically rather than
 * having ranks shift underneath the user while they drag a slider.
 */
export function scorePost(row: SampleRow, w: ScoringWeights, now = Date.now()): ScoreBreakdown {
  const imp = row.impressions ?? 0;
  const trusted = imp >= w.minImpressions;

  const weightedEngagement =
    (row.likes ?? 0) * w.like +
    (row.reposts ?? 0) * w.repost +
    (row.quotes ?? 0) * w.quote +
    (row.replies ?? 0) * w.reply +
    (row.bookmarks ?? 0) * w.bookmark;

  const ageHours = Math.max(0.5, (now - new Date(row.created_at).getTime()) / 3_600_000);
  const recencyFactor = Math.pow(0.5, ageHours / Math.max(1, w.recencyHalfLifeHours));

  // Rates are per-impression and tiny, so each is scaled into a comparable 0–1 band.
  // The divisors are the rough ceiling observed for each on healthy posts.
  const engagementRate = trusted ? weightedEngagement / imp : 0;
  const nEngagement = clamp01(engagementRate / 0.10);
  const nVirality = trusted ? clamp01(((row.reposts ?? 0) + (row.quotes ?? 0)) / imp / 0.02) : 0;
  const nConversation = trusted ? clamp01((row.replies ?? 0) / imp / 0.01) : 0;
  const nReference = trusted ? clamp01((row.bookmarks ?? 0) / imp / 0.01) : 0;
  const nVelocity = clamp01(weightedEngagement / ageHours / 100);

  // Trend hopping: 1.0 when the post led the topic, decaying to 0 by ~48h behind it.
  // Null lag (topic origin unknown) scores neutral rather than penalising.
  const lag = row.topic_lag_hours;
  const nTrend = lag == null ? 0.5 : clamp01(1 - lag / 48);

  // Reach is signed — a negative weight must be able to push the score down.
  const nReach = clamp01(Math.log10(Math.max(10, row.followers ?? 10)) / 7);

  const contributions: Record<string, number> = {
    engagementRate: nEngagement * w.engagementRate,
    virality: nVirality * w.virality,
    conversation: nConversation * w.conversation,
    reference: nReference * w.reference,
    velocity: nVelocity * w.velocity,
    trendHopping: nTrend * w.trendHopping,
    reach: nReach * w.reach,
  };

  // Apply recency, then derive the score from the ROUNDED contributions so that the
  // stacked bars in the UI always sum to the number printed beside them. Rounding score
  // and contributions independently left them disagreeing in the 5th decimal.
  for (const k of Object.keys(contributions)) {
    contributions[k] = Number((contributions[k] * recencyFactor).toFixed(6));
  }
  const score = Object.values(contributions).reduce((a, b) => a + b, 0);

  return {
    score: Number(score.toFixed(6)),
    contributions,
    weightedEngagement: Number(weightedEngagement.toFixed(2)),
    engagementRate: Number((engagementRate * 100).toFixed(3)),
    ageHours: Number(ageHours.toFixed(1)),
    recencyFactor: Number(recencyFactor.toFixed(3)),
  };
}

/** Merge stored partial weights over defaults so a new dimension never breaks saved config. */
export function normaliseWeights(raw: unknown): ScoringWeights {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Partial<ScoringWeights>;
  const out = { ...DEFAULT_WEIGHTS };
  for (const meta of WEIGHT_META) {
    const v = obj[meta.key];
    if (typeof v === 'number' && Number.isFinite(v)) {
      out[meta.key] = Math.min(meta.max, Math.max(meta.min, v));
    }
  }
  return out;
}
