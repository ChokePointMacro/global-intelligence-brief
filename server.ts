import express from "express";
import { createServer as createViteServer } from "vite";
import session from "express-session";
// cookie-parser not needed — express-session handles cookies directly
// import cookieParser from "cookie-parser";
import SQLiteStoreFactory from "connect-sqlite3";
import { TwitterApi } from "twitter-api-v2";
import nodemailer from "nodemailer";
import bcrypt from "bcryptjs";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import crypto from "crypto";
import db from "./db.ts";
import dotenv from "dotenv";
import path from "path";
import { generateWeeklyReport, generateInstagramCaption, generateSubstackArticle, generateForecastReport, generateSpeculationReport, type WeeklyReport } from "./src/services/geminiService.ts";
import { rateLimits as aiRateLimits, onAISpend, setSpendGuard } from "./src/services/aiService.ts";
import { log, errInfo, installProcessHandlers } from "./src/services/log.ts";
import { aiSpend, xSpend } from "./src/services/spend.ts";
import {
  etParts, etToUtc, etMinutesOfDay, etDateString, parseHhMm,
  nextEtWeekdayMidnight, normaliseScheduledAt, parseSqliteUtc,
} from "./src/services/time.ts";
import { backupDatabase } from "./src/services/backup.ts";
import { createAnalytics } from "./src/server/analytics.ts";
import { createMarketsRouter } from "./src/server/markets.ts";
import { createPostQueueRouter } from "./src/server/postQueue.ts";

import fs from "fs";

dotenv.config();

const app = express();
// 3000 by default. Overridable so a throwaway instance can be booted against a copy of
// the database (with posting disabled) to exercise the publisher without touching the
// real one — the OAuth redirect already follows whatever loopback port you browse.
const PORT = Number(process.env.PORT) || 3000;

// ─── Connection Rate Limit Tracker ────────────────────────────────────────────

interface RateLimitSnapshot {
  limitRequests?: number;
  limitTokens?: number;
  remainingRequests?: number;
  remainingTokens?: number;
  resetRequests?: string;
  resetTokens?: string;
  inputTokensUsed?: number;
  outputTokensUsed?: number;
  lastCallAt?: string;
  lastModel?: string;
  lastError?: string;
}

const connectionTracker: Record<string, RateLimitSnapshot> = {
  anthropic: {},
  gemini: {},
  x: {},
  public: {},
};

// ─── Startup Security Checks ───────────────────────────────────────────────────

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === 'gib-secret') {
  console.warn("⚠️  SESSION_SECRET is not set or uses the insecure default. Set a strong random secret in .env");
}

// Normalize APP_URL
if (process.env.APP_URL && process.env.APP_URL.endsWith('/')) {
  process.env.APP_URL = process.env.APP_URL.slice(0, -1);
}

if (!fs.existsSync("./sessions")) {
  fs.mkdirSync("./sessions");
}

const SQLiteStore = (SQLiteStoreFactory as any)(session);

app.set('trust proxy', 1);

// ─── Security Headers (Helmet) ─────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false, // Vite dev server injects inline scripts; configure per env if needed
  crossOriginEmbedderPolicy: false,
}));

// ─── Body size limit ───────────────────────────────────────────────────────────
app.use(express.json({ limit: '100kb' }));

// ─── Rate Limiters ─────────────────────────────────────────────────────────────

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Please wait 15 minutes before trying again." },
});

const reportGenLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Report generation rate limit exceeded. Please wait before generating more reports." },
});

const postLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Posting rate limit exceeded. Please wait before posting again." },
});

const emailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Email rate limit exceeded. Maximum 5 emails per hour." },
});

// ─── Local single-user mode ────────────────────────────────────────────────────
// This runs only on the owner's machine as the posting/automation engine. There is
// no multi-user story and it is never forward-facing, so the login gate is bypassed
// and every request runs as the owner. Two things keep that safe: the server binds
// to loopback only (see app.listen), and LOCAL_MODE=false in .env restores the gate.
const LOCAL_MODE = process.env.LOCAL_MODE !== 'false';
const LOCAL_USER_ID = process.env.LOCAL_USER_ID || 'm@aol.com';

if (LOCAL_MODE) {
  // The X token row is keyed by user_id, so the owner row must exist for the
  // connect flow and /api/auth/me to have something to join against.
  const owner = db.prepare("SELECT id FROM users WHERE email = ?").get(LOCAL_USER_ID) as any;
  if (!owner) {
    db.prepare("INSERT INTO users (email, username, display_name) VALUES (?, ?, ?)")
      .run(LOCAL_USER_ID, LOCAL_USER_ID.split('@')[0], 'Operator');
    console.log(`[local-mode] created owner row for ${LOCAL_USER_ID}`);
  }
  console.log(`[local-mode] auth bypassed — every request runs as ${LOCAL_USER_ID}`);
}

// ─── Auth Middleware ───────────────────────────────────────────────────────────

const requireAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (LOCAL_MODE) return next();
  if (!(req.session as any).userId) return res.status(401).json({ error: "Not authenticated" });
  next();
};

// Session ID header bypass for iframe cookie issues
app.use((req, res, next) => {
  const headerSid = req.headers['x-session-id'];
  if (headerSid && typeof headerSid === 'string') {
    if (!req.headers.cookie || !req.headers.cookie.includes('gib.sid')) {
      req.headers.cookie = `gib.sid=${headerSid}; ${req.headers.cookie || ''}`;
    }
  }
  next();
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use(
  session({
    store: new SQLiteStore({ dir: './sessions', db: 'sessions.sqlite' }),
    secret: process.env.SESSION_SECRET || "gib-secret",
    resave: false,
    saveUninitialized: false,
    rolling: true,
    proxy: true,
    name: 'gib.sid',
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? "none" : "lax",
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  })
);

// Local mode: stamp every request as the owner. Downstream code reads the user off
// the session, so setting it here means the X connect flow, posting, and scheduling
// all keep working unchanged instead of needing an auth refactor.
app.use((req, _res, next) => {
  if (LOCAL_MODE && (req.session as any).userId !== LOCAL_USER_ID) {
    (req.session as any).userId = LOCAL_USER_ID;
  }
  next();
});

// Reduced logging verbosity - usually only needed in dev or for errors
app.use((req, res, next) => {
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  }
  next();
});

// ─── Platform credential helpers ───────────────────────────────────────────────

const CRED_ENV_MAP: Record<string, Record<string, string>> = {
  x:         { client_id: 'X_CLIENT_ID',       client_secret: 'X_CLIENT_SECRET'       },
  instagram: { app_id:    'INSTAGRAM_APP_ID',   app_secret:    'INSTAGRAM_APP_SECRET'  },
  linkedin:  { client_id: 'LINKEDIN_CLIENT_ID', client_secret: 'LINKEDIN_CLIENT_SECRET'},
  threads:   { app_id:    'THREADS_APP_ID',     app_secret:    'THREADS_APP_SECRET'    },
};

function getPlatformCred(platform: string, key: string): string {
  const row = db.prepare("SELECT key_value FROM platform_credentials WHERE platform = ? AND key_name = ?").get(platform, key) as any;
  if (row?.key_value) return row.key_value;
  const envKey = CRED_ENV_MAP[platform]?.[key];
  return envKey ? (process.env[envKey] || '') : '';
}

function hasValidCreds(platform: string): boolean {
  if (platform === 'x') {
    const id = getPlatformCred('x', 'client_id');
    const sec = getPlatformCred('x', 'client_secret');
    // A secret is optional: X "Native App" / "Single page App" types are public
    // clients that have no secret at all and authenticate with PKCE alone.
    if (!id || id.includes('dummy')) return false;
    return !sec || !sec.includes('dummy');
  }
  if (platform === 'instagram') return !!(getPlatformCred('instagram', 'app_id') && getPlatformCred('instagram', 'app_secret'));
  if (platform === 'linkedin')  return !!(getPlatformCred('linkedin',  'client_id') && getPlatformCred('linkedin',  'client_secret'));
  if (platform === 'threads')   return !!(getPlatformCred('threads',   'app_id')    && getPlatformCred('threads',   'app_secret'));
  return false;
}

function getXClient(): TwitterApi {
  const clientId = getPlatformCred('x', 'client_id');
  const clientSecret = getPlatformCred('x', 'client_secret');
  // Passing a clientSecret makes twitter-api-v2 send a Basic auth header. X rejects
  // that outright for public clients (Native / SPA app types), which have no secret
  // and authenticate with PKCE alone — so omit it entirely when none is configured.
  return clientSecret ? new TwitterApi({ clientId, clientSecret }) : new TwitterApi({ clientId });
}

// X Premium allows long-form posts (25,000 chars); the free tier is capped at 280.
// This is only a sanity bound — X itself is the real authority and will reject an
// over-length post with a clear error. Set X_MAX_POST_CHARS=280 to enforce free-tier.
const X_MAX_POST_CHARS = Number(process.env.X_MAX_POST_CHARS) || 25000;

// Cite sources as a reply to the post rather than inside it. X reduces reach ~30-50% on
// posts containing external links, so the body stays clean and the citation goes one level
// down. Costs one extra API post per tweet (a link post is billed higher than a plain one),
// which is why this is opt-in: set POST_SOURCE_AS_REPLY=true in .env to enable.
const POST_SOURCE_AS_REPLY = process.env.POST_SOURCE_AS_REPLY === 'true';

// ─── Publisher safety rails ────────────────────────────────────────────────────
// This posts to a live public account on a timer and each post costs money, so the
// scheduler needs bounds.
const POSTING_DRY_RUN = process.env.POSTING_DRY_RUN === 'true';    // log, never send
const MAX_POSTS_PER_RUN = Number(process.env.MAX_POSTS_PER_RUN) || 5;
const CLAIM_TIMEOUT_MIN = Number(process.env.POST_CLAIM_TIMEOUT_MIN) || 10;

// How late a slot may fire. Past this, the post is skipped rather than published.
//
// Without this bound the due-query is an open-ended backward window: every pending
// row whose scheduled_at is in the past qualifies, oldest first. Sleep the laptop over
// a weekend and the whole backlog publishes at MAX_POSTS_PER_RUN/minute on wake —
// stalest market commentary first, which is both wrong and a good way to get flagged.
// Losing a slot is recoverable; publishing Friday's "what matters today" on Monday is not.
const MAX_SLOT_LATENESS_MIN = Number(process.env.POST_MAX_LATE_MIN) || 30;

// A report generation may still catch up later in the day — a brief is not as
// perishable as a market post, and regenerating uses live data anyway.
const MAX_REPORT_LATENESS_MIN = Number(process.env.REPORT_MAX_LATE_MIN) || 360;

/**
 * Posting kill switch — DB-backed so it can be flipped without a restart.
 *
 * Deliberately FAIL-CLOSED: with nothing configured, posting is OFF. The previous
 * default was fail-open (`!== 'false'`), meaning a fresh checkout, a lost .env, or a
 * typo in the variable name all resulted in a live account posting on a timer. For an
 * irreversible, public, billable action the safe default is silence.
 *
 * Resolution order: app_settings.posting_enabled (UI toggle) → POSTING_ENABLED env → off.
 */
function isPostingEnabled(): boolean {
  try {
    const row = db.prepare("SELECT value FROM app_settings WHERE key = 'posting_enabled'").get() as any;
    if (row?.value != null) return row.value === 'true' || row.value === '1';
  } catch (err) {
    // A DB read failure must not be interpreted as consent to post.
    log.warn('posting_toggle_read_failed', errInfo(err));
    return false;
  }
  return process.env.POSTING_ENABLED === 'true';
}

/**
 * Out-of-band notification for things the operator must know about but would never
 * see in a terminal: a skipped slot, a tripped spend cap, a failed publish.
 *
 * Email because that is the only channel this app already has configured. The build
 * plan's Tailscale/Telegram approval path lands in a later phase; until then this is
 * the honest ceiling — if SMTP isn't configured it logs loudly and nothing more.
 */
async function notifyOps(subject: string, body: string): Promise<void> {
  log.warn('ops_notify', { subject, body: body.slice(0, 500) });

  const to = (() => {
    try {
      const row = db.prepare("SELECT value FROM app_settings WHERE key = 'digest_email'").get() as any;
      return row?.value || null;
    } catch { return null; }
  })();

  if (!to || !process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    log.warn('ops_notify_undeliverable', { reason: 'no digest_email or SMTP not configured', subject });
    return;
  }

  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_PORT === '465',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject: `[ChokePoint Macro] ${subject}`,
      text: body,
    });
  } catch (err) {
    // Never let a failed notification break the task that raised it.
    log.error('ops_notify_failed', { subject, ...errInfo(err) });
  }
}



/**
 * Token exchange against X, handling BOTH OAuth2 client types.
 *
 * twitter-api-v2 can't do the public-client flow: with no clientSecret it sends no
 * Authorization header AND a `client_secret: undefined` field, which is just a
 * malformed request. So we issue the request ourselves.
 *
 *  - Confidential client (Web App / Automated App / Bot): HTTP Basic clientId:clientSecret.
 *  - Public client (Native App / Single page App): no Basic header, client_id in the
 *    body, PKCE alone proves the caller. X issues no secret for these at all.
 */
async function xTokenRequest(params: Record<string, string>): Promise<any> {
  const clientId = getPlatformCred('x', 'client_id');
  const clientSecret = getPlatformCred('x', 'client_secret');

  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
  const body = new URLSearchParams({ ...params, client_id: clientId });
  if (clientSecret) {
    headers.Authorization = 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  }

  const resp = await fetch('https://api.x.com/2/oauth2/token', { method: 'POST', headers, body });
  const text = await resp.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }

  if (!resp.ok) {
    const mode = clientSecret ? 'confidential' : 'public';
    throw new Error(`X token request failed (${resp.status}, ${mode} client): ${json.error || ''} ${json.error_description || text.slice(0, 200)}`);
  }
  return json;
}

if (!hasValidCreds('x')) {
  console.warn("⚠️  X credentials not configured — set them in Settings → Connected Networks.");
}

// ─── Auth helpers ──────────────────────────────────────────────────────────────

// Only ever trusted for loopback hosts — never let a spoofed Host header steer
// the OAuth redirect on a real deployment.
const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|::1)(:\d+)?$/;

const getAppOrigin = (req: express.Request): string => {
  const host = req.headers.host || '';
  // Local dev: use the host we were actually reached on, so the OAuth redirect
  // follows whatever port/hostname you happen to be browsing. Each variant still
  // has to be registered as a callback URL in the X developer portal.
  if (LOOPBACK_HOST.test(host)) return `http://${host}`;
  if (process.env.APP_URL) return process.env.APP_URL;
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  return `${protocol}://${host}`;
};

const getRedirectUri = (req: express.Request, platform = 'x') => {
  return `${getAppOrigin(req)}/auth/${platform}/callback`;
};

// ─── X Auth Routes ─────────────────────────────────────────────────────────────

