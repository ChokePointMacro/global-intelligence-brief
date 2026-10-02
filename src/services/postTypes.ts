/**
 * Post types — the recurring segments the Post Queue generates into.
 *
 * A post type is a row of *settings*, not code: slot time, which days, length rules,
 * cashtag limits, prompt template. Mike edits them on screen. Nothing here should ever
 * become a hardcoded branch in the generator — if a rule can't be expressed as a column,
 * it belongs in the prompt template, not in an `if`.
 *
 * This module is shared by the server (seeding, validation) and the UI (labels, defaults),
 * so it must stay dependency-free beyond the ET helpers.
 */
import { parseHhMm } from './time.ts';

/** 280-char post vs. an X Premium long-form post. */
export type LengthMode = 'short' | 'long';

export type CardType =
  | 'market_chart'
  | 'chokepoint_map'
  | 'headline'
  | 'longform_cover'
  | 'photo'
  | 'none';

export const CARD_TYPES: Array<{ value: CardType; label: string }> = [
  { value: 'market_chart',   label: 'Market chart' },
  { value: 'chokepoint_map', label: 'Chokepoint map' },
  { value: 'headline',       label: 'Headline card' },
  { value: 'longform_cover', label: 'Long-form cover' },
  { value: 'photo',          label: 'Photo' },
  { value: 'none',           label: 'No image' },
];

export interface PostType {
  id: number;
  name: string;
  /** Short code shown on the timeline chip, e.g. "S1". */
  code: string;
  /** Hex colour for the chip. */
  color: string;
  /**
   * Default slot as "HH:MM" Eastern, or null for types with no fixed time
   * (Manual, and the Substack link reply which is an offset from its parent).
   */
  default_time_et: string | null;
  /** Comma-separated day numbers, 0=Sun…6=Sat. Empty means "never auto-schedules". */
  days_of_week: string;
  /** Cap per day; null = unlimited. */
  max_per_day: number | null;
  prompt_template: string;
  card_type: CardType;
  cashtag_min: number;
  cashtag_max: number;
  hashtag_max: number;
  length_mode: LengthMode;
  /** 1 = the rule checker fails any post of this type with no source. */
  source_required: number;
  /** Warn when the underlying event is older than this. null = never stale. */
  staleness_hours: number | null;
  active: number;
  sort_order: number;
}

/** The nine types the app ships with. Mike can edit, pause, duplicate or add to these. */
export type PostTypeSeed = Omit<PostType, 'id'>;

/**
 * Cashtags are seeded OFF for every type.
 *
 * The Post Queue build plan specifies 1–3 cashtags on several types, but that contradicts
 * Mike's standing "no cashtags, ever" instruction on this account. Rather than pick a
 * winner in code, the limits are data: seeded at 0/0, raisable per type on the Post Types
 * screen whenever he decides otherwise. Confirmed with Mike 2026-10-01.
 */
const NO_CASHTAGS = { cashtag_min: 0, cashtag_max: 0 } as const;

