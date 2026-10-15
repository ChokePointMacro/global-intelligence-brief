/**
 * Structured logging + process-level error capture.
 *
 * The scheduler runs unattended at 06:00. Before this, a failure printed to a terminal
 * nobody was watching, so the only symptom was "no tweets appeared" — the worst possible
 * detection mechanism. Every event now lands as a JSON line in logs/app.jsonl, queryable
 * after the fact, with failures also surfaced on stderr.
 *
 * Deliberately dependency-free: adding Sentry means a DSN, an account and egress from a
 * machine that is otherwise entirely local. A JSONL file is enough to answer "what broke
 * at 6am" and can be shipped somewhere later if that changes.
 */
import fs from 'fs';
import path from 'path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_DIR = path.resolve('logs');
const LOG_FILE = path.join(LOG_DIR, 'app.jsonl');
const MAX_BYTES = 5 * 1024 * 1024; // rotate at 5MB so this never eats the disk

let ready = false;
function ensureDir() {
  if (ready) return;
  try { fs.mkdirSync(LOG_DIR, { recursive: true }); ready = true; } catch { /* fall back to stderr only */ }
}

function rotateIfNeeded() {
  try {
    const st = fs.statSync(LOG_FILE);
    if (st.size > MAX_BYTES) fs.renameSync(LOG_FILE, `${LOG_FILE}.1`);
  } catch { /* no file yet */ }
}

/** Never let logging throw — a broken logger must not take down the cron. */
export function logEvent(level: LogLevel, event: string, data: Record<string, unknown> = {}): void {
  const entry = { ts: new Date().toISOString(), level, event, ...data };
  try {
    ensureDir();
    rotateIfNeeded();
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
  } catch { /* disk issues must not be fatal */ }

  if (level === 'error' || level === 'warn') {
    console.error(`[${level}] ${event}`, Object.keys(data).length ? JSON.stringify(data) : '');
  } else if (process.env.NODE_ENV !== 'production') {
    console.log(`[${level}] ${event}`);
  }
}

export const log = {
  debug: (e: string, d?: Record<string, unknown>) => logEvent('debug', e, d),
  info: (e: string, d?: Record<string, unknown>) => logEvent('info', e, d),
  warn: (e: string, d?: Record<string, unknown>) => logEvent('warn', e, d),
  error: (e: string, d?: Record<string, unknown>) => logEvent('error', e, d),
};

/** Normalise anything thrown into something serialisable. */
export function errInfo(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return { message: err.message, name: err.name, stack: err.stack?.split('\n').slice(0, 4).join(' | ') };
  }
  return { message: String(err) };
}

/** Catch what would otherwise vanish or kill the process silently. */
export function installProcessHandlers(): void {
  process.on('unhandledRejection', (reason) => log.error('unhandled_rejection', errInfo(reason)));
  process.on('uncaughtException', (err) => {
    log.error('uncaught_exception', errInfo(err));
    // Do not exit: a single bad request must not take the scheduler offline.
  });
}