app.get("/api/auth/x/url", (req, res) => {
  if (!hasValidCreds('x')) {
    return res.status(503).json({ error: "X OAuth credentials not configured", needsConfig: true, platform: 'x' });
  }
  try {
    const redirectUri = getRedirectUri(req, 'x');
    const { url, codeVerifier, state } = getXClient().generateOAuth2AuthLink(
      redirectUri,
      { scope: ["tweet.read", "tweet.write", "users.read", "offline.access"] }
    );
    (req.session as any).codeVerifier = codeVerifier;
    (req.session as any).state = state;
    db.prepare("INSERT OR REPLACE INTO pending_auth (state, code_verifier, platform) VALUES (?, ?, 'x')").run(state, codeVerifier);
    req.session.save((err) => {
      if (err) console.error("Session save error in /url:", err);
      res.json({ url });
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to generate auth link", details: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/auth/x/callback", async (req, res) => {
  const { state, code } = req.query;
  let codeVerifier: string | undefined;

  if (state) {
    const pending = db.prepare("SELECT code_verifier FROM pending_auth WHERE state = ? AND platform = 'x'").get(state) as any;
    if (pending) {
      codeVerifier = pending.code_verifier;
      db.prepare("DELETE FROM pending_auth WHERE state = ?").run(state);
    }
  }

  if (!codeVerifier) codeVerifier = (req.session as any).codeVerifier;
  if (!codeVerifier || !code) {
    return res.status(400).send("Invalid session - please try connecting again.");
  }

  try {
    const redirectUri = getRedirectUri(req, 'x');
    const { client: loggedClient, accessToken, refreshToken, expiresIn } = await getXClient().loginWithOAuth2({
      code: code as string,
      codeVerifier,
      redirectUri,
    });

    const { data: userObject } = await loggedClient.v2.me({
      "user.fields": ["profile_image_url", "username", "name"],
    });

    const expiresAt = Date.now() + (expiresIn || 0) * 1000;
    db.prepare(`
      INSERT INTO users (x_id, username, display_name, profile_image, access_token, refresh_token, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(x_id) DO UPDATE SET
        username = excluded.username,
        display_name = excluded.display_name,
        profile_image = excluded.profile_image,
        access_token = excluded.access_token,
        refresh_token = excluded.refresh_token,
        expires_at = excluded.expires_at
    `).run(userObject.id, userObject.username, userObject.name, userObject.profile_image_url || "", accessToken, refreshToken || "", expiresAt);

    (req.session as any).userId = userObject.id;

    req.session.save((err) => {
      if (err) console.error("Session save error:", err);
      const sid = JSON.stringify(req.sessionID);
      const origin = JSON.stringify(getAppOrigin(req));
      res.send(`<html><body><script>
        if (window.opener) {
          window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', sessionId: ${sid} }, ${origin});
          window.close();
        } else { window.location.href = '/'; }
      </script></body></html>`);
    });
  } catch (error) {
    console.error("X auth failed:", error);
    res.status(500).send("Auth failed");
  }
});

app.get("/api/auth/me", (req, res) => {
  const userId = (req.session as any).userId;
  if (!userId) return res.status(401).json({ error: "Not authenticated", sessionId: req.sessionID });
  // userId is either an x_id (X OAuth) or email (email/password)
  const user = db.prepare("SELECT * FROM users WHERE x_id = ? OR email = ?").get(userId, userId) as any;
  if (!user) return res.status(401).json({ error: "User not found", sessionId: req.sessionID });
  res.json({
    id: user.x_id || user.email,
    username: user.username || user.email,
    displayName: user.display_name,
    profileImage: user.profile_image || null,
    authMethod: user.x_id ? 'x' : 'email',
    sessionId: req.sessionID,
  });
});

// ─── Email / Password Auth ──────────────────────────────────────────────────

app.post("/api/auth/register", authLimiter, async (req, res) => {
  const { email, password, displayName } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email and password required" });
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });

  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email) as any;
  if (existing) return res.status(409).json({ error: "An account with this email already exists" });

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const result = db.prepare(`
      INSERT INTO users (email, password_hash, username, display_name)
      VALUES (?, ?, ?, ?)
    `).run(email, passwordHash, email.split('@')[0], displayName || email.split('@')[0]);

    (req.session as any).userId = email;
    req.session.save((err) => {
      if (err) console.error("Session save error:", err);
      res.json({ success: true, id: result.lastInsertRowid, sessionId: req.sessionID });
    });
  } catch (error) {
    console.error("[register] Error:", error);
    res.status(500).json({ error: "Registration failed" });
  }
});

app.post("/api/auth/login", authLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email and password required" });

  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email) as any;
  if (!user || !user.password_hash) return res.status(401).json({ error: "Invalid email or password" });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: "Invalid email or password" });

  (req.session as any).userId = email;
  req.session.save((err) => {
    if (err) console.error("Session save error:", err);
    res.json({ success: true, displayName: user.display_name, sessionId: req.sessionID });
  });
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// ─── Platform Credential Management ────────────────────────────────────────────

const PLATFORM_KEYS: Record<string, string[]> = {
  x:         ['client_id', 'client_secret'],
  instagram: ['app_id', 'app_secret'],
  linkedin:  ['client_id', 'client_secret'],
  threads:   ['app_id', 'app_secret'],
};

// Keys that may legitimately be left blank. X public clients (Native / SPA app types)
// have no client secret at all, so requiring one made those apps impossible to configure.
// Submitting a blank value clears the stored override rather than saving an empty string.
const OPTIONAL_CRED_KEYS: Record<string, string[]> = {
  x: ['client_secret'],
};

// Returns which platforms are configured (never returns actual values)
app.get("/api/platform-credentials", requireAuth, (req, res) => {
  const status: Record<string, { configured: boolean; keys: string[] }> = {};
  for (const [platform, keys] of Object.entries(PLATFORM_KEYS)) {
    status[platform] = { configured: hasValidCreds(platform), keys };
  }
  res.json(status);
});

// Save credentials for a platform
app.post("/api/platform-credentials/:platform", requireAuth, (req, res) => {
  const { platform } = req.params;
  if (!PLATFORM_KEYS[platform]) return res.status(400).json({ error: "Unknown platform" });
  const { credentials } = req.body;
  if (!credentials || typeof credentials !== 'object') return res.status(400).json({ error: "credentials object required" });

  const requiredKeys = PLATFORM_KEYS[platform];
  const optionalKeys = OPTIONAL_CRED_KEYS[platform] || [];
  for (const key of requiredKeys) {
    if (optionalKeys.includes(key)) continue;
    if (!credentials[key]?.trim()) return res.status(400).json({ error: `Missing required field: ${key}` });
  }

  for (const key of requiredKeys) {
    const value = credentials[key]?.trim() || '';
    if (!value) {
      // Blank optional key — drop the override so lookups fall through to .env / public-client mode.
      db.prepare("DELETE FROM platform_credentials WHERE platform = ? AND key_name = ?").run(platform, key);
      continue;
    }
    db.prepare(`
      INSERT INTO platform_credentials (platform, key_name, key_value, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(platform, key_name) DO UPDATE SET key_value = excluded.key_value, updated_at = CURRENT_TIMESTAMP
    `).run(platform, key, value);
  }

  res.json({ success: true, configured: hasValidCreds(platform) });
});

// Clear credentials for a platform
app.delete("/api/platform-credentials/:platform", requireAuth, (req, res) => {
  const { platform } = req.params;
  if (!PLATFORM_KEYS[platform]) return res.status(400).json({ error: "Unknown platform" });
  db.prepare("DELETE FROM platform_credentials WHERE platform = ?").run(platform);
  res.json({ success: true });
});

// Test credentials by attempting to generate an OAuth URL
app.get("/api/platform-credentials/:platform/test", requireAuth, async (req, res) => {
  const { platform } = req.params;
  if (!hasValidCreds(platform)) return res.json({ ok: false, error: "Credentials not saved" });
  try {
    if (platform === 'x') {
      // This used to call generateOAuth2AuthLink, which is pure local string building and
      // makes no network request — it returned ok:true against completely dead credentials.
      // Do a real round trip instead: refresh if near expiry, then hit the API.
      const tokenRecord = getXTokenRecord((req.session as any).userId);
      if (!tokenRecord?.access_token) {
        return res.json({ ok: false, error: "Credentials saved, but no X account connected yet — click Connect." });
      }
      const accessToken = await refreshXToken(tokenRecord);
      const me = await new TwitterApi(accessToken).v2.me();
      return res.json({ ok: true, handle: `@${me.data.username}` });
    }
    if (platform === 'linkedin') {
      const clientId = getPlatformCred('linkedin', 'client_id');
      if (clientId.length < 5) throw new Error("Client ID too short");
      return res.json({ ok: true });
    }
    if (platform === 'instagram' || platform === 'threads') {
      const appId = getPlatformCred(platform, 'app_id');
      if (appId.length < 5) throw new Error("App ID too short");
      return res.json({ ok: true });
    }
    res.json({ ok: false, error: "Unknown platform" });
  } catch (err) {
    res.json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.patch("/api/auth/profile", requireAuth, (req, res) => {
  const userId = (req.session as any).userId;
  const { displayName } = req.body;
  if (!displayName?.trim()) return res.status(400).json({ error: "Display name required" });
  if (displayName.length > 50) return res.status(400).json({ error: "Display name too long (max 50 chars)" });
  const sanitized = displayName.trim().replace(/<[^>]*>/g, '');
  db.prepare("UPDATE users SET display_name = ? WHERE x_id = ? OR email = ?").run(sanitized, userId, userId);
  res.json({ success: true, displayName: sanitized });
});

app.post("/api/auth/change-password", requireAuth, authLimiter, async (req, res) => {
  const userId = (req.session as any).userId;
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: "Both passwords required" });
  if (newPassword.length < 8) return res.status(400).json({ error: "New password must be at least 8 characters" });
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(userId) as any;
  if (!user?.password_hash) return res.status(400).json({ error: "Password change not available for X-login accounts" });
  const valid = await bcrypt.compare(currentPassword, user.password_hash);
  if (!valid) return res.status(401).json({ error: "Current password is incorrect" });
  const newHash = await bcrypt.hash(newPassword, 12);
  db.prepare("UPDATE users SET password_hash = ? WHERE email = ?").run(newHash, userId);
  res.json({ success: true });
});

// ─── LinkedIn OAuth ────────────────────────────────────────────────────────────

app.get("/api/auth/linkedin/url", (req, res) => {
  if (!hasValidCreds('linkedin')) return res.status(503).json({ error: "LinkedIn not configured", needsConfig: true, platform: 'linkedin' });
  const clientId = getPlatformCred('linkedin', 'client_id');

  const state = crypto.randomBytes(16).toString('hex');
  const redirectUri = getRedirectUri(req, 'linkedin');
  db.prepare("INSERT OR REPLACE INTO pending_auth (state, code_verifier, platform) VALUES (?, '', 'linkedin')").run(state);

  const url = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=openid%20profile%20w_member_social&state=${state}`;
  res.json({ url });
});

app.get("/auth/linkedin/callback", async (req, res) => {
  const { code, state } = req.query;
  const userId = (req.session as any).userId;

  if (!userId) return res.status(401).send("You must be logged in to connect LinkedIn");
  if (!code || !state) return res.status(400).send("Missing code or state");

  const pending = db.prepare("SELECT state FROM pending_auth WHERE state = ? AND platform = 'linkedin'").get(state) as any;
  if (!pending) return res.status(400).send("Invalid state");
  db.prepare("DELETE FROM pending_auth WHERE state = ?").run(state);

  try {
    const redirectUri = getRedirectUri(req, 'linkedin');
    const tokenRes = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: code as string,
        redirect_uri: redirectUri,
        client_id: getPlatformCred('linkedin', 'client_id'),
        client_secret: getPlatformCred('linkedin', 'client_secret'),
      }),
    });
    const tokenData = await tokenRes.json() as any;
    if (!tokenData.access_token) throw new Error("No access token returned");

    // Get user info
    const userRes = await fetch("https://api.linkedin.com/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const userInfo = await userRes.json() as any;

    db.prepare(`
      INSERT INTO platform_tokens (user_id, platform, access_token, handle, person_urn, expires_at)
      VALUES (?, 'linkedin', ?, ?, ?, ?)
      ON CONFLICT(user_id, platform) DO UPDATE SET
        access_token = excluded.access_token,
        handle = excluded.handle,
        person_urn = excluded.person_urn,
        expires_at = excluded.expires_at,
        updated_at = CURRENT_TIMESTAMP
    `).run(userId, tokenData.access_token, userInfo.name || '', userInfo.sub || '', Date.now() + (tokenData.expires_in || 3600) * 1000);

    const origin = JSON.stringify(getAppOrigin(req));
    res.send(`<html><body><script>
      if (window.opener) { window.opener.postMessage({ type: 'OAUTH_LINKEDIN_SUCCESS' }, ${origin}); window.close(); }
      else { window.location.href = '/settings'; }
    </script></body></html>`);
  } catch (error) {
    console.error("LinkedIn auth failed:", error);
    res.status(500).send("LinkedIn auth failed");
  }
});

// ─── Threads OAuth ─────────────────────────────────────────────────────────────

app.get("/api/auth/threads/url", (req, res) => {
  if (!hasValidCreds('threads')) return res.status(503).json({ error: "Threads not configured", needsConfig: true, platform: 'threads' });
  const appId = getPlatformCred('threads', 'app_id');

  const state = crypto.randomBytes(16).toString('hex');
  const redirectUri = getRedirectUri(req, 'threads');
  db.prepare("INSERT OR REPLACE INTO pending_auth (state, code_verifier, platform) VALUES (?, '', 'threads')").run(state);

  const url = `https://www.threads.net/oauth/authorize?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=threads_basic,threads_content_publish&response_type=code&state=${state}`;
  res.json({ url });
});

app.get("/auth/threads/callback", async (req, res) => {
  const { code, state } = req.query;
  const userId = (req.session as any).userId;

  if (!userId) return res.status(401).send("You must be logged in to connect Threads");
  if (!code || !state) return res.status(400).send("Missing code or state");

  const pending = db.prepare("SELECT state FROM pending_auth WHERE state = ? AND platform = 'threads'").get(state) as any;
  if (!pending) return res.status(400).send("Invalid state");
  db.prepare("DELETE FROM pending_auth WHERE state = ?").run(state);

  try {
    const redirectUri = getRedirectUri(req, 'threads');
    const tokenRes = await fetch("https://graph.threads.net/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: getPlatformCred('threads', 'app_id'),
        client_secret: getPlatformCred('threads', 'app_secret'),
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        code: code as string,
      }),
    });
    const tokenData = await tokenRes.json() as any;
    if (!tokenData.access_token) throw new Error("No access token");

    // Get user ID
    const userRes = await fetch(`https://graph.threads.net/v1.0/me?fields=id,username&access_token=${tokenData.access_token}`);
    const userInfo = await userRes.json() as any;

    db.prepare(`
      INSERT INTO platform_tokens (user_id, platform, access_token, handle, person_urn)
      VALUES (?, 'threads', ?, ?, ?)
      ON CONFLICT(user_id, platform) DO UPDATE SET
        access_token = excluded.access_token,
        handle = excluded.handle,
        person_urn = excluded.person_urn,
        updated_at = CURRENT_TIMESTAMP
    `).run(userId, tokenData.access_token, userInfo.username || '', userInfo.id || '');

    const origin = JSON.stringify(getAppOrigin(req));
    res.send(`<html><body><script>
      if (window.opener) { window.opener.postMessage({ type: 'OAUTH_THREADS_SUCCESS' }, ${origin}); window.close(); }
      else { window.location.href = '/settings'; }
    </script></body></html>`);
  } catch (error) {
    console.error("Threads auth failed:", error);
    res.status(500).send("Threads auth failed");
  }
});

// ─── X Connect (link X to an email-auth'd user) ────────────────────────────────

