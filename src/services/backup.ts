/**
 * SQLite snapshot backups.
 *
 * database.sqlite holds the X OAuth access and refresh tokens, every generated report,
 * the schedules and the spend ledger. .gitignore excludes *.sqlite, so it lives in
 * exactly one place on one disk — a dead laptop loses all of it.
 *
 * VACUUM INTO rather than a file copy: it takes a transactionally consistent snapshot of
 * a live database, so this is safe to run while the app is serving requests. A plain
 * `cp` of an open SQLite file can capture a torn write and produce a backup that only
 * looks fine until you need it.
 */
import fs from 'fs';
import path from 'path';
import type Database from 'better-sqlite3';
import { etDateString } from './time.ts';

export interface BackupOptions {
  /** Destination directory. Point this at Drive or an external disk for off-machine safety. */
  dir?: string;
  /** How many daily snapshots to retain. Older ones are pruned. */
  keep?: number;
}

export interface BackupResult {
  target: string;
  bytes: number;
  pruned: number;
}

const FILE_PATTERN = /^database-\d{8}\.sqlite$/;

/**
 * Write a dated snapshot and prune old ones. Throws on failure so the caller decides
 * whether that is fatal (a script) or merely worth notifying about (the server timer).
 */
export function backupDatabase(db: Database.Database, opts: BackupOptions = {}): BackupResult {
  const dir = opts.dir || process.env.BACKUP_DIR || path.resolve('backups');
  const keep = Math.max(1, opts.keep ?? Number(process.env.BACKUP_KEEP ?? 14));

  fs.mkdirSync(dir, { recursive: true });

  // Stamped with the Eastern date so a day's snapshot lines up with that day's content.
  const stamp = etDateString().replace(/-/g, '');
  const target = path.join(dir, `database-${stamp}.sqlite`);

  // VACUUM INTO refuses to write to an existing path, so a same-day re-run (a restart,
  // or a manual `npm run backup`) needs the previous snapshot cleared first.
  if (fs.existsSync(target)) fs.unlinkSync(target);

  db.prepare('VACUUM INTO ?').run(target);
  const bytes = fs.statSync(target).size;

  // Rolling retention. Filenames sort chronologically because the stamp is YYYYMMDD.
  const stale = fs.readdirSync(dir)
    .filter(f => FILE_PATTERN.test(f))
    .sort()
    .slice(0, -keep);

  let pruned = 0;
  for (const f of stale) {
    try { fs.unlinkSync(path.join(dir, f)); pruned++; } catch { /* best effort */ }
  }

  return { target, bytes, pruned };
}
