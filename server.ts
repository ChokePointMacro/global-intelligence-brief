import express from "express";
import { createServer as createViteServer } from "vite";
import session from "express-session";
import cookieParser from "cookie-parser";
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

import fs from "fs";

dotenv.config();

const app = express();
const PORT = 3000;

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

// ─── Auth Middleware ───────────────────────────────────────────────────────────

const requireAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
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
    resave: true,
    saveUninitialized: true,
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
    return !!(id && sec && !id.includes('dummy') && !sec.includes('dummy'));
  }
  if (platform === 'instagram') return !!(getPlatformCred('instagram', 'app_id') && getPlatformCred('instagram', 'app_secret'));
  if (platform === 'linkedin')  return !!(getPlatformCred('linkedin',  'client_id') && getPlatformCred('linkedin',  'client_secret'));
  if (platform === 'threads')   return !!(getPlatformCred('threads',   'app_id')    && getPlatformCred('threads',   'app_secret'));
  return false;
}

function getXClient(): TwitterApi {
  return new TwitterApi({
    clientId:     getPlatformCred('x', 'client_id'),
    clientSecret: getPlatformCred('x', 'client_secret'),
  });
}

if (!hasValidCreds('x')) {
  console.warn("⚠️  X credentials not configured — set them in Settings → Connected Networks.");
}

// ─── Auth helpers ──────────────────────────────────────────────────────────────