app.get("/api/auth/x/connect/url", (req, res) => {
  const userId = (req.session as any).userId;
  if (!userId) return res.status(401).json({ error: "Must be logged in to connect X" });
  if (!hasValidCreds('x')) return res.status(503).json({ error: "X OAuth credentials not configured", needsConfig: true, platform: 'x' });

  try {
    const redirectUri = getRedirectUri(req, 'x/connect');
    const { url, codeVerifier, state } = getXClient().generateOAuth2AuthLink(
      redirectUri,
      { scope: ["tweet.read", "tweet.write", "users.read", "offline.access"] }
    );
    db.prepare("INSERT OR REPLACE INTO pending_auth (state, code_verifier, platform) VALUES (?, ?, 'x_connect')").run(state, codeVerifier);
    req.session.save((err) => {
      if (err) console.error("Session save error:", err);
      res.json({ url });
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to generate X auth link", details: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/auth/x/connect/callback", async (req, res) => {
  const { state, code } = req.query;
  const userId = (req.session as any).userId;

  const pending = db.prepare("SELECT code_verifier FROM pending_auth WHERE state = ? AND platform = 'x_connect'").get(state) as any;
  if (!pending || !code) return res.status(400).send("Invalid state or missing code. Please try again.");
  // No session here means the callback landed on a different hostname than the one
  // the flow started on (localhost vs 127.0.0.1 have separate cookie jars). Filing the
  // token under 'anonymous' would look like success but leave posting broken, so stop.
  if (!userId) return res.status(401).send("Session lost during the X handshake — start Connect from the same hostname you're signed in on, then try again.");
  db.prepare("DELETE FROM pending_auth WHERE state = ?").run(state);

  try {
    const redirectUri = getRedirectUri(req, 'x/connect');
    const tok = await xTokenRequest({
      grant_type: 'authorization_code',
      code: code as string,
      code_verifier: pending.code_verifier,
      redirect_uri: redirectUri,
    });
    const accessToken: string = tok.access_token;
    const refreshToken: string | undefined = tok.refresh_token;
    const expiresIn: number = tok.expires_in;
    console.log(`[x-connect] token OK — scopes: ${tok.scope} | refresh_token: ${refreshToken ? 'yes' : 'NO'}`);

    const loggedClient = new TwitterApi(accessToken);
    const { data: xUser } = await loggedClient.v2.me({ "user.fields": ["profile_image_url", "username", "name"] });

    const expiresAt = Date.now() + (expiresIn || 0) * 1000;
    db.prepare(`
      INSERT INTO platform_tokens (user_id, platform, access_token, refresh_token, handle, expires_at)
      VALUES (?, 'x', ?, ?, ?, ?)
      ON CONFLICT(user_id, platform) DO UPDATE SET
        access_token = excluded.access_token,
        refresh_token = excluded.refresh_token,
        handle = excluded.handle,
        expires_at = excluded.expires_at,
        updated_at = CURRENT_TIMESTAMP
    `).run(userId, accessToken, refreshToken || '', `@${xUser.username}`, expiresAt);

    const xHandle = JSON.stringify('@' + xUser.username);
    const origin = JSON.stringify(getAppOrigin(req));
    res.send(`<html><body><script>
      if (window.opener) {
        window.opener.postMessage({ type: 'OAUTH_X_CONNECT_SUCCESS', handle: ${xHandle} }, ${origin});
        window.close();
      } else { window.location.href = '/settings'; }
    </script></body></html>`);
  } catch (error) {
    console.error("X connect failed:", error);
    res.status(500).send("X connect failed: " + (error instanceof Error ? error.message : String(error)));
  }
});

// ─── Instagram OAuth (Facebook Graph API) ──────────────────────────────────────

app.get("/api/auth/instagram/url", (req, res) => {
  const userId = (req.session as any).userId;
  if (!userId) return res.status(401).json({ error: "Must be logged in to connect Instagram" });
  if (!hasValidCreds('instagram')) return res.status(503).json({ error: "Instagram not configured", needsConfig: true, platform: 'instagram' });
  const appId = getPlatformCred('instagram', 'app_id');

  const state = crypto.randomBytes(16).toString('hex');
  const redirectUri = getRedirectUri(req, 'instagram');
  db.prepare("INSERT OR REPLACE INTO pending_auth (state, code_verifier, platform) VALUES (?, '', 'instagram')").run(state);

  const url = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=instagram_basic,pages_show_list,instagram_content_publish,business_management&response_type=code&state=${state}`;
  res.json({ url });
});

app.get("/auth/instagram/callback", async (req, res) => {
  const { code, state } = req.query;
  const userId = (req.session as any).userId;

  if (!code || !state) return res.status(400).send("Missing code or state");
  const pending = db.prepare("SELECT state FROM pending_auth WHERE state = ? AND platform = 'instagram'").get(state) as any;
  if (!pending) return res.status(400).send("Invalid state — please try connecting again");
  db.prepare("DELETE FROM pending_auth WHERE state = ?").run(state);

  try {
    const redirectUri = getRedirectUri(req, 'instagram');

    // Exchange code for short-lived token
    const igAppId = getPlatformCred('instagram', 'app_id');
    const igAppSecret = getPlatformCred('instagram', 'app_secret');
    const tokenUrl = `https://graph.facebook.com/v18.0/oauth/access_token?client_id=${igAppId}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${igAppSecret}&code=${code}`;
    const tokenRes = await fetch(tokenUrl);
    const tokenData = await tokenRes.json() as any;
    if (!tokenData.access_token) throw new Error(`Token exchange failed: ${JSON.stringify(tokenData)}`);

    // Exchange for long-lived token (60 days)
    const llUrl = `https://graph.facebook.com/oauth/access_token?grant_type=fb_exchange_token&client_id=${igAppId}&client_secret=${igAppSecret}&fb_exchange_token=${tokenData.access_token}`;
    const llRes = await fetch(llUrl);
    const llData = await llRes.json() as any;
    const longToken = llData.access_token || tokenData.access_token;

    // Find Instagram Business/Creator account via Facebook Pages
    let igUserId = '';
    let igUsername = '';
    let pageToken = longToken;

    const pagesRes = await fetch(`https://graph.facebook.com/v18.0/me/accounts?access_token=${longToken}`);
    const pagesData = await pagesRes.json() as any;

    if (pagesData.data?.length > 0) {
      for (const page of pagesData.data) {
        const igRes = await fetch(`https://graph.facebook.com/v18.0/${page.id}?fields=instagram_business_account&access_token=${page.access_token}`);
        const igData = await igRes.json() as any;
        if (igData.instagram_business_account?.id) {
          igUserId = igData.instagram_business_account.id;
          pageToken = page.access_token;
          const usernameRes = await fetch(`https://graph.facebook.com/v18.0/${igUserId}?fields=username&access_token=${pageToken}`);
          const usernameData = await usernameRes.json() as any;
          igUsername = usernameData.username || igUserId;
          break;
        }
      }
    }

    // Fallback: get Facebook user name if no IG business account found
    if (!igUsername) {
      const meRes = await fetch(`https://graph.facebook.com/v18.0/me?fields=id,name&access_token=${longToken}`);
      const meData = await meRes.json() as any;
      igUsername = meData.name || 'Facebook User';
    }

    db.prepare(`
      INSERT INTO platform_tokens (user_id, platform, access_token, handle, person_urn)
      VALUES (?, 'instagram', ?, ?, ?)
      ON CONFLICT(user_id, platform) DO UPDATE SET
        access_token = excluded.access_token,
        handle = excluded.handle,
        person_urn = excluded.person_urn,
        updated_at = CURRENT_TIMESTAMP
    `).run(userId, pageToken, igUsername, igUserId);

    const displayHandle = igUserId ? `@${igUsername}` : igUsername;
    const igHandleJson = JSON.stringify(displayHandle);
    const origin = JSON.stringify(getAppOrigin(req));
    res.send(`<html><body><script>
      if (window.opener) {
        window.opener.postMessage({ type: 'OAUTH_INSTAGRAM_SUCCESS', handle: ${igHandleJson} }, ${origin});
        window.close();
      } else { window.location.href = '/settings'; }
    </script></body></html>`);
  } catch (error) {
    console.error("Instagram auth failed:", error);
    res.status(500).send("Instagram auth failed: " + (error instanceof Error ? error.message : String(error)));
  }
});

// ─── Social accounts ───────────────────────────────────────────────────────────

app.get("/api/social/accounts", (req, res) => {
  const userId = (req.session as any).userId;
  if (!userId) return res.json({ accounts: [] });
  const accounts = db.prepare("SELECT platform, handle FROM platform_tokens WHERE user_id = ?").all(userId) as any[];
  res.json({ accounts });
});

app.delete("/api/social/:platform", (req, res) => {
  const userId = (req.session as any).userId;
  if (!userId) return res.status(401).json({ error: "Not authenticated" });
  db.prepare("DELETE FROM platform_tokens WHERE user_id = ? AND platform = ?").run(userId, req.params.platform);
  res.json({ success: true });
});

// Bluesky — app password connect (no OAuth needed)
app.post("/api/social/bluesky/connect", async (req, res) => {
  const { identifier, appPassword } = req.body;
  const userId = (req.session as any).userId;
  if (!userId) return res.status(401).json({ error: "Not authenticated" });
  if (!identifier || !appPassword) return res.status(400).json({ error: "identifier and appPassword required" });

  try {
    // Verify credentials by creating a session
    const sessionRes = await fetch("https://bsky.social/xrpc/com.atproto.server.createSession", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier, password: appPassword }),
    });
    const sessionData = await sessionRes.json() as any;
    if (!sessionRes.ok) throw new Error(sessionData.message || "Invalid credentials");

    // Store identifier + appPassword (app passwords are designed for this use case)
    db.prepare(`
      INSERT INTO platform_tokens (user_id, platform, access_token, handle, person_urn)
      VALUES (?, 'bluesky', ?, ?, ?)
      ON CONFLICT(user_id, platform) DO UPDATE SET
        access_token = excluded.access_token,
        handle = excluded.handle,
        person_urn = excluded.person_urn,
        updated_at = CURRENT_TIMESTAMP
    `).run(userId, appPassword, identifier, sessionData.did || '');

    res.json({ success: true, handle: identifier });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Bluesky connection failed" });
  }
});

