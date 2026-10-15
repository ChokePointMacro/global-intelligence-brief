/**
 * pm2 process definition.
 *
 * Why this exists: the publisher is an in-memory `setInterval` inside a foreground
 * `tsx server.ts`. Close the terminal, hit a crash, or reboot, and scheduled posting
 * stops with no indication — the queue just quietly stops draining. pm2 keeps the
 * process alive across crashes and, with `pm2 startup`, across reboots.
 *
 * Setup (one time):
 *   npm install -g pm2
 *   pm2 start ecosystem.config.cjs
 *   pm2 save                 # remember the current process list
 *   pm2 startup              # prints a sudo command — run it to install the boot agent
 *
 * Day to day:
 *   pm2 status               # is it up, how many restarts
 *   pm2 logs gib             # tail output
 *   pm2 restart gib          # after a code change
 *   pm2 stop gib             # stop posting entirely (the kill switch is the softer option)
 *
 * .cjs rather than .js is required here: package.json sets "type": "module", so a .js
 * file would be loaded as ESM and `module.exports` would not exist. pm2 reads this
 * config with require(), and .cjs opts this one file back into CommonJS.
 */
module.exports = {
  apps: [
    {
      name: 'gib',
      // tsx is resolved from node_modules rather than assumed global.
      script: './node_modules/.bin/tsx',
      args: 'server.ts',
      cwd: __dirname,

      // Single instance, always. The publisher claims rows with an atomic UPDATE, which
      // makes it safe against a crash mid-flight — but the report scheduler and the
      // backup timer are not written for concurrency, and two instances would also
      // double every AI bill. Never raise this.
      instances: 1,
      exec_mode: 'fork',

      // Restart on crash, but stop flapping if it cannot start at all: 10 restarts
      // inside min_uptime and pm2 gives up rather than looping forever.
      autorestart: true,
      min_uptime: '30s',
      max_restarts: 10,
      restart_delay: 5000,

      // The app does not watch its own files; a code change needs an explicit restart.
      // Watching would restart mid-publish.
      watch: false,

      // tsx holds the TypeScript program in memory; this is a ceiling, not a target.
      max_memory_restart: '1G',

      env: {
        NODE_ENV: 'production',
      },

      // Logs. The app also writes structured JSONL via src/services/log.ts; these are
      // the raw stdout/stderr, which is where a startup crash shows up.
      output: './logs/pm2-out.log',
      error: './logs/pm2-error.log',
      merge_logs: true,
      time: true,
    },
  ],
};
