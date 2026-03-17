import Database from 'better-sqlite3';
import path from 'path';

const db = new Database(path.resolve('database.sqlite'));

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
`);

// Migration: add custom_topic column to reports if missing
try {
  const cols = db.prepare("PRAGMA table_info(reports)").all() as any[];
  if (!cols.some(c => c.name === 'custom_topic')) {
    db.exec("ALTER TABLE reports ADD COLUMN custom_topic TEXT");
    console.log("Migrated reports table: added custom_topic column");
  }
} catch (err) {
  console.error("Reports migration error:", err);
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