// Substack — connect via subdomain + credentials
app.post("/api/social/substack/connect", async (req, res) => {
  const { subdomain, email, password } = req.body;
  const userId = (req.session as any).userId;
  if (!userId) return res.status(401).json({ error: "Not authenticated" });
  if (!subdomain) return res.status(400).json({ error: "Substack subdomain is required" });

  try {
    // Normalize subdomain: strip protocol and .substack.com if provided
    const cleanSubdomain = subdomain
      .replace(/^https?:\/\//, '')
      .replace(/\.substack\.com\/?$/, '')
      .trim();

    if (!cleanSubdomain) return res.status(400).json({ error: "Invalid subdomain" });

    // Store credentials
    const tokenData = JSON.stringify({ email: email || '', password: password || '' });
    db.prepare(`
      INSERT INTO platform_tokens (user_id, platform, access_token, handle, person_urn)
      VALUES (?, 'substack', ?, ?, '')
      ON CONFLICT(user_id, platform) DO UPDATE SET
        access_token = excluded.access_token,
        handle = excluded.handle,
        updated_at = CURRENT_TIMESTAMP
    `).run(userId, tokenData, cleanSubdomain);

    res.json({ success: true, handle: `${cleanSubdomain}.substack.com` });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Substack connection failed" });
  }
});

// ─── Multi-platform post endpoint ─────────────────────────────────────────────

app.post("/api/social/post", requireAuth, postLimiter, async (req, res) => {
  const userId = (req.session as any).userId;
  const { text, platforms } = req.body as { text: string; platforms: string[] };

  if (!userId) return res.status(401).json({ error: "Not authenticated" });
  if (!text) return res.status(400).json({ error: "text required" });
  if (!platforms || platforms.length === 0) return res.status(400).json({ error: "at least one platform required" });

  const results: Record<string, { success: boolean; error?: string; id?: string }> = {};

  // Post to Bluesky
  if (platforms.includes('bluesky')) {
    try {
      const token = db.prepare("SELECT * FROM platform_tokens WHERE user_id = ? AND platform = 'bluesky'").get(userId) as any;
      if (!token) throw new Error("Bluesky not connected");

      const sessionRes = await fetch("https://bsky.social/xrpc/com.atproto.server.createSession", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: token.handle, password: token.access_token }),
      });
      const session = await sessionRes.json() as any;
      if (!sessionRes.ok) throw new Error(session.message || "Bluesky auth failed");

      const postRes = await fetch("https://bsky.social/xrpc/com.atproto.repo.createRecord", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.accessJwt}` },
        body: JSON.stringify({
          repo: session.did,
          collection: "app.bsky.feed.post",
          record: { $type: "app.bsky.feed.post", text: text.substring(0, 300), createdAt: new Date().toISOString() },
        }),
      });
      const postData = await postRes.json() as any;
      if (!postRes.ok) throw new Error(postData.message || "Bluesky post failed");
      results.bluesky = { success: true, id: postData.uri };
    } catch (err) {
      results.bluesky = { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // Post to LinkedIn
  if (platforms.includes('linkedin')) {
    try {
      const token = db.prepare("SELECT * FROM platform_tokens WHERE user_id = ? AND platform = 'linkedin'").get(userId) as any;
      if (!token) throw new Error("LinkedIn not connected");

      const postRes = await fetch("https://api.linkedin.com/rest/posts", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token.access_token}`,
          "Content-Type": "application/json",
          "LinkedIn-Version": "202401",
          "X-Restli-Protocol-Version": "2.0.0",
        },
        body: JSON.stringify({
          author: `urn:li:person:${token.person_urn}`,
          lifecycleState: "PUBLISHED",
          specificContent: {
            "com.linkedin.ugc.ShareContent": {
              shareCommentary: { text },
              shareMediaCategory: "NONE",
            },
          },
          visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
        }),
      });
      if (!postRes.ok) {
        const errData = await postRes.json() as any;
        throw new Error(errData.message || `LinkedIn post failed (${postRes.status})`);
      }
      results.linkedin = { success: true };
    } catch (err) {
      results.linkedin = { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // Post to X via the OAuth 2.0 user connection — the same token the scheduler and
  // /api/post-to-x use. This previously required a separate set of OAuth 1.0a app keys
  // (X_API_KEY/X_API_SECRET/X_ACCESS_TOKEN/X_ACCESS_SECRET) that were never configured,
  // so Compose always failed with "OAuth 1.0a credentials not configured" even with a
  // perfectly healthy OAuth 2.0 connection.
  if (platforms.includes('x')) {
    try {
      const tokenRecord = getXTokenRecord(userId);
      if (!tokenRecord?.access_token) {
        throw new Error("X account not connected — connect it on the Profile page.");
      }
      if (text.length > X_MAX_POST_CHARS) {
        throw new Error(`Post too long: ${text.length}/${X_MAX_POST_CHARS} characters`);
      }
      const accessToken = await refreshXToken(tokenRecord);
      const result = await new TwitterApi(accessToken).v2.tweet(text);
      recordSpend(xSpend(/https?:\/\//.test(text) ? 'post_with_link' : 'post', 1, { source: 'compose', tweet_id: result.data.id }));
      results.x = { success: true, id: result.data.id };
    } catch (err: any) {
      // Surface X's own response body. A bare "Request failed with code NNN" hides the
      // reason (wrong tier, duplicate post, suspended app), which makes these unfixable.
      const detail = err?.data ? JSON.stringify(err.data).slice(0, 500) : '';
      console.error(`[x-post] failed code=${err?.code ?? '?'} len=${text.length} msg=${err?.message ?? err} detail=${detail}`);
      results.x = { success: false, error: `${err instanceof Error ? err.message : String(err)}${detail ? ` — ${detail}` : ''}` };
    }
  }

  // Post to Instagram (requires Business/Creator account + publicly hosted image)
  if (platforms.includes('instagram')) {
    try {
      const token = db.prepare("SELECT * FROM platform_tokens WHERE user_id = ? AND platform = 'instagram'").get(userId) as any;
      if (!token) throw new Error("Instagram not connected");
      if (!token.person_urn) throw new Error("No Instagram Business account found. Connect a Business or Creator account.");

      // Instagram Graph API only supports image/video posts — text-only not possible
      // imageUrl must be a publicly accessible URL
      const { imageUrl, caption } = req.body;
      if (!imageUrl) {
        results.instagram = { success: false, error: "Instagram requires an image. Export your slides as PNGs, host them publicly, then provide the image URL." };
      } else {
        // Step 1: Create media container
        const containerRes = await fetch(`https://graph.facebook.com/v18.0/${token.person_urn}/media`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image_url: imageUrl, caption: caption || text, access_token: token.access_token }),
        });
        const container = await containerRes.json() as any;
        if (!container.id) throw new Error(container.error?.message || "Failed to create Instagram media container");

        // Step 2: Publish
        await new Promise(resolve => setTimeout(resolve, 2000));
        const publishRes = await fetch(`https://graph.facebook.com/v18.0/${token.person_urn}/media_publish`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ creation_id: container.id, access_token: token.access_token }),
        });
        const publishData = await publishRes.json() as any;
        if (!publishRes.ok) throw new Error(publishData.error?.message || "Instagram publish failed");
        results.instagram = { success: true, id: publishData.id };
      }
    } catch (err) {
      results.instagram = { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // Post to Threads
  if (platforms.includes('threads')) {
    try {
      const token = db.prepare("SELECT * FROM platform_tokens WHERE user_id = ? AND platform = 'threads'").get(userId) as any;
      if (!token) throw new Error("Threads not connected");

      // Step 1: Create container
      const containerRes = await fetch(`https://graph.threads.net/v1.0/${token.person_urn}/threads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ media_type: "TEXT", text: text.substring(0, 500), access_token: token.access_token }),
      });
      const container = await containerRes.json() as any;
      if (!container.id) throw new Error("Failed to create Threads container");

      // Step 2: Publish
      await new Promise(resolve => setTimeout(resolve, 1000)); // brief pause before publish
      const publishRes = await fetch(`https://graph.threads.net/v1.0/${token.person_urn}/threads_publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creation_id: container.id, access_token: token.access_token }),
      });
      const publishData = await publishRes.json() as any;
      if (!publishRes.ok) throw new Error(publishData.error?.message || "Threads publish failed");
      results.threads = { success: true, id: publishData.id };
    } catch (err) {
      results.threads = { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  res.json({ results });
});

// ─── Report Generation ─────────────────────────────────────────────────────────

app.get("/api/debug/models", requireAuth, async (_req, res) => {
  try {
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
    const response = await ai.models.list();
    const models: string[] = [];
    for await (const m of response) {
      if (m.name) models.push(m.name);
    }
    res.json({ models });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Report generation is now TWO sequential AI calls: the report itself, then the hashtag
// reach pass. At 3 minutes the request timed out while the second call was still running —
// the work completed and was then discarded, which looked like a silent failure.
const REPORT_TIMEOUT_MS = Number(process.env.REPORT_TIMEOUT_MS) || 8 * 60 * 1000;

// In-flight report generation progress, published for the client to poll.
// Bounded by construction: one entry per (report type, user) and deleted on completion.
const genProgress = new Map<string, { stage: string; percent: number; at: number; startedAt: number }>();

app.get("/api/generate-report/progress", requireAuth, (req, res) => {
  const type = String(req.query.type || '');
  const p = genProgress.get(`${type}:${(req.session as any).userId ?? 'anon'}`);
  if (!p) return res.json({ active: false });
  res.json({
    active: true,
    stage: p.stage,
    percent: p.percent,
    elapsedMs: Date.now() - p.startedAt,
    staleMs: Date.now() - p.at,
  });
});

app.post("/api/generate-report", requireAuth, reportGenLimiter, async (req, res) => {
  try {
    const { type, customTopic } = req.body;

    if (!type || !['global', 'crypto', 'equities', 'nasdaq', 'conspiracies', 'custom', 'forecast', 'china', 'speculation'].includes(type)) {
      return res.status(400).json({ error: "Invalid report type" });
    }
    if (type === 'custom' && !customTopic?.trim()) {
      return res.status(400).json({ error: "Custom topic text is required" });
    }

    console.log(`[API] Generating ${type} report...`);

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("REPORT_TIMEOUT")), REPORT_TIMEOUT_MS)
    );

    // Publish real progress so the client can read it. The UI previously ran a fake
    // timer-driven bar that froze at 92.2% and showed a stage label unrelated to what
    // the server was actually doing.
    const jobKey = `${type}:${(req.session as any).userId ?? 'anon'}`;
    let lastLogged = -1;
    const logProgress = (stage: string, percent: number) => {
      const pct = Math.round(percent * 10) / 10;
      // Token-level ticks fire several times a second; only log on a whole-percent
      // change so the console stays readable while the map stays current.
      if (Math.floor(pct) !== lastLogged) {
        lastLogged = Math.floor(pct);
        console.log(`[API] ${type} progress: ${pct}% — ${stage}`);
      }
      genProgress.set(jobKey, { stage, percent: pct, at: Date.now(), startedAt: genProgress.get(jobKey)?.startedAt ?? Date.now() });
    };
    genProgress.set(jobKey, { stage: 'Starting...', percent: 2, at: Date.now(), startedAt: Date.now() });

    let resultPromise: Promise<any>;

    if (type === 'forecast') {
      resultPromise = generateForecastReport(logProgress);
    } else if (type === 'speculation') {
      resultPromise = generateSpeculationReport(logProgress);
    } else {
      resultPromise = generateWeeklyReport(type, customTopic, logProgress, getContentGuidance());
    }

    // The client is what normally persists a report, so losing the race used to discard a
    // finished generation along with everything it cost. Salvage it server-side instead.
    let raceLost = false;
    resultPromise
      .then((r: any) => {
        if (!raceLost) return;
        const items = r?.headlines?.length ?? r?.events?.length ?? 0;
        if (!items) return;
        const id = `${type}-${Date.now()}`;
        db.prepare(`INSERT INTO reports (id, type, content, custom_topic, updated_at)
                    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                    ON CONFLICT(id) DO UPDATE SET content = excluded.content, updated_at = CURRENT_TIMESTAMP`)
          .run(id, type, JSON.stringify(r), customTopic || null);
        log.warn('report_salvaged_after_timeout', { id, type, items });
      })
      .catch((e: unknown) => log.error('report_background_failure', errInfo(e)));

    const report = await Promise.race([resultPromise, timeoutPromise]).catch((e) => {
      if (e instanceof Error && e.message === 'REPORT_TIMEOUT') raceLost = true;
      throw e;
    });

    if (type === 'forecast') {
      if (!report?.events?.length) return res.status(500).json({ error: "Failed to generate forecast: no events returned" });
      console.log(`[API] Successfully generated forecast with ${report.events.length} events`);
    } else {
      if (!report?.headlines?.length) return res.status(500).json({ error: "Failed to generate report: no headlines returned" });
      console.log(`[API] Successfully generated ${type} report with ${report.headlines.length} headlines`);
    }

    genProgress.delete(`${type}:${(req.session as any).userId ?? 'anon'}`);
    res.json(report);
  } catch (error) {
    try { genProgress.delete(`${req.body?.type}:${(req.session as any).userId ?? 'anon'}`); } catch { /* ignore */ }
    console.error("[API] Report generation error:", error);
    const message = error instanceof Error ? error.message : String(error);

    let errorType = "UNKNOWN";
    let userMessage = message;
    let statusCode = 500;

    if (message === "REPORT_TIMEOUT") {
      errorType = "TIMEOUT"; statusCode = 504;
      userMessage = `Report generation exceeded ${Math.round(REPORT_TIMEOUT_MS / 60000)} minutes. It may still finish in the background — check Reports shortly before retrying.`;
    } else if (message.includes("AbortError") || message.includes("aborted") || message.includes("cancelled") || message.includes("canceled")) {
      errorType = "CANCELLED"; statusCode = 499;
      userMessage = "Report generation was cancelled.";
    } else if (message.includes("ECONNREFUSED") || message.includes("ENOTFOUND") || message.includes("fetch failed") || message.includes("network")) {
      errorType = "NETWORK_ERROR"; statusCode = 502;
      userMessage = "Network error — could not reach the AI provider. Check your internet connection and try again.";
    } else if (message.includes("rate limit") || message.includes("Rate limit") || message.includes("429") || message.includes("quota")) {
      errorType = "RATE_LIMIT"; statusCode = 429;
      userMessage = "Rate limit reached. Please upgrade your API plan or wait before retrying.";
    } else if (message.includes("invalid_api_key") || message.includes("API key") || message.includes("unauthorized") || message.includes("UNAUTHENTICATED")) {
      errorType = "AUTH_ERROR"; statusCode = 401;
      userMessage = "API authentication failed. Please check your API keys.";
    } else if (message.includes("JSON") || message.includes("parse")) {
      errorType = "PARSING_ERROR"; statusCode = 500;
      userMessage = "The AI returned invalid data format. This is usually temporary — please retry.";
    } else if (message.includes("All AI providers failed")) {
      errorType = "ALL_PROVIDERS_FAILED"; statusCode = 503;
      userMessage = "All AI providers are currently unavailable. Please try again.";
    }

    res.status(statusCode).json({ error: userMessage, type: errorType, details: message.substring(0, 200) });
  }
});

// ─── Instagram Caption ────────────────────────────────────────────────────────

app.post("/api/instagram-caption", requireAuth, reportGenLimiter, async (req, res) => {
  try {
    const { reportId } = req.body;
    const reportRow = db.prepare("SELECT * FROM reports WHERE id = ?").get(reportId) as any;
    if (!reportRow) return res.status(404).json({ error: "Report not found" });

    const report = JSON.parse(reportRow.content);
    const caption = await generateInstagramCaption(report);
    res.json({ caption });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("rate limit") || message.includes("429") || message.includes("quota")) {
      return res.status(429).json({ error: `Rate limit error: ${message}`, type: "RATE_LIMIT" });
    }
    res.status(500).json({ error: `Failed to generate caption: ${message}` });
  }
});

// ─── Audio Brief ───────────────────────────────────────────────────────────────

app.post("/api/audio-brief", requireAuth, reportGenLimiter, async (req, res) => {
  const { reportId } = req.body;
  const reportRow = db.prepare("SELECT * FROM reports WHERE id = ?").get(reportId) as any;
  if (!reportRow) return res.status(404).json({ error: "Report not found" });

  try {
    const report = JSON.parse(reportRow.content) as WeeklyReport;

    // Build spoken text: summary + top 5 headlines
    const headlineIntros = report.headlines.slice(0, 5).map((h, i) =>
      `Story ${i + 1}: ${h.title}.`
    ).join(' ');
    const text = `Today's Intelligence Brief. ${report.analysis.overallSummary} Here are the top stories. ${headlineIntros}`.substring(0, 4096);

    const OpenAI = (await import('openai')).default;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || "" });

    const mp3Response = await openai.audio.speech.create({
      model: "tts-1",
      voice: "onyx",
      input: text,
    });

    const buffer = Buffer.from(await mp3Response.arrayBuffer());
    res.set('Content-Type', 'audio/mpeg');
    res.set('Content-Disposition', `attachment; filename="brief-${reportId}.mp3"`);
    res.send(buffer);
  } catch (error) {
    console.error("[API] Audio brief error:", error);
    res.status(500).json({ error: "Failed to generate audio brief" });
  }
});

// ─── Email Digest ──────────────────────────────────────────────────────────────

app.post("/api/email-digest", requireAuth, emailLimiter, async (req, res) => {
  const { reportId, to } = req.body;
  if (!to) return res.status(400).json({ error: "Recipient email (to) required" });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return res.status(400).json({ error: "Invalid email address" });

  const reportRow = db.prepare("SELECT * FROM reports WHERE id = ?").get(reportId) as any;
  if (!reportRow) return res.status(404).json({ error: "Report not found" });

  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return res.status(503).json({ error: "Email not configured. Add SMTP_HOST, SMTP_USER, SMTP_PASS to .env" });
  }

  try {
    const report = JSON.parse(reportRow.content) as WeeklyReport;

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || "587"),
      secure: process.env.SMTP_PORT === "465",
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });

    const headlinesHtml = report.headlines.map((h, i) => `
      <tr style="border-bottom:1px solid #1a1a1a;">
        <td style="padding:12px 8px;color:#f7931a;font-family:monospace;width:24px;">${String(i + 1).padStart(2, '0')}</td>
        <td style="padding:12px 8px;">
          <p style="margin:0 0 4px;color:#ffffff;font-weight:600;">${escapeHtml(h.title)}</p>
          <span style="font-size:11px;color:#888;font-family:monospace;text-transform:uppercase;">${escapeHtml(h.category)}</span>
          ${h.sentiment ? `<span style="margin-left:8px;font-size:10px;color:#f7931a;font-family:monospace;">${escapeHtml(h.sentiment)}</span>` : ''}
        </td>
      </tr>`).join('');

    const html = `
      <div style="background:#0a0a0a;color:#e5e5e5;font-family:sans-serif;max-width:700px;margin:0 auto;padding:32px;">
        <div style="border-bottom:1px solid rgba(247,147,26,0.3);padding-bottom:24px;margin-bottom:24px;">
          <p style="color:#f7931a;font-family:monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.3em;margin:0 0 8px;">Global Intelligence Brief</p>
          <h1 style="color:#ffffff;font-size:36px;font-style:italic;margin:0;">The Pulse.</h1>
          <p style="color:#888;font-size:12px;margin:8px 0 0;">${new Date().toLocaleDateString('en-US', { weekday:'long',year:'numeric',month:'long',day:'numeric' })}</p>
        </div>
        <div style="background:rgba(247,147,26,0.05);border:1px solid rgba(247,147,26,0.2);padding:20px;margin-bottom:24px;">
          <p style="color:#f7931a;font-family:monospace;font-size:10px;text-transform:uppercase;letter-spacing:0.2em;margin:0 0 12px;">Strategic Summary</p>
          <p style="color:#d1d5db;line-height:1.6;margin:0;">${escapeHtml(report.analysis.overallSummary.substring(0, 600))}...</p>
        </div>
        <table style="width:100%;border-collapse:collapse;">
          ${headlinesHtml}
        </table>
        <div style="margin-top:32px;padding-top:16px;border-top:1px solid rgba(247,147,26,0.1);text-align:center;">
          <p style="color:#444;font-family:monospace;font-size:10px;text-transform:uppercase;margin:0;">Global Pulse · Intelligence Brief</p>
        </div>
      </div>`;

    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject: `Intelligence Brief — ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`,
      html,
    });

    res.json({ success: true, messageId: info.messageId });
  } catch (error) {
    console.error("[API] Email digest error:", error);
    res.status(500).json({ error: "Failed to send email: " + (error instanceof Error ? error.message : String(error)) });
  }
});

// ─── Substack Article ──────────────────────────────────────────────────────────