export const SEED_POST_TYPES: PostTypeSeed[] = [
  {
    name: 'Morning Market Brief', code: 'S1', color: '#f7931a',
    default_time_et: '08:45', days_of_week: '1,2,3,4,5', max_per_day: 1,
    card_type: 'market_chart', ...NO_CASHTAGS, hashtag_max: 1,
    length_mode: 'short', source_required: 1, staleness_hours: 12,
    active: 1, sort_order: 10,
    prompt_template:
      'Overnight moves, then three "what matters today" lines, then the catalysts to watch. ' +
      'Lead with the single number that moved most. Market-hours framing for a US open.',
  },
  {
    name: 'Flex: Breaking / Map', code: 'S2', color: '#ef4444',
    // The plan describes a 9:30am–3:30pm window rather than a fixed time. The window's
    // lower bound is the default; "next open time" placement lands it inside the window.
    default_time_et: '09:30', days_of_week: '1,2,3,4,5', max_per_day: 2,
    card_type: 'chokepoint_map', ...NO_CASHTAGS, hashtag_max: 1,
    length_mode: 'short', source_required: 1, staleness_hours: 3,
    active: 1, sort_order: 20,
    prompt_template:
      'Event-driven. Only fires for events scoring 10+. What happened, which chokepoint it ' +
      'touches, and the first-order market consequence. No speculation beyond the mechanism.',
  },
  {
    name: 'Close Analysis', code: 'S3', color: '#8b5cf6',
    default_time_et: '16:20', days_of_week: '1,2,3,4,5', max_per_day: 1,
    card_type: 'market_chart', ...NO_CASHTAGS, hashtag_max: 1,
    length_mode: 'long', source_required: 1, staleness_hours: 24,
    active: 1, sort_order: 30,
    prompt_template:
      'Premium long post, 1,200–2,500 characters: thesis, mechanism, winners and losers, ' +
      'what to watch next. Must end with the "Not investment advice" line. No price targets.',
  },
  {
    name: 'Headline A', code: 'S4', color: '#0ea5e9',
    default_time_et: '17:30', days_of_week: '0,1,2,3,4,5,6', max_per_day: 1,
    card_type: 'headline', ...NO_CASHTAGS, hashtag_max: 1,
    length_mode: 'short', source_required: 1, staleness_hours: 6,
    active: 1, sort_order: 40,
    prompt_template: 'What happened, why it matters, the market angle. Tightest framing of the day\'s best unposted event.',
  },
  {
    name: 'Headline B (Asia open)', code: 'S5', color: '#14b8a6',
    default_time_et: '20:00', days_of_week: '0,1,2,3,4,5,6', max_per_day: 1,
    card_type: 'headline', ...NO_CASHTAGS, hashtag_max: 1,
    length_mode: 'short', source_required: 1, staleness_hours: 6,
    active: 1, sort_order: 50,
    prompt_template: 'The day\'s second-best unposted event, framed for the Asia open. What Asian desks will react to.',
  },
  {
    name: 'Friday Cat + Companion', code: 'FRI', color: '#eab308',
    default_time_et: '18:00', days_of_week: '5', max_per_day: 1,
    card_type: 'photo', ...NO_CASHTAGS, hashtag_max: 0,
    length_mode: 'short', source_required: 0, staleness_hours: null,
    active: 1, sort_order: 60,
    prompt_template: 'Friday cat post plus its companion piece. Two linked posts; light register, still on-brand.',
  },
  {
    name: 'Sunday Week Ahead', code: 'SUN', color: '#a855f7',
    default_time_et: '18:00', days_of_week: '0', max_per_day: 1,
    card_type: 'longform_cover', ...NO_CASHTAGS, hashtag_max: 1,
    length_mode: 'long', source_required: 1, staleness_hours: null,
    active: 1, sort_order: 70,
    prompt_template: 'Week Ahead long post: the calendar, the two or three things that actually matter, and why. Pin after posting.',
  },
  {
    name: 'Link reply (Substack)', code: 'LINK', color: '#64748b',
    // No slot of its own: it is a reply, placed at parent time + offset_minutes.
    default_time_et: null, days_of_week: '', max_per_day: 1,
    card_type: 'none', ...NO_CASHTAGS, hashtag_max: 0,
    length_mode: 'short', source_required: 0, staleness_hours: null,
    active: 1, sort_order: 80,
    prompt_template: 'Substack link as a reply to the parent post. Mike sends this one himself.',
  },
  {
    name: 'Manual / ad hoc', code: 'MAN', color: '#6b7280',
    default_time_et: null, days_of_week: '', max_per_day: null,
    card_type: 'none', ...NO_CASHTAGS, hashtag_max: 1,
    length_mode: 'short', source_required: 0, staleness_hours: null,
    active: 1, sort_order: 90,
    prompt_template: '',
  },
];

