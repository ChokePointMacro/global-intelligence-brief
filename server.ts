import express from "express";
import { createServer as createViteServer } from "vite";
import session from "express-session";
import cookieParser from "cookie-parser";
import SQLiteStoreFactory from "connect-sqlite3";
import { TwitterApi } from "twitter-api-v2";
import db from "./db.ts";
import dotenv from "dotenv";
import path from "path";
import { generateWeeklyReport, generateInstagramCaption, type WeeklyReport } from "./src/services/geminiService.ts";

import fs from "fs";

dotenv.config();

const app = express();
const PORT = 3000;

// Normalize APP_URL
if (process.env.APP_URL && process.env.APP_URL.endsWith('/')) {
  process.env.APP_URL = process.env.APP_URL.slice(0, -1);
}

if (!fs.existsSync("./sessions")) {
  fs.mkdirSync("./sessions");
}

const SQLiteStore = (SQLiteStoreFactory as any)(session);

app.set('trust proxy', 1);

app.use(express.json());

// Session ID header bypass for iframe cookie issues
app.use((req, res, next) => {
  const headerSid = req.headers['x-session-id'];
  if (headerSid && typeof headerSid === 'string') {
    // We can't easily change the session ID after it's been parsed by express-session
    // but we can try to set it in the cookie header so express-session finds it
    if (!req.headers.cookie || !req.headers.cookie.includes('gib.sid')) {
      req.headers.cookie = `gib.sid=${headerSid}; ${req.headers.cookie || ''}`;
    }
  }
  next();
});

app.get("/api/health", (req, res) => {
  console.log("Health check requested");
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
      secure: true,
      sameSite: "none",
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  })
);

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} - Session: ${req.sessionID}`);
  next();
});

const xClient = new TwitterApi({
  clientId: process.env.X_CLIENT_ID || "",
  clientSecret: process.env.X_CLIENT_SECRET || "",
});

const hasValidXCredentials = process.env.X_CLIENT_ID && 
  process.env.X_CLIENT_SECRET && 
  !process.env.X_CLIENT_ID.includes("dummy") &&
  !process.env.X_CLIENT_SECRET.includes("dummy");

if (!hasValidXCredentials) {
  console.error("❌ CRITICAL: X_CLIENT_ID or X_CLIENT_SECRET is missing or using dummy values in .env");
  console.error("   To enable X posting, add your OAuth credentials to the .env file:");
  console.error("   X_CLIENT_ID=your_client_id");
  console.error("   X_CLIENT_SECRET=your_client_secret");
  console.error("   Get these from: https://developer.x.com/en/portal/dashboard");
}

// Auth Routes
const getRedirectUri = (req: express.Request) => {
  if (process.env.APP_URL) {
    return `${process.env.APP_URL}/auth/x/callback`;
  }
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers.host;
  const baseUrl = `${protocol}://${host}`;
  return `${baseUrl}/auth/x/callback`;
};