app.post("/api/substack-article", requireAuth, reportGenLimiter, async (req, res) => {
  const { reportId } = req.body;
  if (!reportId) return res.status(400).json({ error: "reportId required" });

  const reportRow = db.prepare("SELECT * FROM reports WHERE id = ?").get(reportId) as any;
  if (!reportRow) return res.status(404).json({ error: "Report not found" });

  try {
    const report = JSON.parse(reportRow.content) as WeeklyReport;
    console.log(`[API] Generating Substack article for report ${reportId}...`);
    const article = await generateSubstackArticle(report);
    res.json({ article });
  } catch (error) {
    console.error("[API] Substack article error:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to generate article" });
  }
});

// ─── Public read-only reports feed (consumed by ChokePointMacro on :3001) ──────
// No auth required — returns only safe, public-facing fields.
app.get("/api/public/reports", (req, res) => {
  const reports = db.prepare("SELECT id, type, content, custom_topic, updated_at FROM reports ORDER BY updated_at DESC LIMIT 50").all() as any[];
  const safe = reports.map(r => {
    let content: any = {};
    try { content = JSON.parse(r.content); } catch {}
    return { id: r.id, type: r.type, custom_topic: r.custom_topic, updated_at: r.updated_at, content };
  });
  res.json({ reports: safe });
});

// ─── Report Archive ────────────────────────────────────────────────────────────

app.get("/api/reports", requireAuth, (req, res) => {
  const reports = db.prepare("SELECT * FROM reports ORDER BY updated_at DESC").all() as any[];
  res.json(reports.map(r => ({ ...r, content: JSON.parse(r.content) })));
});

app.post("/api/reports", requireAuth, (req, res) => {
  const { id, type, content, customTopic } = req.body;
  db.prepare(`
    INSERT INTO reports (id, type, content, custom_topic, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET content = excluded.content, custom_topic = excluded.custom_topic, updated_at = CURRENT_TIMESTAMP
  `).run(id, type, JSON.stringify(content), customTopic || null);
  res.json({ success: true });
});

app.delete("/api/reports", requireAuth, (req, res) => {
  try {
    console.log("Clearing all reports...");
    db.prepare("DELETE FROM reports").run();
    console.log("Reports cleared successfully");
    res.json({ success: true });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error clearing reports:", errorMsg);
    res.status(500).json({ error: errorMsg });
  }
});

app.delete("/api/reports/:id", requireAuth, (req, res) => {
  try {
    console.log("Deleting report:", req.params.id);
    db.prepare("DELETE FROM reports WHERE id = ?").run(req.params.id);
    console.log("Report deleted successfully");
    res.json({ success: true });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Error deleting report:", errorMsg);
    res.status(500).json({ error: errorMsg });
  }
});

app.get("/api/reports/automated", (req, res) => {
  const reports = db.prepare("SELECT * FROM reports WHERE auto_generated = 1 ORDER BY updated_at DESC").all() as any[];
  res.json(reports.map(r => ({ ...r, content: JSON.parse(r.content) })));
});

// ─── App Settings ──────────────────────────────────────────────────────────────

// requireAuth added: app_settings holds operator configuration (digest_email, the
// content_guidance prompt block, the posting kill switch). Readable without a session it
// was the one un-gated settings route. In LOCAL_MODE this is a no-op, as intended.
app.get("/api/app-settings/:key", requireAuth, (req, res) => {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(req.params.key) as any;
  res.json({ value: row?.value ?? null });
});

// ─── Posting kill switch ───────────────────────────────────────────────────────
//
// Separate from the generic settings route so it has its own explicit shape and an
// audit log line. Takes effect on the next cron tick (<= 60s) with no restart.

app.get("/api/posting/status", requireAuth, (_req, res) => {
  const row = db.prepare("SELECT value, updated_at FROM app_settings WHERE key = 'posting_enabled'").get() as any;
  res.json({
    enabled: isPostingEnabled(),
    // Distinguishes "explicitly turned on/off" from "never configured, defaulting to off".
    source: row?.value != null ? 'app_settings' : (process.env.POSTING_ENABLED === 'true' ? 'env' : 'default'),
    updatedAt: row?.updated_at ?? null,
    dryRun: POSTING_DRY_RUN,
    maxPostsPerRun: MAX_POSTS_PER_RUN,
    maxSlotLatenessMin: MAX_SLOT_LATENESS_MIN,
  });
});

app.put("/api/posting/status", requireAuth, (req, res) => {
  const { enabled } = req.body ?? {};
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: "enabled must be true or false" });
  }
  db.prepare(`
    INSERT INTO app_settings (key, value, updated_at) VALUES ('posting_enabled', ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).run(enabled ? 'true' : 'false');

  // Worth a log line either way: this flag decides whether a public account posts.
  log.warn('posting_toggle_changed', { enabled, by: (req.session as any)?.userId ?? 'unknown' });
  res.json({ success: true, enabled });
});

app.put("/api/app-settings", requireAuth, (req, res) => {
  const { key, value } = req.body;
  if (!key) return res.status(400).json({ error: "key required" });
  db.prepare(`
    INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).run(key, value ?? '');
  res.json({ success: true });
});

// ─── Report Schedules ──────────────────────────────────────────────────────────

app.get("/api/scheduled-reports", requireAuth, (req, res) => {
  const schedules = db.prepare("SELECT * FROM scheduled_reports ORDER BY created_at DESC").all();
  res.json(schedules);
});

app.post("/api/scheduled-reports", requireAuth, (req, res) => {
  const { report_type, custom_topic, schedule_time, days } = req.body;
  if (!report_type || !schedule_time) {
    return res.status(400).json({ error: "report_type and schedule_time required" });
  }
  const result = db.prepare(`
    INSERT INTO scheduled_reports (report_type, custom_topic, schedule_time, days)
    VALUES (?, ?, ?, ?)
  `).run(report_type, custom_topic || null, schedule_time, days || '1,2,3,4,5');
  res.json({ success: true, id: result.lastInsertRowid });
});

app.patch("/api/scheduled-reports/:id", requireAuth, (req, res) => {
  const { enabled, schedule_time, days } = req.body;
  if (schedule_time !== undefined || days !== undefined) {
    const current: any = db.prepare("SELECT * FROM scheduled_reports WHERE id = ?").get(req.params.id);
    if (!current) return res.status(404).json({ error: "Schedule not found" });
    db.prepare("UPDATE scheduled_reports SET schedule_time = ?, days = ? WHERE id = ?")
      .run(schedule_time ?? current.schedule_time, days ?? current.days, req.params.id);
  }
  if (enabled !== undefined) {
    db.prepare("UPDATE scheduled_reports SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, req.params.id);
  }
  res.json({ success: true });
});

app.delete("/api/scheduled-reports/:id", requireAuth, (req, res) => {
  db.prepare("DELETE FROM scheduled_reports WHERE id = ?").run(req.params.id);
  res.json({ success: true });
});


/** Human-editable content guidance injected into every report generation.
 *  Edited by hand via PUT /api/app-settings, or proposed by the weekly audience sample. */
function getContentGuidance(): string | undefined {
  try {
    const row = db.prepare("SELECT value FROM app_settings WHERE key = 'content_guidance'").get() as any;
    return row?.value?.trim() || undefined;
  } catch { return undefined; }
}


// ─── Analytics (spend ledger, scoring weights, audience samples) ───────────────
// Extracted to src/server/analytics.ts. recordSpend is destructured out because the
// posting paths below write to the ledger; the routes only read from it.
const analytics = createAnalytics({
  db,
  requireAuth,
  onLedgerError: (err) => log.warn('spend_record_failed', errInfo(err)),
});
app.use(analytics.router);
const { recordSpend, getScoringWeights } = analytics;

// Route every AI call's token usage into the ledger.
onAISpend(({ model, inputTokens, outputTokens, label }) => {
  recordSpend(aiSpend(label, model, inputTokens, outputTokens));
});

// ─── AI spend cap ──────────────────────────────────────────────────────────────
//
// The ledger measures; this enforces. Without it a stuck retry loop bills without
// limit and the only symptom is a bigger number in the spend UI tomorrow.
//
// Calendar-month window, matching how the providers bill. 0 disables the cap.
const AI_MONTHLY_CAP_USD = Number(process.env.AI_MONTHLY_CAP_USD ?? 80);

/** Month-to-date AI spend in USD. X posting costs are billed separately and excluded. */
function aiSpendThisMonthUsd(): number {
  const since = etDateString().slice(0, 7) + '-01T00:00:00.000Z';
  const row = db.prepare(
    "SELECT COALESCE(SUM(cost_usd), 0) total FROM api_spend WHERE provider != 'x' AND ts >= ?"
  ).get(since) as any;
  return Number(row?.total ?? 0);
}

// Warn once per server run as the cap approaches, so the first signal isn't a hard stop.
let capWarningSent = false;

setSpendGuard(() => {
  if (!AI_MONTHLY_CAP_USD || AI_MONTHLY_CAP_USD <= 0) return { allowed: true };

  let spent: number;
  try {
    spent = aiSpendThisMonthUsd();
  } catch (err) {
    // Deliberately fail OPEN here, unlike the posting switch. A broken ledger read
    // should not take content generation offline — generation is reversible and
    // bounded by max_tokens, whereas a published post is neither.
    log.warn('spend_cap_check_failed', errInfo(err));
    return { allowed: true };
  }

  if (spent >= AI_MONTHLY_CAP_USD) {
    const reason = `AI spend cap reached: $${spent.toFixed(2)} of $${AI_MONTHLY_CAP_USD.toFixed(2)} month-to-date. Raise AI_MONTHLY_CAP_USD or wait for the next calendar month.`;
    log.error('spend_cap_exceeded', { spent, cap: AI_MONTHLY_CAP_USD });
    void notifyOps('AI spend cap reached — generation paused', reason);
    return { allowed: false, reason };
  }

  if (!capWarningSent && spent >= AI_MONTHLY_CAP_USD * 0.8) {
    capWarningSent = true;
    log.warn('spend_cap_approaching', { spent, cap: AI_MONTHLY_CAP_USD });
    void notifyOps(
      'AI spend at 80% of monthly cap',
      `Month-to-date AI spend is $${spent.toFixed(2)} against a $${AI_MONTHLY_CAP_USD.toFixed(2)} cap. Generation will stop when the cap is reached.`,
    );
  }

  return { allowed: true };
});


// ─── X Posting ─────────────────────────────────────────────────────────────────

async function refreshXToken(tokenRecord: any) {
  if (tokenRecord.expires_at && tokenRecord.expires_at > Date.now() + 60000) return tokenRecord.access_token;
  const tok = await xTokenRequest({ grant_type: 'refresh_token', refresh_token: tokenRecord.refresh_token });
  const accessToken: string = tok.access_token;
  const refreshToken: string | undefined = tok.refresh_token;
  const expiresAt = Date.now() + tok.expires_in * 1000;
  if (tokenRecord.x_id) {
    // X-login user — update users table
    db.prepare(`UPDATE users SET access_token = ?, refresh_token = ?, expires_at = ? WHERE x_id = ?`).run(accessToken, refreshToken || tokenRecord.refresh_token, expiresAt, tokenRecord.x_id);
  } else {
    // Email user with connected X — update platform_tokens
    db.prepare(`UPDATE platform_tokens SET access_token = ?, refresh_token = ?, expires_at = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND platform = 'x'`).run(accessToken, refreshToken || tokenRecord.refresh_token, expiresAt, tokenRecord.user_id);
  }
  return accessToken;
}

// Resolve X token for any user type (X-login or email + connected X)
function getXTokenRecord(userId: string): any | null {
  // First: check if this is an X-login user
  const xUser = db.prepare("SELECT * FROM users WHERE x_id = ?").get(userId) as any;
  if (xUser?.access_token) return xUser;
  // Second: check platform_tokens (email user with connected X)
  const platformToken = db.prepare("SELECT *, user_id FROM platform_tokens WHERE user_id = ? AND platform = 'x'").get(userId) as any;
  return platformToken || null;
}

app.post("/api/post-to-x", postLimiter, async (req, res) => {
  if (!hasValidCreds('x')) {
    return res.status(503).json({ error: "X posting not enabled on this server" });
  }

  const userId = (req.session as any).userId;
  const { text } = req.body;

  if (!userId) return res.status(401).json({ error: "Not authenticated" });

  const tokenRecord = getXTokenRecord(userId);
  if (!tokenRecord) return res.status(401).json({ error: "X account not connected — go to Settings to connect your X account" });
  if (!text?.trim()) return res.status(400).json({ error: "Cannot post empty content" });
  if (text.length > X_MAX_POST_CHARS) return res.status(400).json({ error: `Post too long: ${text.length}/${X_MAX_POST_CHARS} characters` });

  try {
    const accessToken = await refreshXToken(tokenRecord);
    if (!accessToken) return res.status(401).json({ error: "Failed to authenticate - token is invalid" });

    const client = new TwitterApi(accessToken);
    const result = await client.v2.tweet(text);
    recordSpend(xSpend(/https?:\/\//.test(text) ? 'post_with_link' : 'post', 1, { source: 'post-to-x', tweet_id: result.data.id }));
    res.json({ success: true, tweetId: result.data.id });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    if (errorMsg.includes("401") || errorMsg.includes("Unauthorized")) {
      return res.status(401).json({ error: "Authentication failed - reconnect your X account", details: errorMsg });
    } else if (errorMsg.includes("429") || errorMsg.includes("rate")) {
      return res.status(429).json({ error: "Rate limited - please wait before posting", details: errorMsg });
    }
    res.status(500).json({ error: "Failed to post to X", details: errorMsg.substring(0, 200) });
  }
});

app.post("/api/schedule-post", requireAuth, (req, res) => {
  const userId = (req.session as any).userId;
  const { content, scheduledAt } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: "content required" });
  if (!scheduledAt) return res.status(400).json({ error: "scheduledAt required" });

  // Reject over-length here rather than letting it fail at X an hour later, where it
  // lands as a 'failed' row with a truncated API error and no way to retry.
  if (content.length > X_MAX_POST_CHARS) {
    return res.status(400).json({ error: `content exceeds ${X_MAX_POST_CHARS} characters`, chars: content.length });
  }

  // Canonicalise to ISO UTC. A zone-less value is read as Eastern wall clock, matching
  // how every other slot time in the app is defined. Storing the raw client string is
  // what let '2026-10-01 23:59' compare as due at UTC midnight and publish early.
  const iso = normaliseScheduledAt(scheduledAt);
  if (!iso) {
    return res.status(400).json({ error: "scheduledAt not understood — use 'YYYY-MM-DD HH:MM' (Eastern) or a full ISO-8601 timestamp" });
  }

  // Lands as needs_review with the time confirmed: Mike typed an explicit time, so the
  // *schedule* is settled, but the publisher still requires an explicit approval before
  // it will send. See the approval gate in the publisher below.
  const manualType = db.prepare("SELECT id FROM post_types WHERE code = 'MAN'").get() as any;
  const info = db.prepare(`
    INSERT INTO posts (type_id, status, body, proposed_at, scheduled_at, time_confirmed, user_id)
    VALUES (?, 'needs_review', ?, ?, ?, 1, ?)
  `).run(manualType?.id ?? null, content, iso, iso, userId);

  res.json({ success: true, scheduledAt: iso, id: info.lastInsertRowid, status: 'needs_review' });
});

// Kept at the old path and old field names so the existing /schedule screen keeps working
// until Phase B replaces it with the Post Queue timeline. `body`/`error` are aliased back
// to `content`/`last_error`, which is what ScheduledPost in the client still expects.
app.get("/api/scheduled-posts", requireAuth, (req, res) => {
  const userId = (req.session as any).userId;
  const posts = db.prepare(`
    SELECT p.id, p.body AS content, p.scheduled_at, p.status, p.error AS last_error,
           p.x_post_id AS posted_tweet_id, p.source_url, p.attempts, p.time_confirmed,
           p.created_at, t.code AS kind
    FROM posts p
    LEFT JOIN post_types t ON t.id = p.type_id
    WHERE (p.user_id = ? OR p.user_id IS NULL) AND p.status != 'archived'
    ORDER BY p.scheduled_at ASC
  `).all(userId);
  res.json(posts);
});

app.delete("/api/scheduled-posts/:id", requireAuth, (req, res) => {
  // A post mid-flight must not vanish from under the publisher — it has already been
  // claimed and may have reached X.
  const row = db.prepare("SELECT status FROM posts WHERE id = ?").get(req.params.id) as any;
  if (row?.status === 'posting') {
    return res.status(409).json({ error: "That post is being sent right now and can't be deleted." });
  }
  db.prepare("DELETE FROM posts WHERE id = ? AND (user_id = ? OR user_id IS NULL)")
    .run(req.params.id, (req.session as any).userId);
  res.json({ success: true });
});

// ─── Auto-Schedule ─────────────────────────────────────────────────────────────

// Weekly report → publishing day mapping
const REPORT_DAY_MAP: Record<string, number> = {
  forecast: 0, crypto: 1, nasdaq: 2, conspiracies: 3, equities: 4, global: 5,
};

app.post("/api/auto-schedule/preview", requireAuth, (req, res) => {
  const { reportId } = req.body;
  if (!reportId) return res.status(400).json({ error: "reportId required" });

  const row = db.prepare("SELECT * FROM reports WHERE id = ?").get(reportId) as any;
  if (!row) return res.status(404).json({ error: "Report not found" });

  const content = JSON.parse(row.content);
  const reportType: string = row.type;
  const targetDay = REPORT_DAY_MAP[reportType] ?? 1;
  const nextDate  = getNextWeekday(targetDay);

  const items: any[] = [];

  // Tweets (7am–7pm EST)
  if (content.headlines?.length) {
    const slots = calculateTweetSlots(nextDate, content.headlines);
    for (const s of slots) {
      items.push({ type: 'tweet', time: s.time, content: s.content, title: s.title, trendScore: s.trendScore, sourceUrl: s.sourceUrl, enabled: true });
    }
  }

  // Reminders at 9am ET. These were previously `midnight + 4h`, which the comment
  // called 9am but which actually produced 4am ET — midnight ET to 9am ET is nine
  // hours, not four. Stating the wall clock directly removes the arithmetic entirely.
  const at9amEt = (day: Date) => {
    const p = etParts(day);
    return etToUtc(p.year, p.month, p.day, 9, 0).toISOString();
  };

  items.push({ type: 'instagram', time: at9amEt(nextDate), content: 'Post your 21-slide Instagram carousel for today\'s report.', enabled: true });

  // Substack reminder (next Monday 9am ET)
  items.push({ type: 'substack', time: at9amEt(getNextWeekday(1)), content: 'Publish your Substack article for this week\'s intelligence brief.', enabled: true });

  // Sort chronologically
  items.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

  res.json({ reportType, nextDate: nextDate.toISOString(), items });
});

app.post("/api/auto-schedule/confirm", requireAuth, (req, res) => {
  const userId = (req.session as any).userId;

  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: "No items provided" });

  let count = 0;
  const rejected: Array<{ time: unknown; reason: string }> = [];

  const insert = db.prepare(`
    INSERT INTO posts (type_id, status, body, proposed_at, scheduled_at, time_confirmed, source_url, user_id)
    VALUES (?, ?, ?, ?, ?, 0, ?, ?)
  `);
  const typeByCode = (code: string) =>
    (db.prepare("SELECT id FROM post_types WHERE code = ?").get(code) as any)?.id ?? null;
  const manualTypeId = typeByCode('MAN');

  for (const item of items) {
    if (!item.enabled) continue;

    const isTweet = item.type === 'tweet';

    // The Instagram/Substack entries are reminders to Mike, not things to publish.
    // They go in as 'archived' so they are visible in the queue but can never satisfy
    // the publisher's approved + time_confirmed predicate.
    const status = isTweet ? 'needs_review' : 'archived';
    const content = isTweet ? item.content
                  : item.type === 'instagram' ? `[INSTAGRAM] ${item.content}`
                  : `[SUBSTACK] ${item.content}`;

    const iso = normaliseScheduledAt(item.time);
    if (!iso) { rejected.push({ time: item.time, reason: 'unparseable time' }); continue; }

    // time_confirmed = 0: the generator *proposed* this slot. Mike confirms it in the
    // queue, which is what makes it eligible to send.
    insert.run(manualTypeId, status, content, iso, iso, isTweet ? (item.sourceUrl || null) : null, userId);
    count++;
  }

  // Surface partial failure rather than reporting a success count that silently
  // under-counts what the operator confirmed.
  if (rejected.length) log.warn('auto_schedule_items_rejected', { count: rejected.length, rejected });

  res.json({ success: true, scheduled: count, rejected: rejected.length });
});

