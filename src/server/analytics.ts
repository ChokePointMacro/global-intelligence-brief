/**
 * Analytics surfaces: the spend ledger, scoring weights, and the audience sample store.
 *
 * Extracted from server.ts, which had grown past 3,400 lines — large enough that
 * locating anything required a grep and editing it safely required care. This module
 * is self-contained: it needs a database handle and the auth middleware, nothing else.
 *
 * `recordSpend` is returned separately from the router because the posting paths in
 * server.ts write to the ledger too; the routes only read from it.
 */
import type { Database } from 'better-sqlite3';
import express, { type RequestHandler } from 'express';
import { DEFAULT_WEIGHTS, normaliseWeights, scorePost, type ScoringWeights } from '../services/scoring.ts';
import { X_RATES, MODEL_RATES, type SpendEntry } from '../services/spend.ts';

export interface AnalyticsDeps {
  db: Database;
  requireAuth: RequestHandler;
  /** Called when a ledger write fails; must not throw. */
  onLedgerError?: (err: unknown) => void;
}

export interface Analytics {
  router: express.Router;
  recordSpend: (entry: SpendEntry) => void;
  getScoringWeights: () => ScoringWeights;
}

/** Create the tables these routes read. Idempotent; safe to call on every boot. */
function ensureTables(db: Database): void {
  // The sampler creates audience_samples too, but the UI must not 500 before the first
  // sampler run — so it is created here as well and an empty result is a valid state.
  db.exec(`CREATE TABLE IF NOT EXISTS audience_samples (
    tweet_id TEXT PRIMARY KEY, sampled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    theme TEXT, author_id TEXT, username TEXT, followers INTEGER,
    created_at TEXT, text TEXT, chars INTEGER, hashtag_count INTEGER,
    has_link INTEGER, likes INTEGER, reposts INTEGER, replies INTEGER,
    quotes INTEGER, bookmarks INTEGER, impressions INTEGER
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS api_spend (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts DATETIME DEFAULT CURRENT_TIMESTAMP,
    provider TEXT NOT NULL,
    operation TEXT NOT NULL,
    model TEXT,
    units INTEGER DEFAULT 1,
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    cost_usd REAL NOT NULL,
    verified INTEGER DEFAULT 1,
    meta TEXT
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_api_spend_ts ON api_spend(ts)`);
}

export function createAnalytics({ db, requireAuth, onLedgerError }: AnalyticsDeps): Analytics {
  try {
    ensureTables(db);
  } catch (err) {
    console.error('[analytics] table init failed:', err);
  }

  const getScoringWeights = (): ScoringWeights => {
    try {
      const row = db.prepare("SELECT value FROM app_settings WHERE key = 'scoring_weights'").get() as any;
      return normaliseWeights(row?.value ? JSON.parse(row.value) : {});
    } catch {
      return { ...DEFAULT_WEIGHTS };
    }
  };

  /** Never throws — a failed ledger write must not break the operation it is measuring. */
  const recordSpend = (entry: SpendEntry): void => {
    try {
      db.prepare(`INSERT INTO api_spend (provider, operation, model, units, input_tokens, output_tokens, cost_usd, verified, meta)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(entry.provider, entry.operation, entry.model ?? null, entry.units ?? 1,
             entry.inputTokens ?? 0, entry.outputTokens ?? 0, entry.costUsd,
             entry.verified ? 1 : 0, entry.meta ? JSON.stringify(entry.meta) : null);
    } catch (err) {
      onLedgerError?.(err);
    }
  };

  const router = express.Router();

  // ── Scoring weights ──
  router.get('/api/scoring-weights', requireAuth, (_req, res) => {
    res.json({ weights: getScoringWeights(), defaults: DEFAULT_WEIGHTS });
  });

  router.put('/api/scoring-weights', requireAuth, (req, res) => {
    const weights = normaliseWeights(req.body?.weights);
    db.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES ('scoring_weights', ?, CURRENT_TIMESTAMP)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`)
      .run(JSON.stringify(weights));
    res.json({ success: true, weights });
  });

  router.post('/api/scoring-weights/reset', requireAuth, (_req, res) => {
    db.prepare("DELETE FROM app_settings WHERE key = 'scoring_weights'").run();
    res.json({ success: true, weights: DEFAULT_WEIGHTS });
  });

  // ── Audience samples ──
  router.get('/api/audience-samples', requireAuth, (req, res) => {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 300));
    try {
      const rows = db.prepare(`SELECT tweet_id, theme, username, followers, created_at, text, chars,
                                      hashtag_count, has_link, likes, reposts, replies, quotes,
                                      bookmarks, impressions, sampled_at
                               FROM audience_samples ORDER BY sampled_at DESC, impressions DESC LIMIT ?`).all(limit) as any[];
      const themes = db.prepare('SELECT theme, COUNT(*) c FROM audience_samples GROUP BY theme').all() as any[];
      const last = db.prepare('SELECT MAX(sampled_at) m FROM audience_samples').get() as any;
      res.json({ samples: rows, total: rows.length, byTheme: themes, lastSampledAt: last?.m ?? null });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Server-side ranking using the saved weights — the same function the UI previews with.
  router.get('/api/audience-samples/ranked', requireAuth, (req, res) => {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const w = getScoringWeights();
    const rows = db.prepare('SELECT * FROM audience_samples').all() as any[];
    const now = Date.now();
    const ranked = rows
      .map(r => ({ ...r, ...scorePost(r, w, now) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    res.json({ weights: w, count: rows.length, ranked });
  });

  // ── Spend ──
  router.get('/api/spend', requireAuth, (req, res) => {
    const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    try {
      const totals = db.prepare(
        `SELECT provider, operation, model, COUNT(*) calls, SUM(units) units,
                SUM(input_tokens) input_tokens, SUM(output_tokens) output_tokens,
                SUM(cost_usd) cost, MIN(verified) verified
         FROM api_spend WHERE ts >= ? GROUP BY provider, operation, model
         ORDER BY cost DESC`).all(since) as any[];
      const daily = db.prepare(
        `SELECT date(ts) day, provider, SUM(cost_usd) cost
         FROM api_spend WHERE ts >= ? GROUP BY day, provider ORDER BY day ASC`).all(since) as any[];
      const total = totals.reduce((a, r) => a + (r.cost || 0), 0);
      const first = db.prepare('SELECT MIN(ts) m FROM api_spend').get() as any;

      // Projected from the observed daily average, not extrapolated from a single day.
      const daysObserved = Math.max(1, new Set(daily.map(d => d.day)).size);
      res.json({
        days, since, total,
        projectedMonthly: (total / daysObserved) * 30,
        daysObserved,
        trackingSince: first?.m ?? null,
        totals, daily,
        rates: { x: X_RATES, models: MODEL_RATES },
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return { router, recordSpend, getScoringWeights };
}
