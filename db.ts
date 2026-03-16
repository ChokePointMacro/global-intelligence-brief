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
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS pending_auth (
    state TEXT PRIMARY KEY,
    code_verifier TEXT,
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
`);

export default db;