// ─── Debug ─────────────────────────────────────────────────────────────────────

// ─── Context Files ─────────────────────────────────────────────────────────────

const CONTEXT_DIR = path.resolve('context');
if (!fs.existsSync(CONTEXT_DIR)) fs.mkdirSync(CONTEXT_DIR, { recursive: true });

const sanitizeFilename = (name: string) =>
  name.replace(/[^a-zA-Z0-9-_]/g, '-').replace(/-+/g, '-').slice(0, 80) + '.md';

// Safely resolve a context file path; throws if the result escapes CONTEXT_DIR
function safeContextPath(filename: string): string {
  const safeName = path.basename(filename.endsWith('.md') ? filename : filename + '.md');
  const resolved = path.resolve(CONTEXT_DIR, safeName);
  if (!resolved.startsWith(CONTEXT_DIR + path.sep) && resolved !== CONTEXT_DIR) {
    throw new Error('Invalid filename');
  }
  return resolved;
}

// Escape HTML to prevent XSS in email templates
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

app.get("/api/context-files", requireAuth, (req, res) => {
  try {
    const files = fs.readdirSync(CONTEXT_DIR)
      .filter(f => f.endsWith('.md'))
      .map(f => {
        const stat = fs.statSync(path.join(CONTEXT_DIR, f));
        const content = fs.readFileSync(path.join(CONTEXT_DIR, f), 'utf-8');
        const firstLine = content.split('\n').find(l => l.trim()) || f;
        const title = firstLine.replace(/^#+\s*/, '').trim();
        return { name: f, title, size: stat.size, updatedAt: stat.mtime.toISOString() };
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list context files' });
  }
});

app.get("/api/context-files/:name", requireAuth, (req, res) => {
  try {
    const filePath = safeContextPath(req.params.name);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
    res.json({ name: path.basename(filePath), content: fs.readFileSync(filePath, 'utf-8') });
  } catch { return res.status(400).json({ error: 'Invalid filename' }); }
});

app.post("/api/context-files", requireAuth, (req, res) => {
  const { name, content } = req.body;
  if (!name?.trim() || !content?.trim()) return res.status(400).json({ error: 'name and content required' });
  try {
    const filename = sanitizeFilename(name.trim().replace(/\.md$/, ''));
    const filePath = safeContextPath(filename);
    fs.writeFileSync(filePath, content.trim());
    res.json({ success: true, name: filename });
  } catch { return res.status(400).json({ error: 'Invalid filename' }); }
});

app.patch("/api/context-files/:name", requireAuth, (req, res) => {
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'content required' });
  try {
    const filePath = safeContextPath(req.params.name);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
    fs.writeFileSync(filePath, content.trim());
    res.json({ success: true });
  } catch { return res.status(400).json({ error: 'Invalid filename' }); }
});

app.delete("/api/context-files/:name", requireAuth, (req, res) => {
  try {
    const filePath = safeContextPath(req.params.name);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
    fs.unlinkSync(filePath);
    res.json({ success: true });
  } catch { return res.status(400).json({ error: 'Invalid filename' }); }
});

app.get("/api/debug/session", (req, res) => {
  res.json({ sessionId: req.sessionID, userId: (req.session as any).userId });
});

// ─── Auto-Schedule Helpers ─────────────────────────────────────────────────────

// Returns the next instant corresponding to midnight Eastern on the given day-of-week
// (0=Sun…6=Sat). If today IS that day in ET, schedules for next week.
//
// Was: `now - 5h`, hardcoding EST. Eastern has no fixed offset — it is UTC-5 in winter
// and UTC-4 under DST — so for ~8 months a year that put every derived slot an hour off.
// nextEtWeekdayMidnight asks the timezone database instead. See src/services/time.ts.
function getNextWeekday(targetDay: number): Date {
  return nextEtWeekdayMidnight(targetDay);
}

// Assign tweets to time slots from 7am–7pm ET, highest trendScore to highest engagement hour
function calculateTweetSlots(baseDate: Date, tweets: any[]): Array<{ time: string; content: string; trendScore: number; title: string; sourceUrl?: string }> {
  const count = tweets.length;
  if (count === 0) return [];

  const startMinET = 7 * 60;  // 420
  const endMinET   = 19 * 60; // 1140
  const totalMins  = endMinET - startMinET; // 720
  const interval   = totalMins / count;

  // Finance/politics X engagement score per ET hour
  const engHour: Record<number, number> = {
    7:8, 8:10, 9:9, 10:6, 11:5, 12:8, 13:7, 14:5, 15:6, 16:10, 17:9, 18:7,
  };

  // Build evenly-spaced slots as ET wall-clock times, each resolved to a real instant.
  // Adding milliseconds to a midnight timestamp (the old approach) breaks across a DST
  // boundary, because the day is 23 or 25 hours long — so the wall clock is computed
  // first and converted second.
  const base = etParts(baseDate);
  const slots: Date[] = Array.from({ length: count }, (_, i) => {
    const minFromMidnightET = startMinET + Math.round(i * interval);
    return etToUtc(
      base.year, base.month, base.day,
      Math.floor(minFromMidnightET / 60),
      minFromMidnightET % 60,
    );
  });

  // Score each slot by its actual ET hour.
  const scored = slots.map((d, i) => ({ i, slot: d, score: engHour[etParts(d).hour] ?? 5 }));
  // Sort slot indices by engagement descending
  const slotsByEng = [...scored].sort((a, b) => b.score - a.score).map(s => s.i);

  // Assign tweet[i] (sorted by trendScore desc already) → slot with ith highest engagement
  const assigned: Array<{ time: string; content: string; trendScore: number; title: string; sourceUrl?: string }> = new Array(count);
  for (let ti = 0; ti < count; ti++) {
    assigned[ti] = {
      time: slots[slotsByEng[ti]].toISOString(),
      // Prefer the tagged variant from the hashtag pass; fall back to the bare post
      // for reports generated before that pass existed.
      content: tweets[ti].socialPostWithTags || tweets[ti].socialPost,
      trendScore: tweets[ti].trendScore ?? (count - ti),
      title: tweets[ti].title,
      // Carried so the poster can cite it in a reply rather than in the post body.
      sourceUrl: tweets[ti].url,
    };
  }

  // Return sorted chronologically
  return assigned.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
}

// ─── Background Tasks ──────────────────────────────────────────────────────────

// Seed default weekly report schedule if none exist
try {
  const allDefaults = [
    { type: 'global',       days: '5', time: '06:00' }, // Friday
    { type: 'crypto',       days: '1', time: '06:00' }, // Monday
    { type: 'nasdaq',       days: '2', time: '06:00' }, // Tuesday
    { type: 'conspiracies', days: '3', time: '06:00' }, // Wednesday
    { type: 'equities',     days: '4', time: '06:00' }, // Thursday
    { type: 'forecast',     days: '0', time: '06:00' }, // Sunday
    { type: 'speculation',  days: '6', time: '06:00' }, // Saturday
    { type: 'china',        days: '3', time: '12:00' }, // Wednesday (afternoon)
  ];
  const insert = db.prepare("INSERT INTO scheduled_reports (report_type, schedule_time, days, enabled) VALUES (?, ?, ?, 1)");
  for (const d of allDefaults) {
    const exists = db.prepare("SELECT COUNT(*) as c FROM scheduled_reports WHERE report_type = ?").get(d.type) as any;
    if (exists.c === 0) {
      insert.run(d.type, d.time, d.days);
      console.log(`[Seed] Added missing schedule: ${d.type}`);
    }
  }
} catch (err) {
  console.error("[Seed] Failed to seed schedules:", err);
}

let isCronRunning = false; // Lock to prevent overlapping cron executions

// Remembers which (schedule, ET day) pairs have already logged a miss, so a report that
// blew past its catch-up window warns once rather than every 60 seconds until midnight.
const reportSkipLogged = new Set<string>();

// ─── Nightly database backup ───────────────────────────────────────────────────
//
// Logic lives in src/services/backup.ts so `npm run backup` can use the same code path.
function runBackup(): void {
  try {
    const { target, bytes, pruned } = backupDatabase(db);
    log.info('db_backup_written', { target, bytes, pruned });
  } catch (err) {
    log.error('db_backup_failed', errInfo(err));
    void notifyOps(
      'Nightly database backup failed',
      `The SQLite backup did not complete. The database holds your X tokens, reports and spend ledger, and is not stored anywhere else.\n\nError: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// On boot, then daily. Backing up at startup matters because this app runs on a laptop
// that sleeps: an app up for only part of each day would otherwise keep resetting a 24h
// timer it never reaches. Same "the machine isn't always on" problem as the publisher.
runBackup();
setInterval(runBackup, 24 * 60 * 60 * 1000);

// Clean up stale pending_auth records older than 1 hour (abandoned OAuth flows)
setInterval(() => {
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    db.prepare("DELETE FROM pending_auth WHERE created_at < ?").run(oneHourAgo);
  } catch { /* non-critical */ }
}, 15 * 60 * 1000); // every 15 minutes

setInterval(async () => {
  if (isCronRunning) return;
  isCronRunning = true;

  // Process scheduled social posts
  try {
    const nowIso = new Date().toISOString();

    // Expire slots that are too late to be worth publishing.
    //
    // This runs BEFORE the kill-switch check on purpose: if posting is paused, stale
    // rows must still age out, otherwise re-enabling the switch would dump an entire
    // paused period's backlog onto the live account at once.
    //
    // Scoped to APPROVED posts. A draft sitting past its proposed time isn't "missed" —
    // it was simply never approved, and it stays in the queue for Mike to deal with.
    const latenessCutoff = new Date(Date.now() - MAX_SLOT_LATENESS_MIN * 60_000).toISOString();
    const overdue = db.prepare(
      `SELECT id, scheduled_at, substr(body, 1, 80) preview FROM posts
       WHERE status='approved' AND time_confirmed=1 AND scheduled_at < ?`
    ).all(latenessCutoff) as any[];

    if (overdue.length) {
      db.prepare(
        `UPDATE posts SET status='skipped',
           error='missed slot — more than ${MAX_SLOT_LATENESS_MIN} min late, skipped rather than publishing stale content',
           updated_at=CURRENT_TIMESTAMP
         WHERE status='approved' AND time_confirmed=1 AND scheduled_at < ?`
      ).run(latenessCutoff);

      log.warn('posts_skipped_stale', {
        count: overdue.length,
        lateness_limit_min: MAX_SLOT_LATENESS_MIN,
        ids: overdue.map(o => o.id),
      });

      // The operator needs to know a slot was dropped — silence here reads as "it posted".
      void notifyOps(
        `${overdue.length} scheduled post${overdue.length === 1 ? '' : 's'} skipped`,
        [
          `${overdue.length} post(s) were more than ${MAX_SLOT_LATENESS_MIN} minutes past their slot and were skipped rather than published stale.`,
          '',
          'This usually means the machine was asleep or the app was not running.',
          '',
          ...overdue.map(o => `  · #${o.id}  due ${o.scheduled_at}  "${o.preview}…"`),
        ].join('\n'),
      );
    }

    if (!isPostingEnabled()) {
      log.warn('posting_disabled_skip');
    } else {
      // Reclaim rows stranded by a crash. Deliberately marked failed, NOT retried: if the
      // crash happened after the API call, retrying would post a duplicate. Losing a post
      // is recoverable; double-posting to a public account is not.
      const stale = db.prepare(
        `UPDATE posts SET status='failed', error='stranded in posting state — not retried to avoid duplicate',
                          updated_at=CURRENT_TIMESTAMP
         WHERE status='posting' AND claimed_at < ?`
      ).run(new Date(Date.now() - CLAIM_TIMEOUT_MIN * 60_000).toISOString());
      if (stale.changes) log.warn('posts_stranded_reclaimed', { count: stale.changes });

      // ─── The approval gate ───
      //
      // Only `approved` posts with a CONFIRMED time are sendable. Both halves matter:
      // status alone would let a post go out at a time Mike never agreed to (the
      // generator's proposed slot), and a confirmed time alone would send unreviewed
      // text. Draft, needs_review, skipped and archived are all unreachable from here.
      //
      // This also replaces the old `kind='tweet'` filter — the Instagram/Substack
      // reminders migrated in as 'archived' and can never satisfy this predicate.
      const due = db.prepare(
        `SELECT * FROM posts
         WHERE status='approved' AND time_confirmed=1 AND scheduled_at <= ?
         ORDER BY scheduled_at ASC LIMIT ?`
      ).all(nowIso, MAX_POSTS_PER_RUN) as any[];

      const backlog = db.prepare(
        `SELECT COUNT(*) c FROM posts
         WHERE status='approved' AND time_confirmed=1 AND scheduled_at <= ?`
      ).get(nowIso) as any;
      if (backlog.c > due.length) {
        // Never silently truncate — a growing backlog means something upstream is wrong.
        log.warn('post_backlog_capped', { due: backlog.c, cap: MAX_POSTS_PER_RUN, deferred: backlog.c - due.length });
      }

      for (const post of due) {
        const tokenRecord = getXTokenRecord(post.user_id);
        if (!tokenRecord) { log.warn('post_skipped_no_token', { id: post.id, user: post.user_id }); continue; }

        // Atomic claim: the WHERE re-asserts the full approval predicate, so a post
        // un-approved between the SELECT and here is dropped rather than sent.
        const claimed = db.prepare(
          `UPDATE posts SET status='posting', claimed_at=?, attempts=COALESCE(attempts,0)+1,
                            updated_at=CURRENT_TIMESTAMP
           WHERE id=? AND status='approved' AND time_confirmed=1`
        ).run(new Date().toISOString(), post.id);
        if (!claimed.changes) continue;

        if (POSTING_DRY_RUN) {
          db.prepare("UPDATE posts SET status='approved', claimed_at=NULL WHERE id=?").run(post.id);
          log.info('post_dry_run', { id: post.id, chars: (post.body || '').length, preview: (post.body || '').slice(0, 80) });
          continue;
        }

        try {
          const accessToken = await refreshXToken(tokenRecord);
          const client = new TwitterApi(accessToken);
          const posted = await client.v2.tweet(post.body);
          db.prepare(
            "UPDATE posts SET status='posted', x_post_id=?, posted_at=CURRENT_TIMESTAMP, error=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=?"
          ).run(posted.data.id, post.id);
          recordSpend(xSpend('post', 1, { post_id: post.id, tweet_id: posted.data.id }));
          log.info('post_published', { id: post.id, tweet_id: posted.data.id, chars: (post.body || '').length });

          // Cite the source as a REPLY, never in the body — a link in the post costs 30-50%
          // of reach. A failed reply must not mark the post failed; the post already went out.
          if (POST_SOURCE_AS_REPLY && post.source_url) {
            try {
              await client.v2.tweet({ text: `Source: ${post.source_url}`, reply: { in_reply_to_tweet_id: posted.data.id } });
              // Billed at the URL rate — this is the cost of citing sources.
              recordSpend(xSpend('post_with_link', 1, { post_id: post.id, kind: 'source_reply' }));
              log.info('source_reply_published', { id: post.id });
            } catch (replyErr) {
              log.warn('source_reply_failed', { id: post.id, ...errInfo(replyErr) });
            }
          }
        } catch (error) {
          const msg = String(error instanceof Error ? error.message : error).slice(0, 500);
          db.prepare("UPDATE posts SET status='failed', error=?, updated_at=CURRENT_TIMESTAMP WHERE id=?")
            .run(msg, post.id);
          log.error('post_failed', { id: post.id, ...errInfo(error) });
          // A 'failed' row is terminal — nothing re-queues it automatically, so an
          // unnoticed failure is a silently missing post.
          void notifyOps(
            `Scheduled post #${post.id} failed to publish`,
            `Post #${post.id} (due ${post.scheduled_at}) could not be published and has been marked failed. It will NOT be retried automatically.\n\nError: ${msg}\n\nPreview: "${String(post.body || '').slice(0, 200)}…"`,
          );
        }
      }
    }
  } catch (err) {
    log.error('scheduled_posts_task_error', errInfo(err));
  }

  // Process scheduled report generation
  try {
    const now = new Date();
    const nowEt = etParts(now);
    const todayEt = etDateString(now);
    const nowMinEt = etMinutesOfDay(now);

    // All comparisons are in Eastern. `schedule_time` was previously matched against
    // server-LOCAL time, which on this machine (America/Los_Angeles) meant a schedule
    // labelled "06:00 EST" in the UI actually fired at 6am Pacific.
    const schedules = db.prepare("SELECT * FROM scheduled_reports WHERE enabled = 1").all() as any[];

    for (const schedule of schedules) {
      const scheduleDays = String(schedule.days || '').split(',').map((d: string) => d.trim()).filter(Boolean);
      if (!scheduleDays.includes(String(nowEt.weekday))) continue;

      // Already generated today (Eastern calendar day)?
      if (schedule.last_run && etDateString(parseSqliteUtc(schedule.last_run)) === todayEt) continue;

      const schedMinEt = parseHhMm(schedule.schedule_time);
      if (schedMinEt === null) {
        log.warn('report_schedule_time_unparseable', { id: schedule.id, type: schedule.report_type, value: schedule.schedule_time });
        continue;
      }

      // Window, not an exact minute match. The old `schedule_time = ?` required the tick
      // to land on precisely the right HH:MM — one skewed or missed tick (asleep, busy,
      // restarting) and the report silently never generated that day.
      const lateByMin = nowMinEt - schedMinEt;
      if (lateByMin < 0) continue; // not due yet today

      if (lateByMin > MAX_REPORT_LATENESS_MIN) {
        // Too late to be worth catching up. Log once per ET day rather than every
        // 60 seconds until midnight.
        const key = `${schedule.id}:${todayEt}`;
        if (!reportSkipLogged.has(key)) {
          reportSkipLogged.add(key);
          log.warn('report_schedule_missed', {
            id: schedule.id, type: schedule.report_type,
            due: schedule.schedule_time, late_by_min: lateByMin, limit_min: MAX_REPORT_LATENESS_MIN,
          });
          void notifyOps(
            `Scheduled report "${schedule.report_type}" missed`,
            `The ${schedule.report_type} report was due at ${schedule.schedule_time} ET and is now ${Math.round(lateByMin / 60)}h late, past the ${Math.round(MAX_REPORT_LATENESS_MIN / 60)}h catch-up window. It was not generated today.\n\nThis usually means the machine was asleep or the app was not running.`,
          );
        }
        continue;
      }

      if (lateByMin > 2) {
        log.info('report_schedule_catchup', { id: schedule.id, type: schedule.report_type, late_by_min: lateByMin });
      }

      try {
        console.log(`[Cron] Generating scheduled ${schedule.report_type} report...`);
        const isF = schedule.report_type === 'forecast';
        const isSpec = schedule.report_type === 'speculation';
        const report = isF
          ? await generateForecastReport()
          : isSpec
            ? await generateSpeculationReport()
            : await generateWeeklyReport(schedule.report_type, schedule.custom_topic || undefined, undefined, getContentGuidance());
        const reportId = `${schedule.report_type}-${Date.now()}`;
        const reportJson = JSON.stringify(report);
        db.prepare(`
          INSERT INTO reports (id, type, content, custom_topic, auto_generated, updated_at)
          VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
        `).run(reportId, schedule.report_type, reportJson, schedule.custom_topic || null);
        db.prepare("UPDATE scheduled_reports SET last_run = CURRENT_TIMESTAMP WHERE id = ?").run(schedule.id);
        console.log(`[Cron] ✓ Scheduled report generated: ${reportId}`);

        // Auto-send email digest if configured
        const digestEmailRow = db.prepare("SELECT value FROM app_settings WHERE key = 'digest_email'").get() as any;
        const digestEmail = digestEmailRow?.value;
        if (digestEmail && process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
          try {
            const r = report as any;
            const headlines = r.headlines || r.events || [];
            const summary = r.analysis?.overallSummary || r.analysis?.dominantTheme || '';
            const headlinesHtml = headlines.slice(0, 8).map((h: any, i: number) => `
              <tr style="border-bottom:1px solid #1a1a1a;">
                <td style="padding:12px 8px;color:#f7931a;font-family:monospace;width:24px;">${String(i + 1).padStart(2, '0')}</td>
                <td style="padding:12px 8px;">
                  <p style="margin:0 0 4px;color:#ffffff;font-weight:600;">${escapeHtml(h.title || h.expectedDate || '')}</p>
                  ${h.summary ? `<p style="margin:0;font-size:12px;color:#888;">${escapeHtml(h.summary.substring(0, 200))}</p>` : ''}
                </td>
              </tr>`).join('');
            const typeLabel = schedule.report_type.charAt(0).toUpperCase() + schedule.report_type.slice(1);
            const html = `
              <div style="background:#0a0a0a;color:#e5e5e5;font-family:sans-serif;max-width:700px;margin:0 auto;padding:32px;">
                <div style="border-bottom:1px solid rgba(247,147,26,0.3);padding-bottom:24px;margin-bottom:24px;">
                  <p style="color:#f7931a;font-family:monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.3em;margin:0 0 8px;">ChokePoint Macro — Auto Report</p>
                  <h1 style="color:#ffffff;font-size:32px;font-style:italic;margin:0;">${escapeHtml(typeLabel)} Pulse.</h1>
                  <p style="color:#888;font-size:12px;margin:8px 0 0;">${new Date().toLocaleDateString('en-US', { weekday:'long',year:'numeric',month:'long',day:'numeric' })}</p>
                </div>
                ${summary ? `<div style="background:rgba(247,147,26,0.05);border:1px solid rgba(247,147,26,0.2);padding:20px;margin-bottom:24px;">
                  <p style="color:#f7931a;font-family:monospace;font-size:10px;text-transform:uppercase;letter-spacing:0.2em;margin:0 0 12px;">Summary</p>
                  <p style="color:#d1d5db;line-height:1.6;margin:0;">${escapeHtml(summary.substring(0, 600))}</p>
                </div>` : ''}
                <table style="width:100%;border-collapse:collapse;">${headlinesHtml}</table>
                <div style="margin-top:32px;padding-top:16px;border-top:1px solid rgba(247,147,26,0.1);text-align:center;">
                  <p style="color:#444;font-family:monospace;font-size:10px;text-transform:uppercase;margin:0;">ChokePoint Macro · Automated Digest</p>
                </div>
              </div>`;
            const transporter = nodemailer.createTransport({
              host: process.env.SMTP_HOST,
              port: parseInt(process.env.SMTP_PORT || "587"),
              secure: process.env.SMTP_PORT === "465",
              auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
            });
            await transporter.sendMail({
              from: process.env.SMTP_FROM || process.env.SMTP_USER,
              to: digestEmail,
              subject: `${typeLabel} Brief — ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`,
              html,
            });
            console.log(`[Cron] ✓ Email digest sent to ${digestEmail}`);
          } catch (emailErr) {
            console.error(`[Cron] Email digest failed:`, emailErr);
          }
        }
      } catch (err) {
        console.error(`[Cron] Failed to generate scheduled report ${schedule.id}:`, err);
      }
    }
  } catch (err) {
    console.error("Scheduled reports task error:", err);
  }
  
  isCronRunning = false;
}, 60000);

