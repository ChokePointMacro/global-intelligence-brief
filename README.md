# ChokePoint Macro — Global Intelligence Brief

Single-user, local-only automation engine: generates macro intelligence reports from live
news/market data and publishes them to X on a schedule.

This is **not** a product and has no multi-user story. It runs on one machine, binds to
loopback only, and is operated by one person. `LOCAL_MODE` (default on) is deliberate —
don't "restore auth" as a cleanup.

---

## Run locally

**Prerequisites:** Node.js 20+

```bash
npm install
cp .env.example .env     # then fill in the keys
npm run dev              # http://localhost:3000
```

Port 3000 by default (`PORT` to override). Binds `127.0.0.1` **and** `::1` — macOS
resolves `localhost` to IPv6 first, so binding only one makes the other silently fail.

---

## Operations

### Keeping it running

The publisher is an in-memory `setInterval`. A foreground `npm run dev` dies with the
terminal, and scheduled posting stops with no signal — the queue just quietly stops
draining. Use pm2 for anything you actually depend on:

```bash
npm install -g pm2
npm run pm2:start        # start + save the process list
pm2 startup              # prints a sudo command; run it to install the boot agent
```

| Command | Does |
|---|---|
| `npm run pm2:status` | up/down, restart count |
| `npm run pm2:logs` | tail output |
| `npm run pm2:restart` | after a code change |
| `npm run pm2:stop` | stop everything (the kill switch is the softer option) |

### Sleep settings — the one unavoidable weakness

**If the machine is asleep at a slot time, that post does not go out.** pm2 restarts a
crashed process; it cannot wake a sleeping Mac.

Check the current state:

```bash
pmset -g custom | grep -E '^ *(sleep|displaysleep)'
```

`sleep` is in **minutes**; `0` means never. To keep the machine awake on AC power
(requires sudo — run it yourself):

```bash
sudo pmset -c sleep 0        # never system-sleep while plugged in
sudo pmset -c displaysleep 10 # screen off after 10 min is fine; that isn't system sleep
```

Leave battery settings alone. Rather than relying on this, the missed-slot guard below
assumes sleep *will* happen and fails safe.

### Posting kill switch

Fail-closed: anything other than the literal `POSTING_ENABLED=true` means posting is
**off**. An unset or misspelled variable produces silence, not a live account posting on
a timer.

```bash
curl localhost:3000/api/posting/status                     # current state + rails
curl -X PUT localhost:3000/api/posting/status \
  -H 'Content-Type: application/json' -d '{"enabled":true}'   # takes effect next tick (<60s)
```

The DB toggle (`app_settings.posting_enabled`) overrides the env var, so you never need a
restart to stop posting.

### Missed slots

A post more than `POST_MAX_LATE_MIN` (default **30**) past its slot is set to `skipped`,
not published. Without this the due-query is an open-ended backward window: sleep the
laptop over a weekend and the whole backlog publishes at `MAX_POSTS_PER_RUN`/minute on
wake, stalest market commentary first.

Reports get a longer catch-up window (`REPORT_MAX_LATE_MIN`, default 6h) — a brief is
less perishable than a market post, and regenerating uses live data anyway.

`skipped` is distinct from `failed`: skipped is the system working as designed.

### Time zones

**All slot times are Eastern (`America/New_York`) and DST-aware** — the content is keyed
to US market hours, and this machine is not on Eastern time. See
`src/services/time.ts`; don't reintroduce a fixed UTC offset, which is right for about
four months a year and an hour wrong for the other eight.

A zone-less datetime (`2026-10-01 23:59`) is interpreted as Eastern wall clock and stored
as ISO-8601 UTC. `scheduled_at` must only ever hold ISO UTC: SQLite compares DATETIME as
text, and `' '` (0x20) sorts below `'T'` (0x54), so a mixed-format column compares
non-chronologically.

### Backups

`database.sqlite` holds the X OAuth tokens, every report, the schedules and the spend
ledger, and `.gitignore` excludes `*.sqlite` — it exists in one place on one disk.

A dated snapshot is written on boot and every 24h via `VACUUM INTO` (safe on a live DB; a
plain `cp` of an open SQLite file can capture a torn write). `BACKUP_KEEP` daily
snapshots are retained.

```bash
npm run backup           # manual snapshot — run before migrations or upgrades
```

**Point `BACKUP_DIR` at Drive or an external disk.** The default (`backups/`) is on the
same disk as the thing it's backing up, which doesn't survive the failure that matters.

### Spend

The ledger measures (`/api/spend`); `AI_MONTHLY_CAP_USD` enforces. Month-to-date,
calendar month, X posting excluded. Email warning at 80%, calls refused at 100%
(HTTP 402). `0` disables. Enforcement covers both the provider fallback chain and the
direct SDK calls in `src/server/markets.ts`.

X API is pay-per-use: ~$0.015/post, **$0.20 if the post contains a link** — which is why
`POST_SOURCE_AS_REPLY` exists. A `402` from X means a zero credit balance, not a
permissions problem. Balance at console.x.com.

### Notifications

Skipped slots, failed posts, a tripped spend cap and backup failures all call
`notifyOps`, which emails `app_settings.digest_email` via SMTP.

> **If SMTP and `digest_email` are not configured, these only reach the log file.**
> Since the missed-slot design depends on being told, configure both — otherwise a
> dropped post is indistinguishable from a successful one.

---

## Tests

```bash
npm test                 # node:test
npm run lint             # tsc --noEmit
```

---

## Design decisions that look like bugs

- **`LOCAL_MODE` bypasses auth by default** and binds loopback only. Deliberate: single
  user, never forward-facing.
- **A crash-stranded `posting` row is marked `failed`, never retried.** If the crash
  happened after the API call, retrying would double-post. Losing a post is recoverable;
  double-posting publicly is not.
- **No cashtags.** Enforced by prompt instruction, not code — `normaliseTag` silently
  converts `$NVDA` to `#NVDA` rather than rejecting it.
- **A backlog over the per-run cap is logged, never silently truncated.**
- **Length is reasoned per story against the ~280-char fold**, not a fixed band.
