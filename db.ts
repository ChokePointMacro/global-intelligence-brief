import Database from 'better-sqlite3';
import path from 'path';
import { normaliseScheduledAt } from './src/services/time.ts';

// Overridable so a throwaway instance can be pointed at a COPY of the database —
// migrations and the publisher can then be exercised without risking the real one,
// which holds the live X tokens.
const db = new Database(path.resolve(process.env.DB_PATH || 'database.sqlite'));

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    x_id TEXT UNIQUE,
    username TEXT,
    display_name TEXT,
    profile_image TEXT,
    access_token TEXT,
    refresh_token TEXT,
    expires_at INTEGER
  );
`);

// Migration: Rename twitter_id to x_id if it exists
try {
  const columns = db.prepare("PRAGMA table_info(users)").all() as any[];
  const hasTwitterId = columns.some(c => c.name === 'twitter_id');
  const hasXId = columns.some(c => c.name === 'x_id');
  if (hasTwitterId && !hasXId) {
    db.exec("ALTER TABLE users RENAME COLUMN twitter_id TO x_id");
    console.log("Migrated users table: renamed twitter_id to x_id");
  }
} catch (err) {
  console.error("Migration error:", err);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    type TEXT,
    content TEXT,
    custom_topic TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS pending_auth (
    state TEXT PRIMARY KEY,
    code_verifier TEXT,
    platform TEXT DEFAULT 'x',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS scheduled_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    content TEXT,
    scheduled_at DATETIME,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS scheduled_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_type TEXT NOT NULL,
    custom_topic TEXT,
    schedule_time TEXT NOT NULL,
    days TEXT DEFAULT '1,2,3,4,5',
    enabled INTEGER DEFAULT 1,
    last_run DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS platform_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    handle TEXT,
    person_urn TEXT,
    expires_at INTEGER,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, platform)
  );

  CREATE TABLE IF NOT EXISTS platform_credentials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT NOT NULL,
    key_name TEXT NOT NULL,
    key_value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(platform, key_name)
  );

  CREATE TABLE IF NOT EXISTS watchlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    symbol TEXT NOT NULL,
    name TEXT,
    type TEXT,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, symbol)
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Migration: add custom_topic and auto_generated columns to reports if missing
try {
  const cols = db.prepare("PRAGMA table_info(reports)").all() as any[];
  if (!cols.some(c => c.name === 'custom_topic')) {
    db.exec("ALTER TABLE reports ADD COLUMN custom_topic TEXT");
    console.log("Migrated reports table: added custom_topic column");
  }
  if (!cols.some(c => c.name === 'auto_generated')) {
    db.exec("ALTER TABLE reports ADD COLUMN auto_generated INTEGER DEFAULT 0");
    console.log("Migrated reports table: added auto_generated column");
  }
} catch (err) {
  console.error("Reports migration error:", err);
}

// Migration: add source_url to scheduled_posts.
// The source link is posted as a REPLY, never in the post body — X cuts reach ~30-50% on
// posts containing external links, so the body stays clean and the citation sits one level
// down where it costs nothing in distribution.
try {
  const cols = db.prepare("PRAGMA table_info(scheduled_posts)").all() as any[];
  if (!cols.some(c => c.name === 'source_url')) {
    db.exec("ALTER TABLE scheduled_posts ADD COLUMN source_url TEXT");
    console.log("Migrated scheduled_posts table: added source_url column");
  }
} catch (err) {
  console.error("scheduled_posts migration error:", err);
}

// Migration: publisher safety/idempotency columns.
// status flows pending -> posting -> posted|failed. The intermediate 'posting' claim is
// what stops a crash mid-flight from re-posting the same tweet on the next cron tick.
try {
  const cols = db.prepare("PRAGMA table_info(scheduled_posts)").all() as any[];
  const add = (name: string, ddl: string) => {
    if (!cols.some(c => c.name === name)) {
      db.exec(`ALTER TABLE scheduled_posts ADD COLUMN ${ddl}`);
      console.log(`Migrated scheduled_posts table: added ${name} column`);
    }
  };
  add('posted_tweet_id', 'posted_tweet_id TEXT');
  add('last_error', 'last_error TEXT');
  add('attempts', 'attempts INTEGER DEFAULT 0');
  add('claimed_at', 'claimed_at DATETIME');
} catch (err) {
  console.error("scheduled_posts safety migration error:", err);
}

// Migration: distinguish real tweets from the Instagram/Substack *reminders* that share
// this table.
//
// The reminders were previously identified only by a '[INSTAGRAM] '/'[SUBSTACK] ' prefix
// on the content, which the frontend stripped for display. The publisher's due-query had
// no such filter, so it would have tweeted "[INSTAGRAM] Post your 21-slide carousel..."
// verbatim to the live account. A prefix on a text column is a display convention; it is
// not a type. This makes the type explicit so the publisher can filter on it.
try {
  const cols = db.prepare("PRAGMA table_info(scheduled_posts)").all() as any[];
  if (!cols.some(c => c.name === 'kind')) {
    db.exec("ALTER TABLE scheduled_posts ADD COLUMN kind TEXT NOT NULL DEFAULT 'tweet'");
    // Backfill from the legacy prefixes so existing rows are classified correctly.
    const insta = db.prepare("UPDATE scheduled_posts SET kind='instagram' WHERE content LIKE '[INSTAGRAM]%'").run();
    const sub = db.prepare("UPDATE scheduled_posts SET kind='substack' WHERE content LIKE '[SUBSTACK]%'").run();
    console.log(`Migrated scheduled_posts table: added kind column (reclassified ${insta.changes} instagram, ${sub.changes} substack)`);
  }
} catch (err) {
  console.error("scheduled_posts kind migration error:", err);
}

// Migration: canonicalise scheduled_at to ISO-8601 UTC.
//
// SQLite compares DATETIME columns as TEXT. A value like '2026-10-01 23:59' (space
// separator, no zone) sorts BELOW '2026-10-01T00:00:00.000Z' because ' ' (0x20) < 'T'
// (0x54) — so the publisher's `scheduled_at <= now` test treated a post scheduled for
// late tonight as already due and published it ~18 hours early. Writes now go through
// normaliseScheduledAt(); this fixes any rows already stored in a mixed format.
try {
  const rows = db.prepare(
    "SELECT id, scheduled_at FROM scheduled_posts WHERE scheduled_at IS NOT NULL AND scheduled_at NOT LIKE '%Z'"
  ).all() as any[];
  if (rows.length) {
    const upd = db.prepare("UPDATE scheduled_posts SET scheduled_at = ? WHERE id = ?");
    let fixed = 0;
    let unparseable = 0;
    for (const r of rows) {
      const iso = normaliseScheduledAt(r.scheduled_at);
      if (iso) { upd.run(iso, r.id); fixed++; } else { unparseable++; }
    }
    console.log(`Migrated scheduled_posts table: normalised ${fixed} scheduled_at value(s) to ISO UTC`);
    if (unparseable) {
      // Never silently leave a row that will compare unpredictably against `now`.
      console.warn(`⚠️  ${unparseable} scheduled_at value(s) could not be parsed and were left as-is — inspect them before enabling posting`);
    }
  }
} catch (err) {
  console.error("scheduled_posts scheduled_at migration error:", err);
}

// The publisher polls `WHERE status=? AND kind=? AND scheduled_at <= ?` every 60s.
try {
  db.exec("CREATE INDEX IF NOT EXISTS idx_scheduled_posts_due ON scheduled_posts(status, kind, scheduled_at)");
} catch (err) {
  console.error("scheduled_posts index migration error:", err);
}

// Migration: add platform column to pending_auth if missing
try {
  const cols = db.prepare("PRAGMA table_info(pending_auth)").all() as any[];
  if (!cols.some(c => c.name === 'platform')) {
    db.exec("ALTER TABLE pending_auth ADD COLUMN platform TEXT DEFAULT 'x'");
  }
} catch (err) {
  console.error("pending_auth migration error:", err);
}

// Migration: add email + password_hash to users for email/password auth
try {
  const cols = db.prepare("PRAGMA table_info(users)").all() as any[];
  if (!cols.some(c => c.name === 'email')) {
    db.exec("ALTER TABLE users ADD COLUMN email TEXT");
    console.log("Migrated users table: added email column");
  }
  if (!cols.some(c => c.name === 'password_hash')) {
    db.exec("ALTER TABLE users ADD COLUMN password_hash TEXT");
    console.log("Migrated users table: added password_hash column");
  }
} catch (err) {
  console.error("Email auth migration error:", err);
}

export default db;