app.get("/api/auth/x/url", (req, res) => {
  // Validate X credentials before attempting auth
  if (!hasValidXCredentials) {
    return res.status(500).json({ 
      error: "X OAuth credentials not configured",
      details: "Server admin needs to set valid X_CLIENT_ID and X_CLIENT_SECRET in .env file"
    });
  }
  
  console.log("Generating auth URL. Host:", req.headers.host);
  
  try {
    const redirectUri = getRedirectUri(req);
    console.log("Generating auth URL with redirectUri:", redirectUri);
    const { url, codeVerifier, state } = xClient.generateOAuth2AuthLink(
      redirectUri,
      { scope: ["tweet.read", "tweet.write", "users.read", "offline.access"] }
    );
    (req.session as any).codeVerifier = codeVerifier;
    (req.session as any).state = state;
    db.prepare("INSERT OR REPLACE INTO pending_auth (state, code_verifier) VALUES (?, ?)").run(state, codeVerifier);
    
    req.session.save((err) => {
      if (err) console.error("Session save error in /url:", err);
      console.log("Auth URL generated and session saved. Session ID:", req.sessionID);
      res.json({ url });
    });
  } catch (error) {
    console.error("Failed to generate auth link:", error);
    res.status(500).json({ 
      error: "Failed to generate auth link",
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

app.get("/auth/x/callback", async (req, res) => {
  console.log("X callback received. Host:", req.headers.host);
  const { state, code } = req.query;
  let codeVerifier: string | undefined;
  
  if (state) {
    const pending = db.prepare("SELECT code_verifier FROM pending_auth WHERE state = ?").get(state) as any;
    if (pending) {
      codeVerifier = pending.code_verifier;
      console.log("Found codeVerifier in DB for state:", state);
      db.prepare("DELETE FROM pending_auth WHERE state = ?").run(state);
    }
  }

  if (!codeVerifier) {
    codeVerifier = (req.session as any).codeVerifier;
    console.log("Checking session for codeVerifier:", codeVerifier ? "Found" : "Not found");
  }

  if (!codeVerifier || !code) {
    console.error("Missing codeVerifier or code. codeVerifier:", codeVerifier, "code:", code);
    return res.status(400).send("Invalid session - please try connecting again.");
  }

  try {
    const redirectUri = getRedirectUri(req);
    console.log("Exchanging code for tokens with redirectUri:", redirectUri);
    const { client: loggedClient, accessToken, refreshToken, expiresIn } = await xClient.loginWithOAuth2({
      code: code as string,
      codeVerifier,
      redirectUri,
    });
    console.log("Token exchange successful. Access token received.");

    console.log("Fetching user data from X...");
    const { data: userObject } = await loggedClient.v2.me({
      "user.fields": ["profile_image_url", "username", "name"],
    });
    console.log("User data fetched successfully:", userObject.username, "(ID:", userObject.id, ")");

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
    console.log("Session userId set:", userObject.id, "Session ID:", req.sessionID);

    req.session.save((err) => {
      if (err) console.error("Session save error:", err);
      console.log("Session saved. Sending success response. SID:", req.sessionID);
      res.send(`
        <html>
          <body>
            <script>
              console.log("Auth success. Sending message to opener...");
              if (window.opener) {
                window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', sessionId: '${req.sessionID}' }, '*');
                window.close();
              } else {
                window.location.href = '/';
              }
            </script>
          </body>
        </html>
      `);
    });
  } catch (error) {
    console.error("Auth failed during token exchange/user fetch:", error);
    res.status(500).send("Auth failed");
  }
});

app.get("/api/auth/me", (req, res) => {
  console.log("Session ID in /api/auth/me:", req.sessionID);
  const userId = (req.session as any).userId;
  console.log("UserId in session:", userId);
  if (!userId) return res.status(401).json({ error: "Not authenticated", sessionId: req.sessionID });
  const user = db.prepare("SELECT * FROM users WHERE x_id = ?").get(userId) as any;
  if (!user) return res.status(401).json({ error: "User not found", sessionId: req.sessionID });
  res.json({ id: user.x_id, username: user.username, displayName: user.display_name, profileImage: user.profile_image, sessionId: req.sessionID });
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// List available Gemini models (for debugging)
app.get("/api/debug/models", async (req, res) => {
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

// Report Generation Endpoint
app.post("/api/generate-report", async (req, res) => {
  try {
    const { type } = req.body;
    
    if (!type || !['global', 'crypto', 'equities', 'conspiracies'].includes(type)) {
      return res.status(400).json({ error: "Invalid report type" });
    }
    
    console.log(`[API] Generating ${type} report...`);
    const report = await generateWeeklyReport(type);
    
    if (!report || !report.headlines || report.headlines.length === 0) {
      return res.status(500).json({ error: "Failed to generate report: no headlines returned" });
    }
    
    console.log(`[API] Successfully generated ${type} report with ${report.headlines.length} headlines`);
    res.json(report);
  } catch (error) {
    console.error("[API] Report generation error:", error);
    const message = error instanceof Error ? error.message : String(error);
    
    // Parse error message for specific issues
    let errorType = "UNKNOWN";
    let userMessage = message;
    let statusCode = 500;
    
    // Check for rate limit errors
    if (
      message.includes("rate limit") ||
      message.includes("Rate limit") ||
      message.includes("429") ||
      message.includes("quota") ||
      message.includes("Quota exceeded")
    ) {
      errorType = "RATE_LIMIT";
      statusCode = 429;
      userMessage = "Rate limit reached. Please upgrade your API plan or wait before retrying.";
    }
    // Check for authentication/API key errors
    else if (
      message.includes("invalid_api_key") ||
      message.includes("API key") ||
      message.includes("unauthorized") ||
      message.includes("Unauthorized") ||
      message.includes("UNAUTHENTICATED") ||
      message.includes("authentication")
    ) {
      errorType = "AUTH_ERROR";
      statusCode = 401;
      userMessage = "API authentication failed. Please check your API keys are configured correctly.";
    }
    // Check for JSON parsing issues
    else if (
      message.includes("JSON") ||
      message.includes("parse") ||
      message.includes("Invalid")
    ) {
      errorType = "PARSING_ERROR";
      statusCode = 500;
      userMessage = "The AI provider returned invalid data format. This is usually temporary - please retry.";
    }
    // Check if all providers failed
    else if (message.includes("All AI providers failed")) {
      errorType = "ALL_PROVIDERS_FAILED";
      statusCode = 503;
      userMessage = "All AI providers are currently unavailable. Please try again in a moment.";
    }
    
    res.status(statusCode).json({ 
      error: userMessage,
      type: errorType,
      details: message.substring(0, 200) // Include technical details for debugging
    });
  }
});

// Instagram Caption Endpoint
app.post("/api/instagram-caption", async (req, res) => {
  try {
    const { reportId } = req.body;
    
    // Get report from database or memory
    const reports = db.prepare("SELECT * FROM reports WHERE id = ?").get(reportId) as any;
    if (!reports) {
      return res.status(404).json({ error: "Report not found" });
    }
    
    const report = JSON.parse(reports.content);
    console.log(`[API] Generating Instagram caption for ${reportId}...`);
    const caption = await generateInstagramCaption(report);
    
    console.log(`[API] Successfully generated Instagram caption`);
    res.json({ caption });
  } catch (error) {
    console.error("[API] Instagram caption error:", error);
    const message = error instanceof Error ? error.message : String(error);
    
    // Check for rate limit errors and return appropriate status code
    if (
      message.includes("rate limit") ||
      message.includes("Rate limit") ||
      message.includes("429") ||
      message.includes("quota") ||
      message.includes("Quota")
    ) {
      return res.status(429).json({ 
        error: `Rate limit error: ${message}`,
        type: "RATE_LIMIT"
      });
    }
    
    res.status(500).json({ error: `Failed to generate caption: ${message}` });
  }
});

// Report Routes
app.get("/api/reports", (req, res) => {
  const reports = db.prepare("SELECT * FROM reports ORDER BY updated_at DESC").all() as any[];
  res.json(reports.map(r => ({ ...r, content: JSON.parse(r.content) })));
});

app.post("/api/reports", (req, res) => {
  const { id, type, content } = req.body;
  db.prepare(`
    INSERT INTO reports (id, type, content, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET content = excluded.content, updated_at = CURRENT_TIMESTAMP
  `).run(id, type, JSON.stringify(content));
  res.json({ success: true });
});

app.delete("/api/reports", (req, res) => {
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

app.delete("/api/reports/:id", (req, res) => {
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

// Helper to refresh X access token
async function refreshXToken(user: any) {
  if (user.expires_at > Date.now() + 60000) return user.access_token;
  const client = new TwitterApi({ clientId: process.env.X_CLIENT_ID!, clientSecret: process.env.X_CLIENT_SECRET! });
  const { accessToken, refreshToken, expiresIn } = await client.refreshOAuth2Token(user.refresh_token);
  const expiresAt = Date.now() + expiresIn * 1000;
  db.prepare(`UPDATE users SET access_token = ?, refresh_token = ?, expires_at = ? WHERE x_id = ?`).run(accessToken, refreshToken || user.refresh_token, expiresAt, user.x_id);
  return accessToken;
}

// Background task
setInterval(async () => {
  try {
    const pending = db.prepare("SELECT * FROM scheduled_posts WHERE status = 'pending' AND scheduled_at <= ?").all(new Date().toISOString()) as any[];
    for (const post of pending) {
      const user = db.prepare("SELECT * FROM users WHERE x_id = ?").get(post.user_id) as any;
      if (!user) continue;
      try {
        const accessToken = await refreshXToken(user);
        const client = new TwitterApi(accessToken);
        await client.v2.tweet(post.content);
        db.prepare("UPDATE scheduled_posts SET status = 'posted' WHERE id = ?").run(post.id);
      } catch (error) {
        console.error(`Background task failed for post ${post.id}:`, error);
        db.prepare("UPDATE scheduled_posts SET status = 'failed' WHERE id = ?").run(post.id);
      }
    }
  } catch (err) {
    console.error("Background task interval error:", err);
  }
}, 60000);

app.post("/api/post-to-x", async (req, res) => {
  // Validate X credentials
  if (!hasValidXCredentials) {
    console.error("[post-to-x] X credentials not configured");
    return res.status(503).json({ 
      error: "X posting not enabled on this server",
      details: "Server admin needs to configure X OAuth credentials"
    });
  }
  
  const userId = (req.session as any).userId;
  const { text } = req.body;
  
  if (!userId) {
    console.error("[post-to-x] No userId in session");
    return res.status(401).json({ error: "Not authenticated - please connect your X account" });
  }
  
  const user = db.prepare("SELECT * FROM users WHERE x_id = ?").get(userId) as any;
  if (!user) {
    console.error("[post-to-x] User not found for ID:", userId);
    return res.status(401).json({ error: "User data not found - please reconnect X account" });
  }
  
  if (!text || text.trim().length === 0) {
    return res.status(400).json({ error: "Cannot post empty content" });
  }
  
  if (text.length > 280) {
    return res.status(400).json({ error: `Post too long: ${text.length}/280 characters` });
  }
  
  try {
    console.log("[post-to-x] Refreshing token for user:", user.username);
    const accessToken = await refreshXToken(user);
    
    if (!accessToken) {
      console.error("[post-to-x] Failed to get access token");
      return res.status(401).json({ error: "Failed to authenticate - token is invalid" });
    }
    
    console.log("[post-to-x] Creating TwitterApi client with token...");
    const client = new TwitterApi(accessToken);
    
    console.log("[post-to-x] Posting tweet:", text.substring(0, 50) + "...");
    const result = await client.v2.tweet(text);
    
    console.log("[post-to-x] ✓ Tweet posted successfully:", result.data.id);
    res.json({ success: true, tweetId: result.data.id });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("[post-to-x] Error posting to X:", errorMsg, error);
    
    // Provide specific error messages
    if (errorMsg.includes("401") || errorMsg.includes("Unauthorized")) {
      return res.status(401).json({ 
        error: "Authentication failed - your X session may have expired. Please reconnect.",
        details: errorMsg 
      });
    } else if (errorMsg.includes("429") || errorMsg.includes("rate")) {
      return res.status(429).json({ 
        error: "Rate limited - you're posting too frequently. Please wait a moment.",
        details: errorMsg 
      });
    } else if (errorMsg.includes("140")) {
      return res.status(400).json({ 
        error: "Tweet is too long or contains invalid characters.",
        details: errorMsg 
      });
    }
    
    res.status(500).json({ 
      error: "Failed to post to X - please try again or check your connection",
      details: errorMsg.substring(0, 200)
    });
  }
});

app.post("/api/schedule-post", (req, res) => {
  const userId = (req.session as any).userId;
  const { content, scheduledAt } = req.body;
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

app.get("/api/debug/session", (req, res) => {
  res.json({
    sessionId: req.sessionID,
    session: req.session,
    cookies: req.cookies,
    headers: req.headers
  });
});

// Vite middleware
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