// ─── Watchlist ────────────────────────────────────────────────────────────────

app.get("/api/watchlist", requireAuth, (req, res) => {
  const userId = (req.session as any).userId;
  const rows = db.prepare("SELECT symbol, name, type, added_at FROM watchlist WHERE user_id = ? ORDER BY added_at ASC").all(userId);
  res.json(rows);
});

app.post("/api/watchlist", requireAuth, (req, res) => {
  const userId = (req.session as any).userId;
  const { symbol, name, type } = req.body;
  if (!symbol) return res.status(400).json({ error: "symbol required" });
  try {
    db.prepare("INSERT OR IGNORE INTO watchlist (user_id, symbol, name, type) VALUES (?, ?, ?, ?)").run(userId, symbol.toUpperCase(), name || symbol, type || "EQUITY");
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.delete("/api/watchlist/:symbol", requireAuth, (req, res) => {
  const userId = (req.session as any).userId;
  db.prepare("DELETE FROM watchlist WHERE user_id = ? AND symbol = ?").run(userId, req.params.symbol.toUpperCase());
  res.json({ success: true });
});

// ─── Markets / Live Data ───────────────────────────────────────────────────────
// Extracted to src/server/markets.ts (self-contained: no db, no shared helpers).
app.use(createMarketsRouter());

// ─── Post Queue ────────────────────────────────────────────────────────────────
// Phase A: post types only. The queue itself (timeline, detail panel) lands in B–C.
app.use(createPostQueueRouter({ db, requireAuth }));

// ─── Connections / Live API Status ────────────────────────────────────────────

// Ping a single service — returns { status, latencyMs, error?, rateLimits?, meta? }
async function pingService(id: string): Promise<{ status: 'live' | 'error' | 'unconfigured'; latencyMs: number; error?: string; rateLimits?: any; meta?: any }> {
  const start = Date.now();
  try {
    switch (id) {
      case 'anthropic': {
        if (!process.env.ANTHROPIC_API_KEY) return { status: 'unconfigured', latencyMs: 0 };
        const Anthropic = (await import("@anthropic-ai/sdk")).default;
        const client = new Anthropic();
        const { data: resp, response: raw } = await client.messages.create({
          model: "claude-sonnet-4-6", max_tokens: 5,
          messages: [{ role: "user", content: "ping" }],
        }).withResponse();
        const rl = {
          limitRequests: parseInt(raw.headers.get('x-ratelimit-limit-requests') || '') || undefined,
          limitTokens: parseInt(raw.headers.get('x-ratelimit-limit-tokens') || '') || undefined,
          remainingRequests: parseInt(raw.headers.get('x-ratelimit-remaining-requests') || '') || undefined,
          remainingTokens: parseInt(raw.headers.get('x-ratelimit-remaining-tokens') || '') || undefined,
          resetRequests: raw.headers.get('x-ratelimit-reset-requests') || undefined,
          resetTokens: raw.headers.get('x-ratelimit-reset-tokens') || undefined,
        };
        aiRateLimits.anthropic = { ...rl, inputTokensUsed: resp.usage?.input_tokens, outputTokensUsed: resp.usage?.output_tokens, lastCallAt: new Date().toISOString(), lastModel: "claude-sonnet-4-6" };
        return { status: 'live', latencyMs: Date.now() - start, rateLimits: rl, meta: { model: "claude-sonnet-4-6" } };
      }
      case 'openai': {
        if (!process.env.OPENAI_API_KEY) return { status: 'unconfigured', latencyMs: 0 };
        const OpenAI = (await import("openai")).default;
        const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        await client.chat.completions.create({ model: "gpt-4o", max_tokens: 5, messages: [{ role: "user", content: "ping" }] });
        return { status: 'live', latencyMs: Date.now() - start, meta: { model: "gpt-4o" } };
      }
      case 'gemini': {
        if (!process.env.GEMINI_API_KEY) return { status: 'unconfigured', latencyMs: 0 };
        const { GoogleGenAI } = await import("@google/genai");
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const geminiModels = ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro"];
        let geminiOk = false;
        let usedModel = "";
        for (const gm of geminiModels) {
          try {
            const resp = await ai.models.generateContent({ model: gm, contents: [{ parts: [{ text: "ping" }], role: "user" }] });
            aiRateLimits.gemini = { inputTokensUsed: (resp as any).usageMetadata?.promptTokenCount, outputTokensUsed: (resp as any).usageMetadata?.candidatesTokenCount, lastCallAt: new Date().toISOString(), lastModel: gm };
            usedModel = gm;
            geminiOk = true;
            break;
          } catch { continue; }
        }
        if (!geminiOk) throw new Error("All Gemini models unavailable");
        return { status: 'live', latencyMs: Date.now() - start, meta: { model: usedModel } };
      }
      case 'x': {
        if (!hasValidCreds('x')) return { status: 'unconfigured', latencyMs: 0 };
        const tokenRow = db.prepare("SELECT access_token FROM platform_tokens WHERE platform = 'x'").get() as any;
        if (!tokenRow?.access_token) return { status: 'error', latencyMs: 0, error: 'No OAuth token — sign in via Settings' };
        const { TwitterApi } = await import("twitter-api-v2");
        const client = new TwitterApi(tokenRow.access_token);
        const me = await client.v2.me();
        return { status: 'live', latencyMs: Date.now() - start, meta: { user: `@${me.data?.username}` } };
      }
      case 'linkedin': {
        if (!hasValidCreds('linkedin')) return { status: 'unconfigured', latencyMs: 0 };
        const tokenRow = db.prepare("SELECT access_token FROM platform_tokens WHERE platform = 'linkedin'").get() as any;
        if (!tokenRow?.access_token) return { status: 'error', latencyMs: 0, error: 'No OAuth token — connect in Settings' };
        const r = await fetch('https://api.linkedin.com/v2/userinfo', { headers: { Authorization: `Bearer ${tokenRow.access_token}` } });
        if (!r.ok) return { status: 'error', latencyMs: Date.now() - start, error: `HTTP ${r.status}` };
        const data = await r.json();
        return { status: 'live', latencyMs: Date.now() - start, meta: { user: data.name || data.sub } };
      }
      case 'bluesky': {
        const tokenRow = db.prepare("SELECT access_token, person_urn FROM platform_tokens WHERE platform = 'bluesky'").get() as any;
        if (!tokenRow?.access_token) return { status: 'error', latencyMs: 0, error: 'No credentials — connect in Settings' };
        // Bluesky tokens are short-lived, just check if we have one stored
        return { status: 'live', latencyMs: Date.now() - start, meta: { handle: tokenRow.person_urn || 'connected' } };
      }
      case 'threads': {
        if (!hasValidCreds('threads')) return { status: 'unconfigured', latencyMs: 0 };
        const tokenRow = db.prepare("SELECT access_token FROM platform_tokens WHERE platform = 'threads'").get() as any;
        if (!tokenRow?.access_token) return { status: 'error', latencyMs: 0, error: 'No OAuth token — connect in Settings' };
        const r = await fetch(`https://graph.threads.net/v1.0/me?fields=id,username&access_token=${tokenRow.access_token}`);
        if (!r.ok) return { status: 'error', latencyMs: Date.now() - start, error: `HTTP ${r.status}` };
        const data = await r.json();
        return { status: 'live', latencyMs: Date.now() - start, meta: { user: `@${data.username}` } };
      }
      case 'instagram': {
        const tokenRow = db.prepare("SELECT access_token, person_urn FROM platform_tokens WHERE platform = 'instagram'").get() as any;
        if (!tokenRow?.access_token) return { status: 'error', latencyMs: 0, error: 'No OAuth token — connect in Settings' };
        const igId = tokenRow.person_urn;
        const r = await fetch(`https://graph.facebook.com/v18.0/${igId}?fields=username&access_token=${tokenRow.access_token}`);
        if (!r.ok) return { status: 'error', latencyMs: Date.now() - start, error: `HTTP ${r.status}` };
        const data = await r.json();
        return { status: 'live', latencyMs: Date.now() - start, meta: { user: `@${data.username}` } };
      }
      case 'substack': {
        const substackRow = db.prepare("SELECT key_value FROM platform_credentials WHERE platform = 'substack' AND key_name = 'subdomain'").get() as any;
        if (!substackRow?.key_value) return { status: 'error', latencyMs: 0, error: 'No subdomain configured — set in Settings' };
        return { status: 'live', latencyMs: Date.now() - start, meta: { subdomain: substackRow.key_value } };
      }
      case 'vercel': {
        const r = await fetch('https://api.vercel.com/v6/deployments?limit=1', {
          headers: process.env.VERCEL_TOKEN ? { Authorization: `Bearer ${process.env.VERCEL_TOKEN}` } : {},
        });
        if (r.status === 403 || r.status === 401) return { status: process.env.VERCEL_TOKEN ? 'error' : 'unconfigured', latencyMs: Date.now() - start, error: !process.env.VERCEL_TOKEN ? 'Set VERCEL_TOKEN in .env' : 'Invalid token' };
        return { status: 'live', latencyMs: Date.now() - start };
      }
      case 'sentry': {
        if (!process.env.SENTRY_DSN) return { status: 'unconfigured', latencyMs: 0, error: 'Set SENTRY_DSN in .env' };
        // Sentry DSN is a URL — just validate it parses and the host resolves
        const dsnUrl = new URL(process.env.SENTRY_DSN);
        const r = await fetch(`${dsnUrl.protocol}//${dsnUrl.host}/api/0/`, { method: 'GET' });
        return { status: 'live', latencyMs: Date.now() - start, meta: { host: dsnUrl.host } };
      }
      case 'posthog': {
        if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return { status: 'unconfigured', latencyMs: 0, error: 'Set NEXT_PUBLIC_POSTHOG_KEY in .env' };
        const host = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';
        const r = await fetch(`${host}/decide?v=3`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_key: process.env.NEXT_PUBLIC_POSTHOG_KEY, distinct_id: 'ping' }) });
        if (!r.ok) return { status: 'error', latencyMs: Date.now() - start, error: `HTTP ${r.status}` };
        return { status: 'live', latencyMs: Date.now() - start };
      }
      case 'pinecone': {
        if (!process.env.PINECONE_API_KEY) return { status: 'unconfigured', latencyMs: 0, error: 'Set PINECONE_API_KEY in .env' };
        const r = await fetch('https://api.pinecone.io/indexes', { headers: { 'Api-Key': process.env.PINECONE_API_KEY } });
        if (!r.ok) return { status: 'error', latencyMs: Date.now() - start, error: `HTTP ${r.status}` };
        const data = await r.json();
        const count = Array.isArray(data.indexes) ? data.indexes.length : 0;
        return { status: 'live', latencyMs: Date.now() - start, meta: { indexes: `${count} indexes` } };
      }
      case 'upstash': {
        if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return { status: 'unconfigured', latencyMs: 0, error: 'Set UPSTASH_REDIS_REST_URL & TOKEN in .env' };
        const r = await fetch(`${process.env.UPSTASH_REDIS_REST_URL}/ping`, { headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` } });
        if (!r.ok) return { status: 'error', latencyMs: Date.now() - start, error: `HTTP ${r.status}` };
        return { status: 'live', latencyMs: Date.now() - start };
      }
      case 'supabase': {
        if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return { status: 'unconfigured', latencyMs: 0, error: 'Set SUPABASE_URL & SERVICE_ROLE_KEY in .env' };
        const r = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/`, { headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` } });
        if (!r.ok) return { status: 'error', latencyMs: Date.now() - start, error: `HTTP ${r.status}` };
        return { status: 'live', latencyMs: Date.now() - start };
      }
      case 'clerk': {
        if (!process.env.CLERK_SECRET_KEY) return { status: 'unconfigured', latencyMs: 0, error: 'Set CLERK_SECRET_KEY in .env' };
        const r = await fetch('https://api.clerk.com/v1/users?limit=1', { headers: { Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}` } });
        if (!r.ok) return { status: 'error', latencyMs: Date.now() - start, error: `HTTP ${r.status}` };
        return { status: 'live', latencyMs: Date.now() - start };
      }
      case 'resend': {
        if (!process.env.RESEND_API_KEY) return { status: 'unconfigured', latencyMs: 0, error: 'Set RESEND_API_KEY in .env' };
        const r = await fetch('https://api.resend.com/domains', { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` } });
        if (!r.ok) return { status: 'error', latencyMs: Date.now() - start, error: `HTTP ${r.status}` };
        const data = await r.json();
        const domains = Array.isArray(data.data) ? data.data.map((d: any) => d.name).join(', ') : '';
        return { status: 'live', latencyMs: Date.now() - start, meta: domains ? { domains } : undefined };
      }
      case 'cloudflare': {
        if (!process.env.CLOUDFLARE_API_TOKEN) return { status: 'unconfigured', latencyMs: 0, error: 'Set CLOUDFLARE_API_TOKEN in .env' };
        const r = await fetch('https://api.cloudflare.com/client/v4/user/tokens/verify', { headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` } });
        if (!r.ok) return { status: 'error', latencyMs: Date.now() - start, error: `HTTP ${r.status}` };
        return { status: 'live', latencyMs: Date.now() - start };
      }
      default:
        return { status: 'error', latencyMs: 0, error: 'Unknown service' };
    }
  } catch (err: any) {
    return { status: 'error', latencyMs: Date.now() - start, error: err.message?.slice(0, 120) || String(err) };
  }
}

