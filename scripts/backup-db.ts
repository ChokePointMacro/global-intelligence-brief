/**
 * Manual database backup: `npm run backup`
 *
 * The server also does this nightly on a timer, but that only helps while the app is
 * running — which, on a laptop that sleeps, is not a safe assumption. Run this before
 * anything risky (a migration, an upgrade, a schema change), or wire it into a system
 * scheduler if you want snapshots independent of the app being up.
 *
 * Exits non-zero on failure so a cron or launchd wrapper can detect it.
 */
import db from '../db.ts';
import { backupDatabase } from '../src/services/backup.ts';

try {
  const { target, bytes, pruned } = backupDatabase(db);
  const mb = (bytes / 1024 / 1024).toFixed(2);
  console.log(`✓ Backup written: ${target} (${mb} MB)`);
  if (pruned) console.log(`  pruned ${pruned} snapshot(s) beyond the retention window`);
  process.exit(0);
} catch (err) {
  console.error('✗ Backup FAILED:', err instanceof Error ? err.message : err);
  console.error('  The database holds your X tokens, reports and spend ledger, and is');
  console.error('  not stored anywhere else. Do not ignore this.');
  process.exit(1);
}