const getRedirectUri = (req: express.Request, platform = 'x') => {
  if (process.env.APP_URL) {
    return `${process.env.APP_URL}/auth/${platform}/callback`;
  }
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers.host;
  return `${protocol}://${host}/auth/${platform}/callback`;
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
      res.send(`<html><body><script>
        if (window.opener) {
          window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', sessionId: ${sid} }, '*');
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
  for (const key of requiredKeys) {
    if (!credentials[key]?.trim()) return res.status(400).json({ error: `Missing required field: ${key}` });
  }

  for (const key of requiredKeys) {
    db.prepare(`
      INSERT INTO platform_credentials (platform, key_name, key_value, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(platform, key_name) DO UPDATE SET key_value = excluded.key_value, updated_at = CURRENT_TIMESTAMP
    `).run(platform, key, credentials[key].trim());
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
      const redirectUri = getRedirectUri(req, 'x');
      getXClient().generateOAuth2AuthLink(redirectUri, { scope: ['tweet.read', 'users.read'] });
      return res.json({ ok: true });
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

    res.send(`<html><body><script>
      if (window.opener) { window.opener.postMessage({ type: 'OAUTH_LINKEDIN_SUCCESS' }, '*'); window.close(); }
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

    res.send(`<html><body><script>
      if (window.opener) { window.opener.postMessage({ type: 'OAUTH_THREADS_SUCCESS' }, '*'); window.close(); }
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
  db.prepare("DELETE FROM pending_auth WHERE state = ?").run(state);

  try {
    const redirectUri = getRedirectUri(req, 'x/connect');
    const { client: loggedClient, accessToken, refreshToken, expiresIn } = await getXClient().loginWithOAuth2({
      code: code as string,
      codeVerifier: pending.code_verifier,
      redirectUri,
    });

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
    `).run(userId || 'anonymous', accessToken, refreshToken || '', `@${xUser.username}`, expiresAt);

    const xHandle = JSON.stringify('@' + xUser.username);
    res.send(`<html><body><script>
      if (window.opener) {
        window.opener.postMessage({ type: 'OAUTH_X_CONNECT_SUCCESS', handle: ${xHandle} }, '*');
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
    res.send(`<html><body><script>
      if (window.opener) {
        window.opener.postMessage({ type: 'OAUTH_INSTAGRAM_SUCCESS', handle: ${igHandleJson} }, '*');
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

  // Post to X via OAuth 1.0a (free tier — uses app-level keys)
  if (platforms.includes('x')) {
    try {
      const apiKey    = process.env.X_API_KEY;
      const apiSecret = process.env.X_API_SECRET;
      const accToken  = process.env.X_ACCESS_TOKEN;
      const accSecret = process.env.X_ACCESS_SECRET;
      if (!apiKey || !apiSecret || !accToken || !accSecret) {
        throw new Error("X OAuth 1.0a credentials not configured");
      }
      const client = new TwitterApi({ appKey: apiKey, appSecret: apiSecret, accessToken: accToken, accessSecret: accSecret });
      const result = await client.v1.tweet(text.substring(0, 280));
      results.x = { success: true, id: result.id_str };
    } catch (err) {
      results.x = { success: false, error: err instanceof Error ? err.message : String(err) };
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

app.get("/api/debug/models", requireAuth, async (req, res) => {
  try {
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
    const response = await ai.models.list();
    const models = response.models.map(m => m.name);
    res.json({ models });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

const REPORT_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes max per report

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

    // Progress callback just logs server-side
    const logProgress = (stage: string, percent: number) => {
      console.log(`[API] ${type} progress: ${percent}% — ${stage}`);
    };

    let resultPromise: Promise<any>;

    if (type === 'forecast') {
      resultPromise = generateForecastReport(logProgress);
    } else if (type === 'speculation') {
      resultPromise = generateSpeculationReport(logProgress);
    } else {
      resultPromise = generateWeeklyReport(type, customTopic, logProgress);
    }

    const report = await Promise.race([resultPromise, timeoutPromise]);

    if (type === 'forecast') {
      if (!report?.events?.length) return res.status(500).json({ error: "Failed to generate forecast: no events returned" });
      console.log(`[API] Successfully generated forecast with ${report.events.length} events`);
    } else {
      if (!report?.headlines?.length) return res.status(500).json({ error: "Failed to generate report: no headlines returned" });
      console.log(`[API] Successfully generated ${type} report with ${report.headlines.length} headlines`);
    }

    res.json(report);
  } catch (error) {
    console.error("[API] Report generation error:", error);
    const message = error instanceof Error ? error.message : String(error);

    let errorType = "UNKNOWN";
    let userMessage = message;
    let statusCode = 500;

    if (message === "REPORT_TIMEOUT") {
      errorType = "TIMEOUT"; statusCode = 504;
      userMessage = "Report generation timed out after 3 minutes. The AI provider may be slow — please try again.";
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
          <p style="margin:0 0 4px;color:#ffffff;font-weight:600;">${h.title}</p>
          <span style="font-size:11px;color:#888;font-family:monospace;text-transform:uppercase;">${h.category}</span>
          ${h.sentiment ? `<span style="margin-left:8px;font-size:10px;color:#f7931a;font-family:monospace;">${h.sentiment}</span>` : ''}
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
          <p style="color:#d1d5db;line-height:1.6;margin:0;">${report.analysis.overallSummary.substring(0, 600)}...</p>
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

app.get("/api/app-settings/:key", (req, res) => {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(req.params.key) as any;
  res.json({ value: row?.value ?? null });
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

// ─── X Posting ─────────────────────────────────────────────────────────────────

async function refreshXToken(tokenRecord: any) {
  if (tokenRecord.expires_at && tokenRecord.expires_at > Date.now() + 60000) return tokenRecord.access_token;
  const client = new TwitterApi({ clientId: getPlatformCred('x', 'client_id'), clientSecret: getPlatformCred('x', 'client_secret') });
  const { accessToken, refreshToken, expiresIn } = await client.refreshOAuth2Token(tokenRecord.refresh_token);
  const expiresAt = Date.now() + expiresIn * 1000;
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
  if (text.length > 280) return res.status(400).json({ error: `Post too long: ${text.length}/280 characters` });

  try {
    const accessToken = await refreshXToken(tokenRecord);
    if (!accessToken) return res.status(401).json({ error: "Failed to authenticate - token is invalid" });

    const client = new TwitterApi(accessToken);
    const result = await client.v2.tweet(text);
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
  db.prepare(`INSERT INTO scheduled_posts (user_id, content, scheduled_at) VALUES (?, ?, ?)`).run(userId, content, scheduledAt);
  res.json({ success: true });
});

app.get("/api/scheduled-posts", (req, res) => {
  const userId = (req.session as any).userId;
  const posts = db.prepare("SELECT * FROM scheduled_posts WHERE user_id = ? ORDER BY scheduled_at ASC").all(userId);
  res.json(posts);
});

app.delete("/api/scheduled-posts/:id", (req, res) => {
  db.prepare("DELETE FROM scheduled_posts WHERE id = ? AND user_id = ?").run(req.params.id, (req.session as any).userId);
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
      items.push({ type: 'tweet', time: s.time, content: s.content, title: s.title, trendScore: s.trendScore, enabled: true });
    }
  }

  // Instagram reminder (9am EST = 14:00 UTC)
  const instaTime = new Date(nextDate.getTime() + 4 * 60 * 60 * 1000); // +4h from midnight EST = 9am EST
  items.push({ type: 'instagram', time: instaTime.toISOString(), content: 'Post your 21-slide Instagram carousel for today\'s report.', enabled: true });

  // Substack reminder (next Monday 9am EST)
  const nextMonday = getNextWeekday(1);
  const substackTime = new Date(nextMonday.getTime() + 4 * 60 * 60 * 1000);
  items.push({ type: 'substack', time: substackTime.toISOString(), content: 'Publish your Substack article for this week\'s intelligence brief.', enabled: true });

  // Sort chronologically
  items.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

  res.json({ reportType, nextDate: nextDate.toISOString(), items });
});

app.post("/api/auto-schedule/confirm", (req, res) => {
  const userId = (req.session as any).userId;
  if (!userId) return res.status(401).json({ error: "Not authenticated" });

  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: "No items provided" });

  let count = 0;
  for (const item of items) {
    if (!item.enabled) continue;
    const content = item.type === 'tweet' ? item.content :
                    item.type === 'instagram' ? `[INSTAGRAM] ${item.content}` :
                    `[SUBSTACK] ${item.content}`;
    db.prepare("INSERT INTO scheduled_posts (user_id, content, scheduled_at, status) VALUES (?, ?, ?, 'pending')")
      .run(userId, content, item.time);
    count++;
  }

  res.json({ success: true, scheduled: count });
});

// ─── Debug ─────────────────────────────────────────────────────────────────────

// ─── Context Files ─────────────────────────────────────────────────────────────

const CONTEXT_DIR = path.resolve('context');
if (!fs.existsSync(CONTEXT_DIR)) fs.mkdirSync(CONTEXT_DIR, { recursive: true });

const sanitizeFilename = (name: string) =>
  name.replace(/[^a-zA-Z0-9-_]/g, '-').replace(/-+/g, '-').slice(0, 80) + '.md';

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
  const filename = req.params.name.endsWith('.md') ? req.params.name : req.params.name + '.md';
  const filePath = path.join(CONTEXT_DIR, path.basename(filename));
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  res.json({ name: path.basename(filePath), content: fs.readFileSync(filePath, 'utf-8') });
});

app.post("/api/context-files", requireAuth, (req, res) => {
  const { name, content } = req.body;
  if (!name?.trim() || !content?.trim()) return res.status(400).json({ error: 'name and content required' });
  const filename = sanitizeFilename(name.trim().replace(/\.md$/, ''));
  const filePath = path.join(CONTEXT_DIR, filename);
  fs.writeFileSync(filePath, content.trim());
  res.json({ success: true, name: filename });
});

app.patch("/api/context-files/:name", requireAuth, (req, res) => {
  const filename = req.params.name.endsWith('.md') ? req.params.name : req.params.name + '.md';
  const filePath = path.join(CONTEXT_DIR, path.basename(filename));
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'content required' });
  fs.writeFileSync(filePath, content.trim());
  res.json({ success: true });
});

app.delete("/api/context-files/:name", requireAuth, (req, res) => {
  const filename = req.params.name.endsWith('.md') ? req.params.name : req.params.name + '.md';
  const filePath = path.join(CONTEXT_DIR, path.basename(filename));
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  fs.unlinkSync(filePath);
  res.json({ success: true });
});

app.get("/api/debug/session", (req, res) => {
  res.json({ sessionId: req.sessionID, userId: (req.session as any).userId });
});

// ─── Auto-Schedule Helpers ─────────────────────────────────────────────────────

// Returns the next Date (midnight EST) for the given day-of-week (0=Sun…6=Sat)
// If today IS that day, schedules for next week.
function getNextWeekday(targetDay: number): Date {
  const now = new Date();
  // EST = UTC-5; get current EST day-of-week
  const estNow = new Date(now.getTime() - 5 * 60 * 60 * 1000);
  let daysUntil = (targetDay - estNow.getDay() + 7) % 7;
  if (daysUntil === 0) daysUntil = 7;
  // Midnight EST = 05:00 UTC
  const result = new Date(estNow);
  result.setDate(result.getDate() + daysUntil);
  result.setUTCHours(5, 0, 0, 0); // midnight EST
  return result;
}

// Assign tweets to time slots from 7am–7pm EST, highest trendScore to highest engagement hour
function calculateTweetSlots(baseDate: Date, tweets: any[]): Array<{ time: string; content: string; trendScore: number; title: string }> {
  const count = tweets.length;
  if (count === 0) return [];

  const startMinEST = 7 * 60;  // 420
  const endMinEST  = 19 * 60;  // 1140
  const totalMins  = endMinEST - startMinEST; // 720
  const interval   = totalMins / count;

  // Finance/politics Twitter engagement score per EST hour
  const engHour: Record<number, number> = {
    7:8, 8:10, 9:9, 10:6, 11:5, 12:8, 13:7, 14:5, 15:6, 16:10, 17:9, 18:7,
  };

  // Build evenly-spaced slots (stored as UTC)
  const slots: Date[] = Array.from({ length: count }, (_, i) => {
    const minFromMidnightEST = startMinEST + Math.round(i * interval);
    const d = new Date(baseDate);
    // baseDate is midnight EST = 05:00 UTC; add EST minutes
    d.setTime(baseDate.getTime() + minFromMidnightEST * 60000);
    return d;
  });

  // Score each slot (EST hour = UTC hour - 5)
  const scored = slots.map((d, i) => ({ i, slot: d, score: engHour[d.getUTCHours() - 5] ?? 5 }));
  // Sort slot indices by engagement descending
  const slotsByEng = [...scored].sort((a, b) => b.score - a.score).map(s => s.i);

  // Assign tweet[i] (sorted by trendScore desc already) → slot with ith highest engagement
  const assigned: Array<{ time: string; content: string; trendScore: number; title: string }> = new Array(count);
  for (let ti = 0; ti < count; ti++) {
    assigned[ti] = {
      time: slots[slotsByEng[ti]].toISOString(),
      content: tweets[ti].socialPost,
      trendScore: tweets[ti].trendScore ?? (count - ti),
      title: tweets[ti].title,
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

setInterval(async () => {
  if (isCronRunning) return;
  isCronRunning = true;

  // Process scheduled social posts
  try {
    const pending = db.prepare("SELECT * FROM scheduled_posts WHERE status = 'pending' AND scheduled_at <= ?").all(new Date().toISOString()) as any[];
    for (const post of pending) {
      const tokenRecord = getXTokenRecord(post.user_id);
      if (!tokenRecord) continue;
      try {
        const accessToken = await refreshXToken(tokenRecord);
        const client = new TwitterApi(accessToken);
        await client.v2.tweet(post.content);
        db.prepare("UPDATE scheduled_posts SET status = 'posted' WHERE id = ?").run(post.id);
      } catch (error) {
        console.error(`Background task failed for post ${post.id}:`, error);
        db.prepare("UPDATE scheduled_posts SET status = 'failed' WHERE id = ?").run(post.id);
      }
    }
  } catch (err) {
    console.error("Scheduled posts task error:", err);
  }

  // Process scheduled report generation
  try {
    const now = new Date();
    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    const currentDay = now.getDay().toString();
    const todayStr = now.toISOString().split('T')[0];

    const schedules = db.prepare(`
      SELECT * FROM scheduled_reports
      WHERE enabled = 1
        AND schedule_time = ?
        AND (last_run IS NULL OR date(last_run) != ?)
    `).all(currentTime, todayStr) as any[];

    for (const schedule of schedules) {
      const scheduleDays = schedule.days.split(',').map((d: string) => d.trim());
      if (!scheduleDays.includes(currentDay)) continue;

      try {
        console.log(`[Cron] Generating scheduled ${schedule.report_type} report...`);
        const isF = schedule.report_type === 'forecast';
        const isSpec = schedule.report_type === 'speculation';
        const report = isF
          ? await generateForecastReport()
          : isSpec
            ? await generateSpeculationReport()
            : await generateWeeklyReport(schedule.report_type, schedule.custom_topic || undefined);
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
                  <p style="margin:0 0 4px;color:#ffffff;font-weight:600;">${h.title || h.expectedDate || ''}</p>
                  ${h.summary ? `<p style="margin:0;font-size:12px;color:#888;">${h.summary.substring(0, 200)}</p>` : ''}
                </td>
              </tr>`).join('');
            const typeLabel = schedule.report_type.charAt(0).toUpperCase() + schedule.report_type.slice(1);
            const html = `
              <div style="background:#0a0a0a;color:#e5e5e5;font-family:sans-serif;max-width:700px;margin:0 auto;padding:32px;">
                <div style="border-bottom:1px solid rgba(247,147,26,0.3);padding-bottom:24px;margin-bottom:24px;">
                  <p style="color:#f7931a;font-family:monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.3em;margin:0 0 8px;">ChokePoint Macro — Auto Report</p>
                  <h1 style="color:#ffffff;font-size:32px;font-style:italic;margin:0;">${typeLabel} Pulse.</h1>
                  <p style="color:#888;font-size:12px;margin:8px 0 0;">${new Date().toLocaleDateString('en-US', { weekday:'long',year:'numeric',month:'long',day:'numeric' })}</p>
                </div>
                ${summary ? `<div style="background:rgba(247,147,26,0.05);border:1px solid rgba(247,147,26,0.2);padding:20px;margin-bottom:24px;">
                  <p style="color:#f7931a;font-family:monospace;font-size:10px;text-transform:uppercase;letter-spacing:0.2em;margin:0 0 12px;">Summary</p>
                  <p style="color:#d1d5db;line-height:1.6;margin:0;">${summary.substring(0, 600)}</p>
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

// ─── Markets / Live Data (Public.com) ─────────────────────────────────────────

let publicAccessToken: string | null = null;
let publicTokenExpiry = 0;

// Price history for 24h change calculation: symbol → [{price, ts}]
const priceHistory: Record<string, { price: number; ts: number }[]> = {};
const HISTORY_THROTTLE = 60 * 1000; // Only store 1 point per minute to save memory

async function getPublicToken(): Promise<string> {
  if (publicAccessToken && Date.now() < publicTokenExpiry) return publicAccessToken;
  const res = await fetch("https://api.public.com/userapiauthservice/personal/access-tokens", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ validityInMinutes: 60, secret: process.env.PUBLIC_SECRET_KEY }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Public.com token exchange failed ${res.status}: ${body.slice(0, 200)}`);
  const data = JSON.parse(body) as any;
  publicAccessToken = data.accessToken;
  publicTokenExpiry = Date.now() + 55 * 60 * 1000;
  return publicAccessToken!;
}

const MARKET_INSTRUMENTS = [
  { symbol: "BTC",  type: "CRYPTO", name: "Bitcoin",      isCrypto: true },
  { symbol: "SPX",  type: "INDEX",  name: "S&P 500",      isIndex:  true },
  { symbol: "NDX",  type: "INDEX",  name: "Nasdaq-100",   isIndex:  true },
  { symbol: "MSTR", type: "EQUITY", name: "MicroStrategy"                },
  { symbol: "TSLA", type: "EQUITY", name: "Tesla"                        },
  { symbol: "MSFT", type: "EQUITY", name: "Microsoft"                    },
  { symbol: "META", type: "EQUITY", name: "Meta"                         },
  { symbol: "AAPL", type: "EQUITY", name: "Apple"                        },
  { symbol: "AMZN", type: "EQUITY", name: "Amazon"                       },
  { symbol: "NVDA", type: "EQUITY", name: "Nvidia"                       },
  { symbol: "AMD",  type: "EQUITY", name: "AMD"                          },
];

app.get("/api/markets", async (req, res) => {
  try {
    const token     = await getPublicToken();
    const accountId = process.env.PUBLIC_ACCOUNT_ID!;

    const pRes = await fetch(
      `https://api.public.com/userapigateway/marketdata/${accountId}/quotes`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ instruments: MARKET_INSTRUMENTS.map(i => ({ symbol: i.symbol, type: i.type })) }),
      }
    );

    if (!pRes.ok) {
      const err = await pRes.text();
      throw new Error(`Public.com quotes failed ${pRes.status}: ${err.slice(0, 200)}`);
    }

    const pData = await pRes.json() as any;
    const list: any[] = pData.quotes || [];

    // Build quote map keyed by instrument symbol
    const quoteMap: Record<string, any> = {};
    for (const q of list) {
      const sym = q.instrument?.symbol ?? q.symbol;
      if (sym) quoteMap[sym] = q;
    }

    const now = Date.now();
    const WINDOW = 25 * 60 * 60 * 1000; // 25 hours

    const result = MARKET_INSTRUMENTS.map(inst => {
      const q     = quoteMap[inst.symbol] || {};
      const price = q.last != null ? parseFloat(q.last) : null;

      // Update price history
      if (price != null) {
        const history = priceHistory[inst.symbol] || (priceHistory[inst.symbol] = []);
        const lastEntry = history[history.length - 1];
        
        // Optimization: Only push if enough time passed to avoid array bloat on high traffic
        if (!lastEntry || now - lastEntry.ts > HISTORY_THROTTLE) {
          history.push({ price, ts: now });
        }
        // Trim entries older than 25h
        priceHistory[inst.symbol] = priceHistory[inst.symbol].filter(e => now - e.ts < WINDOW);
      }

      // 24h change: compare with oldest entry ≥ 23h ago, else first available
      let change: number | null = null;
      let changePercent: number | null = null;
      const hist = priceHistory[inst.symbol] || [];
      if (price != null && hist.length > 1) {
        const old = hist.find(e => now - e.ts >= 23 * 60 * 60 * 1000) ?? hist[0];
        if (old && old.price) {
          change = price - old.price;
          changePercent = (change / old.price) * 100;
        }
      }

      const bid    = q.bid    != null ? parseFloat(q.bid)    : null;
      const ask    = q.ask    != null ? parseFloat(q.ask)    : null;
      const spread = bid != null && ask != null ? ask - bid : null;

      return {
        symbol:        inst.symbol,
        name:          inst.name,
        type:          inst.type,
        isCrypto:      (inst as any).isCrypto || false,
        isIndex:       (inst as any).isIndex  || false,
        price,
        change,
        changePercent,
        bid,
        ask,
        spread,
        volume:        q.volume != null ? Number(q.volume) : null,
        lastTimestamp: q.lastTimestamp ?? null,
        outcome:       q.outcome ?? null,
      };
    });

    res.json(result);
  } catch (err) {
    console.error("[Markets] Error:", err);
    res.status(500).json({ error: String(err) });
  }
});

// ─── Market History — 30-day candles (Yahoo Finance v8) ───────────────────────

const YAHOO_MAP: Record<string, string> = {
  BTC: "BTC-USD", SPX: "^GSPC", NDX: "^NDX",
  MSTR: "MSTR", TSLA: "TSLA", MSFT: "MSFT",
  META: "META", AAPL: "AAPL", AMZN: "AMZN", NVDA: "NVDA", AMD: "AMD",
};

app.get("/api/markets/history", async (_req, res) => {
  try {
    const results = await Promise.all(
      Object.entries(YAHOO_MAP).map(async ([sym, yahooSym]) => {
        try {
          const r = await fetch(
            `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?interval=1d&range=1mo`,
            { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" } }
          );
          if (!r.ok) return { symbol: sym, candles: [], pivotLevels: null };
          const j = await r.json() as any;
          const result = j.chart?.result?.[0];
          if (!result) return { symbol: sym, candles: [], pivotLevels: null };
          const timestamps: number[] = result.timestamp || [];
          const q = result.indicators?.quote?.[0] || {};
          const candles = timestamps.map((t, i) => ({
            t: t * 1000, o: q.open?.[i], h: q.high?.[i], l: q.low?.[i], c: q.close?.[i], v: q.volume?.[i],
          })).filter((c: any) => c.o != null && c.h != null && c.l != null && c.c != null);

          const last = candles[candles.length - 1] as any;
          const pivotLevels = last ? (() => {
            const p = (last.h + last.l + last.c) / 3;
            return {
              p, r1: 2*p - last.l, r2: p + (last.h - last.l), r3: last.h + 2*(p - last.l),
              s1: 2*p - last.h, s2: p - (last.h - last.l), s3: last.l - 2*(last.h - p),
            };
          })() : null;

          return { symbol: sym, candles, pivotLevels };
        } catch { return { symbol: sym, candles: [], pivotLevels: null }; }
      })
    );
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── Options — most traded contracts (Public.com option-chain) ────────────────

function nextMonthlyExpiry(): string {
  const now = new Date();
  for (let mo = 0; mo <= 3; mo++) {
    const d = new Date(now.getFullYear(), now.getMonth() + mo, 1);
    let fri = 0;
    while (fri < 3) { if (d.getDay() === 5) fri++; if (fri < 3) d.setDate(d.getDate() + 1); }
    if (d.getTime() - now.getTime() > 7 * 864e5) return d.toISOString().split("T")[0];
  }
  return "";
}

const EQUITY_SYMS = ["MSTR", "TSLA", "MSFT", "META", "AAPL", "AMZN", "NVDA", "AMD"];
let optionsCache: any = null;
let optionsCacheTime = 0;

app.get("/api/markets/options", async (_req, res) => {
  try {
    if (optionsCache && Date.now() - optionsCacheTime < 5 * 60 * 1000) return res.json(optionsCache);

    const token   = await getPublicToken();
    const acctId  = process.env.PUBLIC_ACCOUNT_ID!;
    const expiry  = nextMonthlyExpiry();

    const results = await Promise.all(
      EQUITY_SYMS.map(async (sym) => {
        try {
          const r = await fetch(
            `https://api.public.com/userapigateway/marketdata/${acctId}/option-chain`,
            {
              method: "POST",
              headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
              body: JSON.stringify({ instrument: { symbol: sym, type: "EQUITY" }, expirationDate: expiry }),
            }
          );
          if (!r.ok) return { symbol: sym, expiry, contracts: [] };
          const data = await r.json() as any;
          const calls = (data.calls || []).map((o: any) => ({ ...o, side: "CALL" }));
          const puts  = (data.puts  || []).map((o: any) => ({ ...o, side: "PUT" }));
          const top = [...calls, ...puts]
            .filter((o: any) => (o.volume || 0) > 0)
            .sort((a: any, b: any) => (b.volume || 0) - (a.volume || 0))
            .slice(0, 8)
            .map((o: any) => {
              const osiSym: string = o.instrument?.symbol || "";
              const strike = osiSym.length >= 8 ? parseInt(osiSym.slice(-8)) / 1000 : null;
              return {
                symbol: osiSym, side: o.side, strike,
                last:  o.last  != null ? parseFloat(o.last)  : null,
                bid:   o.bid   != null ? parseFloat(o.bid)   : null,
                ask:   o.ask   != null ? parseFloat(o.ask)   : null,
                volume: o.volume || 0,
                openInterest: o.openInterest || 0,
              };
            });
          return { symbol: sym, expiry, contracts: top };
        } catch { return { symbol: sym, expiry, contracts: [] }; }
      })
    );

    optionsCache = results;
    optionsCacheTime = Date.now();
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── Market Insights — AI-generated analysis from live data ──────────────────

let insightsCache: { text: string; ts: number } | null = null;
const INSIGHTS_TTL = 10 * 60 * 1000; // 10 minutes

app.get("/api/markets/insights", async (_req, res) => {
  if (insightsCache && Date.now() - insightsCache.ts < INSIGHTS_TTL) {
    return res.json({ text: insightsCache.text, cached: true, generatedAt: new Date(insightsCache.ts).toISOString() });
  }

  try {
    // Gather live prices
    const token     = await getPublicToken();
    const accountId = process.env.PUBLIC_ACCOUNT_ID!;
    const pRes = await fetch(
      `https://api.public.com/userapigateway/marketdata/${accountId}/quotes`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ instruments: MARKET_INSTRUMENTS.map(i => ({ symbol: i.symbol, type: i.type })) }),
      }
    );
    const pData = pRes.ok ? await pRes.json() as any : { quotes: [] };
    const quoteMap: Record<string, any> = {};
    for (const q of (pData.quotes || [])) {
      const sym = q.instrument?.symbol ?? q.symbol;
      if (sym) quoteMap[sym] = q;
    }

    // Gather 30-day history + pivots
    const historyData = await Promise.all(
      Object.entries(YAHOO_MAP).map(async ([sym, yahooSym]) => {
        try {
          const r = await fetch(
            `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?interval=1d&range=1mo`,
            { headers: { "User-Agent": "Mozilla/5.0" } }
          );
          if (!r.ok) return { sym, open30: null, close30: null, hi30: null, lo30: null, pivot: null };
          const j = await r.json() as any;
          const result = j.chart?.result?.[0];
          if (!result) return { sym, open30: null, close30: null, hi30: null, lo30: null, pivot: null };
          const ts: number[] = result.timestamp || [];
          const q2 = result.indicators?.quote?.[0] || {};
          const candles = ts.map((t, i) => ({
            o: q2.open?.[i], h: q2.high?.[i], l: q2.low?.[i], c: q2.close?.[i],
          })).filter((c: any) => c.o != null);
          if (!candles.length) return { sym, open30: null, close30: null, hi30: null, lo30: null, pivot: null };
          const last  = candles[candles.length - 1] as any;
          const first = candles[0] as any;
          const hi30  = Math.max(...candles.map((c: any) => c.h));
          const lo30  = Math.min(...candles.map((c: any) => c.l));
          const p = (last.h + last.l + last.c) / 3;
          return {
            sym, open30: first.o, close30: last.c, hi30, lo30,
            pivot: { p, r1: 2*p - last.l, s1: 2*p - last.h },
          };
        } catch { return { sym, open30: null, close30: null, hi30: null, lo30: null, pivot: null }; }
      })
    );

    // Build a compact data snapshot for the prompt
    const lines = MARKET_INSTRUMENTS.map(inst => {
      const q    = quoteMap[inst.symbol] || {};
      const price = q.last != null ? parseFloat(q.last) : null;
      const h    = historyData.find(d => d.sym === inst.symbol);
      const pct30 = h?.open30 && price ? ((price - h.open30) / h.open30 * 100).toFixed(1) : "?";
      const pivot = h?.pivot ? `P=${h.pivot.p.toFixed(0)} S1=${h.pivot.s1.toFixed(0)} R1=${h.pivot.r1.toFixed(0)}` : "";
      const priceStr = price != null ? (inst.isIndex ? price.toFixed(0) : `$${price.toFixed(2)}`) : "N/A";
      const rangeStr = h?.hi30 ? `30d range $${h.lo30?.toFixed(0)}–$${h.hi30?.toFixed(0)}` : "";
      return `${inst.symbol} (${inst.name}): ${priceStr} | ${pct30}% vs 30d ago | ${rangeStr} | ${pivot}`;
    });

    const now = new Date().toUTCString();
    const prompt = `You are a sharp, concise macro/markets analyst. Today is ${now}.

Here is live market data:
${lines.join('\n')}

Write a tight, actionable market insights brief (aim for ~300 words). Structure it as:
1. **Overall Tone** — one sentence: risk-on, risk-off, or mixed? Why?
2. **Key Setups** — 3–5 bullet points, each covering a specific instrument or theme. Call out pivot levels, breakout/breakdown risks, relative strength/weakness, and what to watch.
3. **Watch List** — 2–3 specific price levels or catalysts that will define the next move.

Be direct. No filler. Use the actual numbers from the data. Format in markdown.`;

    const anthropic = new (await import("@anthropic-ai/sdk")).default();
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 600,
      messages: [{ role: "user", content: prompt }],
    });

    const text = (msg.content[0] as any).text as string;
    insightsCache = { text, ts: Date.now() };
    res.json({ text, cached: false, generatedAt: new Date().toISOString() });
  } catch (err) {
    console.error("[Insights]", err);
    res.status(500).json({ error: String(err) });
  }
});

// ─── Ticker Lookup — arbitrary symbol on demand ───────────────────────────────

app.get("/api/markets/lookup", async (req, res) => {
  const raw  = ((req.query.symbol as string) || "").trim().toUpperCase();
  const type = ((req.query.type  as string) || "EQUITY").toUpperCase();
  if (!raw) return res.status(400).json({ error: "symbol required" });

  try {
    const token     = await getPublicToken();
    const accountId = process.env.PUBLIC_ACCOUNT_ID!;

    // Try the supplied type first; if that gets no quote, try the other two
    const tryTypes = type === "CRYPTO"
      ? ["CRYPTO", "EQUITY", "INDEX"]
      : type === "INDEX"
        ? ["INDEX", "EQUITY", "CRYPTO"]
        : ["EQUITY", "CRYPTO", "INDEX"];

    let quoteData: any = null;
    let resolvedType = type;

    for (const t of tryTypes) {
      const qRes = await fetch(
        `https://api.public.com/userapigateway/marketdata/${accountId}/quotes`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ instruments: [{ symbol: raw, type: t }] }),
        }
      );
      if (!qRes.ok) continue;
      const qData = await qRes.json() as any;
      const q = (qData.quotes || [])[0];
      if (q && (q.last != null || q.bid != null || q.ask != null)) {
        quoteData = q;
        resolvedType = t;
        break;
      }
    }

    if (!quoteData) return res.status(404).json({ error: `No quote found for ${raw}` });

    const price  = quoteData.last  != null ? parseFloat(quoteData.last)  : null;
    const bid    = quoteData.bid   != null ? parseFloat(quoteData.bid)   : null;
    const ask    = quoteData.ask   != null ? parseFloat(quoteData.ask)   : null;
    const spread = bid != null && ask != null ? ask - bid : null;

    const tile = {
      symbol:        raw,
      name:          quoteData.instrument?.description || raw,
      type:          resolvedType,
      isCrypto:      resolvedType === "CRYPTO",
      isIndex:       resolvedType === "INDEX",
      price,
      change:        null,
      changePercent: null,
      bid,
      ask,
      spread,
      volume:        quoteData.volume != null ? Number(quoteData.volume) : null,
      lastTimestamp: quoteData.lastTimestamp ?? null,
    };

    // Fetch 30-day candle history from Yahoo Finance
    const yahooSym = resolvedType === "CRYPTO" ? `${raw}-USD` : raw;
    let candles: any[] = [];
    let pivotLevels: any = null;
    try {
      const yRes = await fetch(
        `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?interval=1d&range=1mo`,
        { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" } }
      );
      if (yRes.ok) {
        const yData = await yRes.json() as any;
        const result = yData.chart?.result?.[0];
        if (result) {
          const timestamps: number[] = result.timestamp || [];
          const q2 = result.indicators?.quote?.[0] || {};
          candles = timestamps.map((t: number, i: number) => ({
            t: t * 1000, o: q2.open?.[i], h: q2.high?.[i], l: q2.low?.[i], c: q2.close?.[i],
          })).filter((c: any) => c.o != null && c.h != null && c.l != null && c.c != null);
          const last = candles[candles.length - 1] as any;
          if (last) {
            const p = (last.h + last.l + last.c) / 3;
            pivotLevels = {
              p, r1: 2*p - last.l, r2: p + (last.h - last.l), r3: last.h + 2*(p - last.l),
              s1: 2*p - last.h, s2: p - (last.h - last.l), s3: last.l - 2*(last.h - p),
            };
          }
        }
      }
    } catch { /* history is optional */ }

    res.json({ tile, candles, pivotLevels });
  } catch (err) {
    console.error("[Lookup]", err);
    res.status(500).json({ error: String(err) });
  }
});

// ─── Vite / Static ─────────────────────────────────────────────────────────────

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve("dist")));
    app.get("*", (req, res) => res.sendFile(path.resolve("dist/index.html")));
  }
  app.listen(PORT, "0.0.0.0", () => console.log(`Server running on http://localhost:${PORT}`));
}

startServer();
