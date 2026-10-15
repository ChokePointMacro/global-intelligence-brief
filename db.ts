import Database from 'better-sqlite3';
import path from 'path';
import { normaliseScheduledAt } from './src/services/time.ts';
import { SEED_POST_TYPES } from './src/services/postTypes.ts';

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

// ─── Post Queue (Phase A) ──────────────────────────────────────────────────────
//
// post_types holds the recurring segments as DATA, editable on screen — slot time,
// days, length and tag rules, prompt template. The generator reads these; none of it
// is a hardcoded branch.
//
// posts supersedes scheduled_posts. The important change is the status vocabulary:
// the publisher now sends only status='approved' AND time_confirmed=1. Everything
// arrives as 'draft', which is not sendable, so a generated post cannot reach X
// without an explicit human approval.
db.exec(`
  CREATE TABLE IF NOT EXISTS post_types (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    code            TEXT NOT NULL UNIQUE,
    color           TEXT DEFAULT '#f7931a',
    default_time_et TEXT,                      -- "HH:MM" Eastern, or NULL for no fixed slot
    days_of_week    TEXT DEFAULT '',           -- "1,2,3,4,5"; 0=Sun. Empty = never auto-schedules
    max_per_day     INTEGER,                   -- NULL = unlimited
    prompt_template TEXT DEFAULT '',
    card_type       TEXT DEFAULT 'none',
    cashtag_min     INTEGER DEFAULT 0,
    cashtag_max     INTEGER DEFAULT 0,
    hashtag_max     INTEGER DEFAULT 1,
    length_mode     TEXT DEFAULT 'short',      -- 'short' (280) | 'long' (Premium long-form)
    -- reuse an existing headline post | synthesise across stories | manual
    generation_mode TEXT DEFAULT 'reuse',
    source_required INTEGER DEFAULT 1,
    staleness_hours INTEGER,                   -- NULL = never goes stale
    active          INTEGER DEFAULT 1,
    sort_order      INTEGER DEFAULT 0,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS posts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    type_id         INTEGER REFERENCES post_types(id),

    -- draft | needs_review | approved | posting | posted | failed | skipped | archived
    status          TEXT NOT NULL DEFAULT 'draft',
    body            TEXT,
    is_long         INTEGER DEFAULT 0,

    -- proposed_at is the type's default slot, suggested by the generator.
    -- scheduled_at is only authoritative once time_confirmed = 1.
    proposed_at     DATETIME,
    scheduled_at    DATETIME,
    time_confirmed  INTEGER DEFAULT 0,

    event_id        TEXT,
    priority        INTEGER DEFAULT 0,
    tags            TEXT,
    notes           TEXT,

    -- Threading: a reply carries its parent and an offset (e.g. +60 min).
    parent_post_id  INTEGER REFERENCES posts(id),
    offset_minutes  INTEGER,

    x_post_id       TEXT,
    posted_at       DATETIME,
    error           TEXT,
    locked          INTEGER DEFAULT 0,

    -- Retained from scheduled_posts and deliberately NOT dropped. The build plan's
    -- table omits all three, but user_id is how the publisher finds the X token, and
    -- attempts/claimed_at are the atomic claim that stops a crash mid-publish from
    -- double-posting. Removing them would silently undo the Phase 0 crash-safety.
    user_id         TEXT,
    attempts        INTEGER DEFAULT 0,
    claimed_at      DATETIME,

    -- Until post_sources is populated (Phase D), the publisher still reads this for
    -- the source-as-reply behaviour.
    source_url      TEXT,

    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- The publisher polls this every 60s.
  CREATE INDEX IF NOT EXISTS idx_posts_due ON posts(status, time_confirmed, scheduled_at);
  CREATE INDEX IF NOT EXISTS idx_posts_type ON posts(type_id, scheduled_at);

  -- Scaffolding for later phases. Created now so the schema is settled and the UI can
  -- read them without special-casing a missing table; populated in Phase D.
  CREATE TABLE IF NOT EXISTS post_versions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    body       TEXT,
    media_id   INTEGER,
    changed_by TEXT,
    changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    reason     TEXT
  );

  CREATE TABLE IF NOT EXISTS post_media (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id          INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    card_type        TEXT,
    card_fields_json TEXT,
    file_path        TEXT,
    alt_text         TEXT
  );

  CREATE TABLE IF NOT EXISTS post_sources (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id   INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    name      TEXT,
    url       TEXT,
    pulled_at DATETIME,
    confirmed INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS post_metrics (
    post_id        INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    checkpoint     TEXT NOT NULL,              -- '1h' | '24h' | '7d'
    impressions    INTEGER,
    replies        INTEGER,
    reposts        INTEGER,
    likes          INTEGER,
    bookmarks      INTEGER,
    profile_visits INTEGER,
    follows        INTEGER,
    sampled_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (post_id, checkpoint)
  );
`);

