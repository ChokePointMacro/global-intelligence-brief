/**
 * API spend tracking — one place that knows what things cost.
 *
 * Two very different cost models sit side by side here:
 *   - X is per-operation (a post costs the same regardless of length)
 *   - AI providers are per-token (cost scales with prompt + output size)
 *
 * Rates marked `verified` came from the provider's own pricing page. Rates marked
 * `estimate` are placeholders the operator should confirm — the UI labels them so a
 * number never looks more authoritative than it is.
 */

export type Provider = 'x' | 'anthropic' | 'openai' | 'gemini';

export interface Rate {
  /** USD per unit. For AI: per 1M tokens. For X: per operation. */
  usd: number;
  unit: 'per_1m_input_tokens' | 'per_1m_output_tokens' | 'per_operation';
  verified: boolean;
  note?: string;
}

/**
 * X API — pay-per-use since the free tier was discontinued (Feb 2026).
 * A post containing a URL is billed at 13.3x a plain post, which is why the
 * generator keeps links out of the body.
 */
export const X_RATES: Record<string, Rate> = {
  post: { usd: 0.015, unit: 'per_operation', verified: true },
  post_with_link: { usd: 0.200, unit: 'per_operation', verified: true, note: '13.3x a plain post' },
  read: { usd: 0.005, unit: 'per_operation', verified: true, note: 'per post returned' },
};

/** AI model rates, USD per 1M tokens. */
export const MODEL_RATES: Record<string, { input: number; output: number; verified: boolean }> = {
  // Anthropic — from the official pricing table.
  'claude-sonnet-4-6': { input: 3.00, output: 15.00, verified: true },
  'claude-sonnet-5':   { input: 3.00, output: 15.00, verified: true },
  'claude-opus-4-8':   { input: 5.00, output: 25.00, verified: true },
  'claude-opus-4-7':   { input: 5.00, output: 25.00, verified: true },
  'claude-haiku-4-5':  { input: 1.00, output: 5.00,  verified: true },
  // Non-Anthropic providers: placeholders. Confirm against the provider's pricing
  // page and update here — the UI flags unverified rates rather than hiding them.
  'gpt-4o':            { input: 2.50, output: 10.00, verified: false },
  'gemini-2.0-flash':  { input: 0.10, output: 0.40,  verified: false },
};

const DEFAULT_RATE = { input: 0, output: 0, verified: false };

/** Longest-prefix match so `claude-sonnet-4-6-20260101` still resolves. */
export function rateForModel(model: string) {
  if (!model) return DEFAULT_RATE;
  if (MODEL_RATES[model]) return MODEL_RATES[model];
  const key = Object.keys(MODEL_RATES)
    .filter(k => model.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  return key ? MODEL_RATES[key] : DEFAULT_RATE;
}

export function aiCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const r = rateForModel(model);
  return (inputTokens / 1_000_000) * r.input + (outputTokens / 1_000_000) * r.output;
}

export interface SpendEntry {
  provider: Provider;
  /** e.g. 'post', 'post_with_link', 'read', 'report_generation', 'hashtag_pass' */
  operation: string;
  model?: string | null;
  units?: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd: number;
  /** Whether every rate used was a verified published price. */
  verified: boolean;
  meta?: Record<string, unknown>;
}

/** Build an entry for an AI call. */
export function aiSpend(operation: string, model: string, inputTokens: number, outputTokens: number, meta?: Record<string, unknown>): SpendEntry {
  const r = rateForModel(model);
  return {
    provider: model.startsWith('claude') ? 'anthropic' : model.startsWith('gpt') ? 'openai' : 'gemini',
    operation,
    model,
    units: 1,
    inputTokens,
    outputTokens,
    costUsd: aiCostUsd(model, inputTokens, outputTokens),
    verified: r.verified,
    meta,
  };
}

/** Build an entry for an X operation. `units` is posts written or posts read. */
export function xSpend(operation: keyof typeof X_RATES, units = 1, meta?: Record<string, unknown>): SpendEntry {
  const rate = X_RATES[operation];
  return {
    provider: 'x',
    operation,
    units,
    costUsd: (rate?.usd ?? 0) * units,
    verified: rate?.verified ?? false,
    meta,
  };
}