// ─── Validation ────────────────────────────────────────────────────────────────

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

const DAY_PATTERN = /^[0-6](,[0-6])*$/;

/**
 * Validate a post type before it is written.
 *
 * Returns every problem rather than the first, so the settings screen can show them all
 * at once instead of making Mike resubmit repeatedly.
 */
export function validatePostType(input: Partial<PostType>): ValidationResult {
  const errors: string[] = [];

  const name = String(input.name ?? '').trim();
  if (!name) errors.push('Name is required.');
  if (name.length > 60) errors.push('Name must be 60 characters or fewer.');

  const code = String(input.code ?? '').trim();
  if (!code) errors.push('Short code is required.');
  else if (!/^[A-Za-z0-9]{1,6}$/.test(code)) errors.push('Short code must be 1–6 letters or digits.');

  if (input.color != null && !/^#[0-9a-fA-F]{6}$/.test(String(input.color))) {
    errors.push('Colour must be a hex value like #f7931a.');
  }

  // null is legitimate — Manual and the link reply have no slot of their own.
  if (input.default_time_et != null && input.default_time_et !== '') {
    if (parseHhMm(String(input.default_time_et)) === null) {
      errors.push('Default slot must be a 24-hour Eastern time like 16:20.');
    }
  }

  const days = String(input.days_of_week ?? '');
  if (days !== '' && !DAY_PATTERN.test(days)) {
    errors.push('Days must be comma-separated numbers 0–6 (0 = Sunday).');
  }

  const min = Number(input.cashtag_min ?? 0);
  const max = Number(input.cashtag_max ?? 0);
  if (!Number.isInteger(min) || min < 0) errors.push('Cashtag minimum must be 0 or more.');
  if (!Number.isInteger(max) || max < 0) errors.push('Cashtag maximum must be 0 or more.');
  if (min > max) errors.push('Cashtag minimum cannot exceed the maximum.');

  const hashMax = Number(input.hashtag_max ?? 0);
  if (!Number.isInteger(hashMax) || hashMax < 0 || hashMax > 2) {
    // Measured: 1–2 tags ≈ +21% engagement, 3+ ≈ −17%. Above 2 is self-harm.
    errors.push('Hashtag maximum must be between 0 and 2.');
  }

  if (input.length_mode != null && !['short', 'long'].includes(String(input.length_mode))) {
    errors.push('Length must be "short" or "long".');
  }

  if (input.card_type != null && !CARD_TYPES.some(c => c.value === input.card_type)) {
    errors.push(`Card type must be one of: ${CARD_TYPES.map(c => c.value).join(', ')}.`);
  }

  if (input.max_per_day != null && (!Number.isInteger(Number(input.max_per_day)) || Number(input.max_per_day) < 1)) {
    errors.push('Max per day must be a whole number of 1 or more, or blank for unlimited.');
  }

  if (input.staleness_hours != null && (!Number.isInteger(Number(input.staleness_hours)) || Number(input.staleness_hours) < 1)) {
    errors.push('Staleness limit must be a whole number of hours, or blank for never.');
  }

  return { ok: errors.length === 0, errors };
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "1,2,3,4,5" → "Mon–Fri"; "0,6" → "Sun, Sat"; "" → "Never". */
export function describeDays(days: string): string {
  const parsed = String(days || '').split(',').map(d => d.trim()).filter(Boolean).map(Number);
  if (!parsed.length) return 'Never';
  if (parsed.length === 7) return 'Every day';

  const sorted = [...new Set(parsed)].sort((a, b) => a - b);
  // Collapse a contiguous run into a range; anything else lists out.
  const contiguous = sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1);
  if (contiguous && sorted.length > 2) {
    return `${DAY_LABELS[sorted[0]]}–${DAY_LABELS[sorted[sorted.length - 1]]}`;
  }
  return sorted.map(d => DAY_LABELS[d]).join(', ');
}