// Seed the nine shipped post types. Idempotent per code, so a type Mike later deletes
// stays deleted rather than reappearing on the next boot — only genuinely missing codes
// are inserted, and an existing row is never overwritten (his edits win).
try {
  const exists = db.prepare("SELECT COUNT(*) c FROM post_types WHERE code = ?");
  const insert = db.prepare(`
    INSERT INTO post_types (name, code, color, default_time_et, days_of_week, max_per_day,
                            prompt_template, card_type, cashtag_min, cashtag_max, hashtag_max,
                            length_mode, generation_mode, source_required, staleness_hours, active, sort_order)
    VALUES (@name, @code, @color, @default_time_et, @days_of_week, @max_per_day,
            @prompt_template, @card_type, @cashtag_min, @cashtag_max, @hashtag_max,
            @length_mode, @generation_mode, @source_required, @staleness_hours, @active, @sort_order)
  `);

  // Only seed into a table that has never been populated. Once there is any row, the
  // table is Mike's to manage.
  const anyRows = db.prepare("SELECT COUNT(*) c FROM post_types").get() as any;
  if (anyRows.c === 0) {
    const seedAll = db.transaction((types: typeof SEED_POST_TYPES) => {
      for (const t of types) {
        if ((exists.get(t.code) as any).c === 0) insert.run(t as any);
      }
    });
    seedAll(SEED_POST_TYPES);
    console.log(`Seeded ${SEED_POST_TYPES.length} post types (cashtags off by default)`);
  }
} catch (err) {
  console.error("post_types seed error:", err);
}

// Migration: move scheduled_posts into posts.
//
// Runs once, guarded by the posts table being empty. Everything lands as 'draft' with
// time_confirmed = 0 — i.e. NOT sendable — regardless of its old status. That is
// deliberate: a row that the old publisher would have sent autonomously must not become
// instantly live under the new approval model just because the schema changed.
try {
  const already = db.prepare("SELECT COUNT(*) c FROM posts").get() as any;
  const legacyExists = db.prepare(
    "SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name='scheduled_posts'"
  ).get() as any;

  if (already.c === 0 && legacyExists.c > 0) {
    const legacy = db.prepare("SELECT * FROM scheduled_posts ORDER BY id").all() as any[];
    if (legacy.length) {
      const manualType = db.prepare("SELECT id FROM post_types WHERE code = 'MAN'").get() as any;
      const insert = db.prepare(`
        INSERT INTO posts (type_id, status, body, proposed_at, scheduled_at, time_confirmed,
                           x_post_id, posted_at, error, user_id, attempts, claimed_at,
                           source_url, created_at)
        VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      let moved = 0;
      for (const row of legacy) {
        // Terminal states keep their meaning; anything live becomes a draft.
        // The Instagram/Substack reminders were never tweetable, so they archive.
        const status =
          row.kind && row.kind !== 'tweet' ? 'archived'
          : row.status === 'posted' ? 'posted'
          : row.status === 'failed' ? 'failed'
          : row.status === 'skipped' ? 'skipped'
          : 'draft';

        insert.run(
          manualType?.id ?? null, status, row.content, row.scheduled_at, row.scheduled_at,
          row.posted_tweet_id ?? null, row.status === 'posted' ? row.scheduled_at : null,
          row.last_error ?? null, row.user_id ?? null, row.attempts ?? 0, null,
          row.source_url ?? null, row.created_at ?? null,
        );
        moved++;
      }
      console.log(`Migrated scheduled_posts -> posts: ${moved} row(s), all live rows reset to 'draft' (not sendable)`);
    }
  }
} catch (err) {
  console.error("posts migration error:", err);
}

// Migration: generation_mode on post_types.
//
// Path selection used to be inferred from length_mode, which was wrong — the Morning
// Brief is SHORT and a SYNTHESIS, so it grabbed a raw headline and ignored its prompt
// template entirely. How a slot gets its text is its own property.
try {
  const cols = db.prepare("PRAGMA table_info(post_types)").all() as any[];
  if (!cols.some(c => c.name === 'generation_mode')) {
    db.exec("ALTER TABLE post_types ADD COLUMN generation_mode TEXT DEFAULT 'reuse'");
    const set = db.prepare("UPDATE post_types SET generation_mode = ? WHERE code = ?");
    for (const t of SEED_POST_TYPES) set.run(t.generation_mode, t.code);
    console.log("Migrated post_types: added generation_mode and backfilled from the seed");
  }
} catch (err) {
  console.error("post_types generation_mode migration error:", err);
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