// Connection definitions (static info)
const CONNECTION_DEFS = [
  { id: 'anthropic', name: 'Anthropic (Claude)', category: 'ai', tier: 'Max', knownLimits: { rpm: 4000, tpmInput: 400000, tpmOutput: 80000 } },
  { id: 'openai',    name: 'OpenAI (GPT-4o)',    category: 'ai', tier: 'Fallback', knownLimits: { rpm: 500, tpmInput: 800000, tpmOutput: 100000 } },
  { id: 'gemini',    name: 'Google Gemini',       category: 'ai', tier: 'Pay-as-you-go', knownLimits: { rpm: 1000, rpd: 1500, tpmInput: 4000000 } },
  { id: 'x',         name: 'X (Twitter)',         category: 'social', tier: 'Premium', knownLimits: { postsPerDay: 100, postsPerMonth: 3000 } },
  { id: 'linkedin',  name: 'LinkedIn',            category: 'social', tier: 'OAuth', knownLimits: { postsPerDay: 150 } },
  { id: 'bluesky',   name: 'Bluesky',             category: 'social', tier: 'AT Proto', knownLimits: { postsPerDay: 1666 } },
  { id: 'threads',   name: 'Threads',             category: 'social', tier: 'OAuth', knownLimits: { postsPerDay: 250 } },
  { id: 'instagram', name: 'Instagram',           category: 'social', tier: 'Graph API', knownLimits: { postsPerDay: 50 } },
  { id: 'substack',  name: 'Substack',            category: 'publishing', tier: 'API', knownLimits: {} },
  { id: 'vercel',    name: 'Vercel',              category: 'infra', tier: 'Pro', knownLimits: {} },
  { id: 'sentry',    name: 'Sentry',              category: 'infra', tier: 'Developer', knownLimits: {} },
  { id: 'posthog',   name: 'PostHog',             category: 'infra', tier: 'Free', knownLimits: {} },
  { id: 'pinecone',  name: 'Pinecone',            category: 'infra', tier: 'Starter', knownLimits: {} },
  { id: 'upstash',   name: 'Upstash',             category: 'infra', tier: 'Free', knownLimits: {} },
  { id: 'supabase',  name: 'Supabase',            category: 'infra', tier: 'Free', knownLimits: {} },
  { id: 'clerk',     name: 'Clerk',               category: 'infra', tier: 'Free', knownLimits: {} },
  { id: 'resend',    name: 'Resend',              category: 'infra', tier: 'Free', knownLimits: {} },
  { id: 'cloudflare',name: 'Cloudflare',          category: 'infra', tier: 'Free', knownLimits: {} },
];

// GET — returns all 9 connections with live ping status
app.get("/api/connections", async (_req, res) => {
  try {
    // Ping all 9 services in parallel
    const results = await Promise.all(
      CONNECTION_DEFS.map(async (def) => {
        const ping = await pingService(def.id);
        return {
          ...def,
          status: ping.status,
          latencyMs: ping.latencyMs,
          error: ping.error || null,
          meta: ping.meta || null,
          rateLimits: ping.rateLimits || aiRateLimits[def.id as keyof typeof aiRateLimits] || {},
          checkedAt: new Date().toISOString(),
        };
      })
    );
    res.json({ connections: results });
  } catch (err) {
    console.error("[Connections]", err);
    res.status(500).json({ error: String(err) });
  }
});

// POST — ping a single service on demand
app.post("/api/connections/ping/:provider", async (req, res) => {
  const { provider } = req.params;
  const def = CONNECTION_DEFS.find(d => d.id === provider);
  if (!def) return res.status(400).json({ error: `Unknown: ${provider}` });
  const ping = await pingService(provider);
  res.json({ ...def, ...ping, rateLimits: ping.rateLimits || aiRateLimits[provider as keyof typeof aiRateLimits] || {}, checkedAt: new Date().toISOString() });
});

// ─── Vite / Static ─────────────────────────────────────────────────────────────

async function startServer() {
  installProcessHandlers();
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve("dist")));
    app.get("*", (req, res) => res.sendFile(path.resolve("dist/index.html")));
  }
  // Local mode has no auth, so refuse to listen on anything but loopback — otherwise
  // anyone on the same network could post to X through this. LOCAL_MODE=false to open up.
  if (LOCAL_MODE) {
    // Bind BOTH loopback stacks: on macOS `localhost` resolves to ::1 first while
    // `127.0.0.1` is IPv4, and binding only one makes the other host silently fail.
    for (const host of ["127.0.0.1", "::1"]) {
      app.listen(PORT, host, () => console.log(`Server running on http://${host === "::1" ? "localhost" : host}:${PORT} (loopback only, auth bypassed)`));
    }
  } else {
    app.listen(PORT, "0.0.0.0", () => console.log(`Server running on http://localhost:${PORT}`));
  }
}

startServer();
