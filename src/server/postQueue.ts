/**
 * Post Queue routes — Phase A covers post types only.
 *
 * Follows the same shape as analytics.ts and markets.ts: a factory that takes its
 * dependencies and returns a router, so server.ts stays an assembly point rather than
 * growing another few hundred lines.
 *
 * Phases B–E add the queue itself (timeline, detail panel, generation) on top of the
 * `posts` table created in Phase A.
 */
import express from 'express';
import fs from 'fs';
import path from 'path';
import type Database from 'better-sqlite3';
import { validatePostType, type PostType } from '../services/postTypes.ts';
import {
  nextSlotForType, nextOpenTime, findSpacingConflicts, findEmptySlots,
  countForTypeOnDay, occupiesSlot, type SlotPost,
} from '../services/slots.ts';
import { etDateString, normaliseScheduledAt } from '../services/time.ts';
import { checkPost, type RuleCheckResult } from '../services/ruleCheck.ts';

export interface PostQueueDeps {
  db: Database.Database;
  requireAuth: express.RequestHandler;
}

/** Columns a client is allowed to write. `id` and the timestamps are never client-set. */
const WRITABLE = [
  'name', 'code', 'color', 'default_time_et', 'days_of_week', 'max_per_day',
  'prompt_template', 'card_type', 'cashtag_min', 'cashtag_max', 'hashtag_max',
  'length_mode', 'source_required', 'staleness_hours', 'active', 'sort_order',
] as const;

/**
 * Coerce the wire payload into column values.
 *
 * Empty string means "not set" for the nullable columns — an HTML input yields '' when
 * cleared, and storing that rather than NULL would make `default_time_et = ''` look like
 * a real slot time to the scheduler.
 */
function coerce(body: any): Partial<PostType> {
  const out: Record<string, unknown> = {};

  if (body.name != null) out.name = String(body.name).trim();
  if (body.code != null) out.code = String(body.code).trim().toUpperCase();
  if (body.color != null) out.color = String(body.color).trim();
  if (body.prompt_template != null) out.prompt_template = String(body.prompt_template);
  if (body.card_type != null) out.card_type = String(body.card_type);
  if (body.length_mode != null) out.length_mode = String(body.length_mode);
  if (body.days_of_week != null) out.days_of_week = String(body.days_of_week).trim();

  if (body.default_time_et !== undefined) {
    const v = String(body.default_time_et ?? '').trim();
    out.default_time_et = v === '' ? null : v;
  }
  for (const k of ['max_per_day', 'staleness_hours'] as const) {
    if (body[k] !== undefined) {
      const v = body[k];
      out[k] = v === '' || v === null ? null : Number(v);
    }
  }
  for (const k of ['cashtag_min', 'cashtag_max', 'hashtag_max', 'sort_order'] as const) {
    if (body[k] !== undefined) out[k] = Number(body[k]) || 0;
  }
  for (const k of ['source_required', 'active'] as const) {
    if (body[k] !== undefined) out[k] = body[k] ? 1 : 0;
  }

  return out as Partial<PostType>;
}

export function createPostQueueRouter({ db, requireAuth }: PostQueueDeps): express.Router {
  const router = express.Router();

  const getByCode = db.prepare('SELECT * FROM post_types WHERE code = ?');
  const getById = db.prepare('SELECT * FROM post_types WHERE id = ?');

  // ── Read ──

  router.get('/api/post-types', requireAuth, (req, res) => {
    const includeInactive = req.query.includeInactive === 'true';
    const rows = db.prepare(`
      SELECT * FROM post_types
      ${includeInactive ? '' : 'WHERE active = 1'}
      ORDER BY sort_order ASC, id ASC
    `).all() as PostType[];

    // Queued counts for the next 7 days — the left-rail numbers in the plan's wireframe.
    const counts = db.prepare(`
      SELECT type_id, COUNT(*) c FROM posts
      WHERE status NOT IN ('posted', 'archived', 'skipped')
        AND scheduled_at IS NOT NULL
        AND scheduled_at <= datetime('now', '+7 days')
      GROUP BY type_id
    `).all() as Array<{ type_id: number; c: number }>;
    const byType = new Map(counts.map(r => [r.type_id, r.c]));

    res.json({ types: rows.map(t => ({ ...t, queued_next_7d: byType.get(t.id) ?? 0 })) });
  });

  router.get('/api/post-types/:id', requireAuth, (req, res) => {
    const row = getById.get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Post type not found' });
    res.json(row);
  });

  // ── Create ──

  router.post('/api/post-types', requireAuth, (req, res) => {
    const input = coerce(req.body ?? {});
    const { ok, errors } = validatePostType(input);
    if (!ok) return res.status(400).json({ error: 'Validation failed', errors });

    if (getByCode.get(input.code!)) {
      return res.status(409).json({ error: `Short code "${input.code}" is already in use.` });
    }

    // Append to the end of the list unless a position was given.
    if (input.sort_order == null || input.sort_order === 0) {
      const max = db.prepare('SELECT COALESCE(MAX(sort_order), 0) m FROM post_types').get() as any;
      input.sort_order = (max.m ?? 0) + 10;
    }

    const info = db.prepare(`
      INSERT INTO post_types (name, code, color, default_time_et, days_of_week, max_per_day,
                              prompt_template, card_type, cashtag_min, cashtag_max, hashtag_max,
                              length_mode, source_required, staleness_hours, active, sort_order)
      VALUES (@name, @code, @color, @default_time_et, @days_of_week, @max_per_day,
              @prompt_template, @card_type, @cashtag_min, @cashtag_max, @hashtag_max,
              @length_mode, @source_required, @staleness_hours, @active, @sort_order)
    `).run({
      name: input.name, code: input.code, color: input.color ?? '#f7931a',
      default_time_et: input.default_time_et ?? null,
      days_of_week: input.days_of_week ?? '',
      max_per_day: input.max_per_day ?? null,
      prompt_template: input.prompt_template ?? '',
      card_type: input.card_type ?? 'none',
      cashtag_min: input.cashtag_min ?? 0,
      cashtag_max: input.cashtag_max ?? 0,
      hashtag_max: input.hashtag_max ?? 1,
      length_mode: input.length_mode ?? 'short',
      source_required: input.source_required ?? 1,
      staleness_hours: input.staleness_hours ?? null,
      active: input.active ?? 1,
      sort_order: input.sort_order,
    });

    res.status(201).json(getById.get(info.lastInsertRowid));
  });

  // ── Reorder ──
  //
  // MUST be registered before PUT /api/post-types/:id — Express matches in registration
  // order, so with :id first the literal path "reorder" would be captured as an id.
  router.put('/api/post-types/reorder', requireAuth, (req, res) => {
    const order = req.body?.order;
    if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be an array of ids' });

    const upd = db.prepare('UPDATE post_types SET sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
    db.transaction((ids: number[]) => {
      ids.forEach((id, i) => upd.run((i + 1) * 10, id));
    })(order.map(Number));

    res.json({ success: true });
  });

  // ── Update ──

  router.put('/api/post-types/:id', requireAuth, (req, res) => {
    const existing = getById.get(req.params.id) as PostType | undefined;
    if (!existing) return res.status(404).json({ error: 'Post type not found' });

    const patch = coerce(req.body ?? {});
    // Validate the merged result, not the patch: a partial update must still land on a
    // valid row, and validating the patch alone would miss min>max across two requests.
    const merged = { ...existing, ...patch };
    const { ok, errors } = validatePostType(merged);
    if (!ok) return res.status(400).json({ error: 'Validation failed', errors });

    if (patch.code && patch.code !== existing.code) {
      const clash = getByCode.get(patch.code) as PostType | undefined;
      if (clash && clash.id !== existing.id) {
        return res.status(409).json({ error: `Short code "${patch.code}" is already in use.` });
      }
    }

    const fields = WRITABLE.filter(k => patch[k] !== undefined);
    if (!fields.length) return res.json(existing);

    db.prepare(`
      UPDATE post_types SET ${fields.map(f => `${f} = @${f}`).join(', ')},
                            updated_at = CURRENT_TIMESTAMP
      WHERE id = @id
    `).run({ ...patch, id: existing.id });

    res.json(getById.get(existing.id));
  });

  // ── Duplicate ──

  router.post('/api/post-types/:id/duplicate', requireAuth, (req, res) => {
    const src = getById.get(req.params.id) as PostType | undefined;
    if (!src) return res.status(404).json({ error: 'Post type not found' });

    // Find a free code: S1 → S1B, S1C … rather than failing on the unique constraint.
    let code = `${src.code}B`;
    for (let i = 0; getByCode.get(code); i++) {
      code = `${src.code}${String.fromCharCode(66 + i + 1)}`;
      if (i > 20) return res.status(409).json({ error: 'Could not find a free short code — rename the original first.' });
    }

    const max = db.prepare('SELECT COALESCE(MAX(sort_order), 0) m FROM post_types').get() as any;
    const info = db.prepare(`
      INSERT INTO post_types (name, code, color, default_time_et, days_of_week, max_per_day,
                              prompt_template, card_type, cashtag_min, cashtag_max, hashtag_max,
                              length_mode, source_required, staleness_hours, active, sort_order)
      SELECT name || ' (copy)', ?, color, default_time_et, days_of_week, max_per_day,
             prompt_template, card_type, cashtag_min, cashtag_max, hashtag_max,
             length_mode, source_required, staleness_hours, 0, ?
      FROM post_types WHERE id = ?
    `).run(code, (max.m ?? 0) + 10, src.id);
    // Copies arrive paused (active = 0) so a duplicate never starts generating by accident.

    res.status(201).json(getById.get(info.lastInsertRowid));
  });

  // ── Approval ──
  //
  // The approve *UI* is Phase C, but the gate needs a key now: with the publisher
  // requiring approved + time_confirmed, a queue with no way to set either flag can
  // never send anything at all. These are the minimum to make the gate operable (and
  // to run the [VERIFY] test post).

  /**
   * Run the rule checker against a stored post, pulling its type and attached sources.
   * Used by both the approve gate and the read endpoints, so the UI can never show a
   * verdict that differs from the one approval will actually apply.
   */
  const ruleCheckFor = (post: any): RuleCheckResult => {
    const type = post.type_id
      ? (db.prepare('SELECT * FROM post_types WHERE id = ?').get(post.type_id) as PostType | undefined)
      : null;
    const sources = db.prepare('SELECT COUNT(*) c FROM post_sources WHERE post_id = ?').get(post.id) as any;
    const media = db.prepare('SELECT COUNT(*) c FROM post_media WHERE post_id = ?').get(post.id) as any;
    return checkPost(post.body ?? '', {
      type: type ?? null,
      // Now passed as a real count, including zero. Through Phase C this was left
      // undefined so the unsourced-number rule could only warn — there was no way to
      // attach a source, so enforcing it would have been an unclearable blocker. The
      // Sources tab exists now, so for a type with source_required it becomes an error.
      sourceCount: sources.c,
      hasMedia: media.c > 0,
    });
  };

  /** Trimmed shape for list rendering — the card only needs the verdict and counts. */
  const summariseCheck = (c: RuleCheckResult) => ({
    ok: c.ok,
    errors: c.errors.length,
    warnings: c.warnings.length,
    weightedLength: c.weightedLength,
    // First error is what the card shows on hover; the panel lists them all.
    first: c.errors[0]?.message ?? c.warnings[0]?.message ?? null,
  });

  router.get('/api/posts/:id/rule-check', requireAuth, (req, res) => {
    const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id) as any;
    if (!post) return res.status(404).json({ error: 'Post not found' });
    res.json(ruleCheckFor(post));
  });

  /** Check arbitrary text against a type — for the live check while editing. */
  router.post('/api/rule-check', requireAuth, (req, res) => {
    const { body = '', typeId } = req.body ?? {};
    const type = typeId != null
      ? (db.prepare('SELECT * FROM post_types WHERE id = ?').get(typeId) as PostType | undefined)
      : null;
    res.json(checkPost(String(body), { type: type ?? null }));
  });

  router.post('/api/posts/:id/approve', requireAuth, (req, res) => {
    const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id) as any;
    if (!post) return res.status(404).json({ error: 'Post not found' });

    if (['posting', 'posted'].includes(post.status)) {
      return res.status(409).json({ error: `Post is already ${post.status}.` });
    }
    if (!post.body?.trim()) {
      return res.status(400).json({ error: 'Cannot approve an empty post.' });
    }

    // The rule checker is enforced HERE, not only in the UI. A check that runs only in
    // the browser is advice; approval is the last gate before a public, billable,
    // irreversible action, so it has to hold server-side too.
    const check = ruleCheckFor(post);
    if (!check.ok) {
      return res.status(422).json({
        error: `Rule check failed: ${check.errors.map(e => e.message).join(' ')}`,
        ruleCheck: check,
      });
    }
    // Approving without a settled time would hand the publisher a slot Mike never
    // agreed to. Allow the caller to confirm the time in the same call.
    const confirmTime = req.body?.confirmTime === true || post.time_confirmed === 1;
    if (!post.scheduled_at) {
      return res.status(400).json({ error: 'Cannot approve a post with no scheduled time.' });
    }
    if (!confirmTime) {
      return res.status(400).json({
        error: 'Time is not confirmed. Re-send with {"confirmTime": true} to approve the proposed slot.',
        proposedAt: post.scheduled_at,
      });
    }

    db.prepare(`
      UPDATE posts SET status='approved', time_confirmed=1, error=NULL, updated_at=CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(post.id);

    res.json(db.prepare('SELECT * FROM posts WHERE id = ?').get(post.id));
  });

  router.post('/api/posts/:id/unapprove', requireAuth, (req, res) => {
    const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id) as any;
    if (!post) return res.status(404).json({ error: 'Post not found' });

    // 'posting' means the publisher has already claimed it; pulling approval now would
    // not stop the in-flight request and would misrepresent what happened.
    if (post.status === 'posting') {
      return res.status(409).json({ error: 'That post is being sent right now.' });
    }
    if (post.status === 'posted') {
      return res.status(409).json({ error: 'That post is already live on X.' });
    }

    db.prepare("UPDATE posts SET status='needs_review', updated_at=CURRENT_TIMESTAMP WHERE id = ?").run(post.id);
    res.json(db.prepare('SELECT * FROM posts WHERE id = ?').get(post.id));
  });

  // ── Delete ──

  router.delete('/api/post-types/:id', requireAuth, (req, res) => {
    const existing = getById.get(req.params.id) as PostType | undefined;
    if (!existing) return res.status(404).json({ error: 'Post type not found' });

    // Refuse to orphan posts. Deleting a type out from under a queued post would leave
    // the timeline with rows it cannot render or apply rules to.
    const inUse = db.prepare(
      "SELECT COUNT(*) c FROM posts WHERE type_id = ? AND status NOT IN ('archived')"
    ).get(existing.id) as any;

    if (inUse.c > 0) {
      return res.status(409).json({
        error: `"${existing.name}" still has ${inUse.c} post(s) in the queue. Pause it instead, or archive those posts first.`,
        queued: inUse.c,
      });
    }

    db.prepare('DELETE FROM post_types WHERE id = ?').run(existing.id);
    res.json({ success: true });
  });

  // ─── Queue settings ──────────────────────────────────────────────────────────
  //
  // Stored in app_settings rather than a dedicated settings table: the kill switch
  // already lives there, and two settings tables means two places to look.

  const QUEUE_DEFAULTS = { min_spacing_minutes: 60, lock_window_minutes: 5 } as const;

  const settingNum = (key: keyof typeof QUEUE_DEFAULTS): number => {
    try {
      const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(`queue_${key}`) as any;
      const n = Number(row?.value);
      return Number.isFinite(n) && n >= 0 ? n : QUEUE_DEFAULTS[key];
    } catch {
      return QUEUE_DEFAULTS[key];
    }
  };

  router.get('/api/queue-settings', requireAuth, (_req, res) => {
    res.json({
      min_spacing_minutes: settingNum('min_spacing_minutes'),
      lock_window_minutes: settingNum('lock_window_minutes'),
      defaults: QUEUE_DEFAULTS,
    });
  });

  router.put('/api/queue-settings', requireAuth, (req, res) => {
    const upsert = db.prepare(`
      INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `);
    for (const key of Object.keys(QUEUE_DEFAULTS) as Array<keyof typeof QUEUE_DEFAULTS>) {
      if (req.body?.[key] === undefined) continue;
      const n = Number(req.body[key]);
      if (!Number.isFinite(n) || n < 0) {
        return res.status(400).json({ error: `${key} must be 0 or more.` });
      }
      upsert.run(`queue_${key}`, String(Math.round(n)));
    }
    res.json({
      min_spacing_minutes: settingNum('min_spacing_minutes'),
      lock_window_minutes: settingNum('lock_window_minutes'),
    });
  });

  // ─── The queue ───────────────────────────────────────────────────────────────

  const getPost = db.prepare('SELECT * FROM posts WHERE id = ?');
  const allTypes = () => db.prepare('SELECT * FROM post_types ORDER BY sort_order, id').all() as PostType[];

  /** Occupying posts in a window — the working set for spacing and empty-slot maths. */
  const postsInWindow = (fromIso: string, toIso: string): SlotPost[] =>
    db.prepare(
      `SELECT id, type_id, status, scheduled_at, time_confirmed FROM posts
       WHERE scheduled_at IS NOT NULL AND scheduled_at >= ? AND scheduled_at <= ?`
    ).all(fromIso, toIso) as SlotPost[];

  /**
   * Is this post inside its lock window?
   *
   * Within a few minutes of sending, an approved post is frozen: the publisher may pick
   * it up at any tick, and an edit landing mid-flight would mean the text reviewed is
   * not the text sent. Unapproving ("Pause" in the plan) removes it from the next run
   * and unlocks it.
   */
  const isLocked = (post: any): boolean => {
    if (post.status !== 'approved' || !post.scheduled_at) return false;
    const lockMs = settingNum('lock_window_minutes') * 60_000;
    return new Date(post.scheduled_at).getTime() - Date.now() <= lockMs;
  };

  /**
   * GET /api/posts — everything the timeline needs, in one round trip.
   *
   * Returns the scheduled posts, the unscheduled rail, the empty-slot placeholders, the
   * spacing conflicts and the current settings together, because the timeline cannot
   * render a correct frame from any subset of those.
   */
  router.get('/api/posts', requireAuth, (req, res) => {
    const days = Math.min(60, Math.max(1, Number(req.query.days) || 7));
    const from = req.query.from ? new Date(String(req.query.from)) : new Date();
    if (!Number.isFinite(from.getTime())) return res.status(400).json({ error: 'Invalid `from` date' });

    // Start from the beginning of the ET day so "today" shows posts already past.
    const fromIso = new Date(from.getTime() - 24 * 3_600_000).toISOString();
    const toIso = new Date(from.getTime() + days * 24 * 3_600_000).toISOString();

    const typeFilter = req.query.type ? String(req.query.type) : null;
    const statusFilter = req.query.status ? String(req.query.status) : null;
    const q = req.query.q ? String(req.query.q).trim().toLowerCase() : null;

    const rows = db.prepare(`
      SELECT p.*, t.code AS type_code, t.name AS type_name, t.color AS type_color,
             t.length_mode, t.cashtag_max, t.hashtag_max, t.staleness_hours
      FROM posts p
      LEFT JOIN post_types t ON t.id = p.type_id
      WHERE (p.scheduled_at IS NULL OR (p.scheduled_at >= ? AND p.scheduled_at <= ?))
      ORDER BY p.scheduled_at IS NULL, p.scheduled_at ASC, p.id ASC
    `).all(fromIso, toIso) as any[];

    const filtered = rows.filter(r => {
      if (typeFilter && r.type_code !== typeFilter) return false;
      if (statusFilter && r.status !== statusFilter) return false;
      if (q && !String(r.body ?? '').toLowerCase().includes(q)) return false;
      return true;
    });

    const minSpacing = settingNum('min_spacing_minutes');
    const types = allTypes();
    const windowPosts = postsInWindow(fromIso, toIso);

    res.json({
      // Scheduled posts carry an ET day so the client groups without re-deriving it,
      // and a rule-check summary so each card can show pass/warn/fail without a
      // round trip per post.
      scheduled: filtered
        .filter(r => r.scheduled_at)
        .map(r => ({
          ...r,
          et_date: etDateString(new Date(r.scheduled_at)),
          locked: isLocked(r) ? 1 : 0,
          rule: summariseCheck(ruleCheckFor(r)),
        })),
      unscheduled: filtered.filter(r => !r.scheduled_at).map(r => ({ ...r, rule: summariseCheck(ruleCheckFor(r)) })),
      emptySlots: findEmptySlots(types, windowPosts, from, days),
      conflicts: findSpacingConflicts(windowPosts, minSpacing),
      settings: { min_spacing_minutes: minSpacing, lock_window_minutes: settingNum('lock_window_minutes') },
      types,
    });
  });

  /**
   * POST /api/posts — create a draft.
   *
   * With a typeId and no time, the draft lands at that type's next default slot, pushed
   * to the next open time if that would collide. This is the "generating a type puts a
   * draft in the right spot" half of Phase B's done-when. Content generation itself
   * comes later; placement is what Phase B owns.
   */
  router.post('/api/posts', requireAuth, (req, res) => {
    const { typeId, body = '', at, unscheduled } = req.body ?? {};

    const type = typeId != null ? (db.prepare('SELECT * FROM post_types WHERE id = ?').get(typeId) as PostType | undefined) : undefined;
    if (typeId != null && !type) return res.status(404).json({ error: 'Post type not found' });

    let scheduledAt: string | null = null;

    if (unscheduled) {
      scheduledAt = null;                       // straight to the Unscheduled rail
    } else if (at) {
      scheduledAt = normaliseScheduledAt(at);
      if (!scheduledAt) return res.status(400).json({ error: "Could not read that time. Use 'YYYY-MM-DD HH:MM' (Eastern) or ISO-8601." });
    } else if (type) {
      const slot = nextSlotForType(type);
      if (slot) {
        const window = postsInWindow(
          new Date().toISOString(),
          new Date(Date.now() + 30 * 24 * 3_600_000).toISOString(),
        );
        // Respect max_per_day: if the type is already full that day, try the day after.
        let candidate = slot;
        for (let i = 0; i < 14 && type.max_per_day != null; i++) {
          const onDay = countForTypeOnDay(window, type.id, etDateString(candidate));
          if (onDay < type.max_per_day) break;
          const next = nextSlotForType(type, new Date(candidate.getTime() + 60_000));
          if (!next) break;
          candidate = next;
        }
        scheduledAt = nextOpenTime(candidate, window, settingNum('min_spacing_minutes')).toISOString();
      }
      // A type with no slot (Manual, link reply) legitimately yields an unscheduled draft.
    }

    const info = db.prepare(`
      INSERT INTO posts (type_id, status, body, proposed_at, scheduled_at, time_confirmed,
                         is_long, user_id)
      VALUES (?, 'draft', ?, ?, ?, 0, ?, ?)
    `).run(
      type?.id ?? null, String(body), scheduledAt, scheduledAt,
      type?.length_mode === 'long' ? 1 : 0,
      (req.session as any)?.userId ?? null,
    );

    if (String(body).trim()) {
      recordVersion(Number(info.lastInsertRowid), String(body), (req.session as any)?.userId ?? null, 'created');
    }

    res.status(201).json(getPost.get(info.lastInsertRowid));
  });

  /**
   * PUT /api/posts/:id — edit a post.
   *
   * Editing the TEXT of an approved post sends it back to needs_review, per the build
   * plan's recommended option: nothing changed by accident goes out unreviewed. A
   * time-only change keeps the approval.
   */
  router.put('/api/posts/:id', requireAuth, (req, res) => {
    const post = getPost.get(req.params.id) as any;
    if (!post) return res.status(404).json({ error: 'Post not found' });
    if (post.status === 'posting') return res.status(409).json({ error: 'That post is being sent right now.' });
    if (post.status === 'posted') return res.status(409).json({ error: 'That post is already live on X.' });

    const patch: Record<string, unknown> = {};
    let contentChanged = false;

    if (req.body?.body !== undefined) {
      const next = String(req.body.body);
      if (next !== post.body) { patch.body = next; contentChanged = true; }
    }
    if (req.body?.notes !== undefined) patch.notes = String(req.body.notes);
    if (req.body?.tags !== undefined) patch.tags = String(req.body.tags);
    if (req.body?.priority !== undefined) patch.priority = Number(req.body.priority) || 0;
    if (req.body?.is_long !== undefined) patch.is_long = req.body.is_long ? 1 : 0;

    if (req.body?.typeId !== undefined) {
      const t = db.prepare('SELECT id FROM post_types WHERE id = ?').get(req.body.typeId) as any;
      if (!t) return res.status(404).json({ error: 'Post type not found' });
      patch.type_id = t.id;
    }

    if (req.body?.scheduled_at !== undefined) {
      if (req.body.scheduled_at === null || req.body.scheduled_at === '') {
        // Back to the Unscheduled rail. A confirmed time cannot survive having no time.
        patch.scheduled_at = null;
        patch.time_confirmed = 0;
      } else {
        const iso = normaliseScheduledAt(req.body.scheduled_at);
        if (!iso) return res.status(400).json({ error: "Could not read that time. Use 'YYYY-MM-DD HH:MM' (Eastern) or ISO-8601." });
        patch.scheduled_at = iso;
        if (req.body.confirmTime === true) patch.time_confirmed = 1;
      }
    }
    if (req.body?.confirmTime === true && patch.time_confirmed === undefined) {
      if (!post.scheduled_at && patch.scheduled_at == null) {
        return res.status(400).json({ error: 'Cannot confirm a time on a post that has none.' });
      }
      patch.time_confirmed = 1;
    }

    // The lock window only guards content. A post that is about to send can still be
    // moved later or unapproved — those are the escape hatches, not the hazard.
    if (contentChanged && isLocked(post)) {
      return res.status(409).json({
        error: `This post sends within ${settingNum('lock_window_minutes')} minutes and is locked. Unapprove it first to make changes.`,
        locked: true,
      });
    }

    if (contentChanged && post.status === 'approved') {
      patch.status = 'needs_review';
    }

    if (!Object.keys(patch).length) return res.json(post);

    db.prepare(`
      UPDATE posts SET ${Object.keys(patch).map(k => `${k} = @${k}`).join(', ')},
                       updated_at = CURRENT_TIMESTAMP
      WHERE id = @id
    `).run({ ...patch, id: post.id });

    // History: snapshot the text after every content change, so the History tab can
    // show what changed and restore any earlier state.
    if (contentChanged) {
      recordVersion(post.id, String(patch.body ?? ''), (req.session as any)?.userId ?? null, 'edited');
    }

    res.json({ ...(getPost.get(post.id) as any), returnedToReview: patch.status === 'needs_review' });
  });

  /**
   * POST /api/posts/:id/reschedule — move a post.
   *
   * Three modes, matching the Schedule tab's buttons: an explicit time, snap to the
   * type's own slot, or shuffle to the next conflict-free time.
   */
  router.post('/api/posts/:id/reschedule', requireAuth, (req, res) => {
    const post = getPost.get(req.params.id) as any;
    if (!post) return res.status(404).json({ error: 'Post not found' });
    if (['posting', 'posted'].includes(post.status)) {
      return res.status(409).json({ error: `Cannot reschedule a ${post.status} post.` });
    }

    const { mode = 'at', at } = req.body ?? {};
    const window = postsInWindow(
      new Date(Date.now() - 24 * 3_600_000).toISOString(),
      new Date(Date.now() + 60 * 24 * 3_600_000).toISOString(),
    ).filter(p => p.id !== post.id);   // a post never conflicts with itself

    let target: Date | null = null;

    if (mode === 'snap') {
      const type = db.prepare('SELECT * FROM post_types WHERE id = ?').get(post.type_id) as PostType | undefined;
      if (!type) return res.status(400).json({ error: 'This post has no type to snap to.' });
      target = nextSlotForType(type);
      if (!target) return res.status(400).json({ error: `${type.name} has no default slot to snap to.` });
    } else if (mode === 'nextOpen') {
      const base = post.scheduled_at ? new Date(post.scheduled_at) : new Date();
      target = nextOpenTime(base, window, settingNum('min_spacing_minutes'));
    } else {
      const iso = normaliseScheduledAt(at);
      if (!iso) return res.status(400).json({ error: "Could not read that time. Use 'YYYY-MM-DD HH:MM' (Eastern) or ISO-8601." });
      target = new Date(iso);
    }

    db.prepare('UPDATE posts SET scheduled_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(target.toISOString(), post.id);

    // Thread children trail the parent by a fixed offset. If the parent moves and they
    // don't, a "+60 min" reply lands before the post it is replying to.
    const children = db.prepare(
      "SELECT id, offset_minutes FROM posts WHERE parent_post_id = ? AND status NOT IN ('posted','posting')"
    ).all(post.id) as any[];
    for (const child of children) {
      const childAt = new Date(target.getTime() + (child.offset_minutes ?? 0) * 60_000);
      db.prepare('UPDATE posts SET scheduled_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(childAt.toISOString(), child.id);
    }

    // A moved post keeps its approval — only content edits revoke it.
    res.json({
      ...(getPost.get(post.id) as any),
      conflicts: findSpacingConflicts(
        [...window, { id: post.id, type_id: post.type_id, status: post.status, scheduled_at: target.toISOString() }],
        settingNum('min_spacing_minutes'),
      ).filter(c => c.a === post.id || c.b === post.id),
    });
  });

  router.post('/api/posts/:id/skip', requireAuth, (req, res) => {
    const post = getPost.get(req.params.id) as any;
    if (!post) return res.status(404).json({ error: 'Post not found' });
    if (['posting', 'posted'].includes(post.status)) {
      return res.status(409).json({ error: `Cannot skip a ${post.status} post.` });
    }
    db.prepare("UPDATE posts SET status='skipped', error='skipped by hand', updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .run(post.id);
    res.json(getPost.get(post.id));
  });

  router.post('/api/posts/:id/duplicate', requireAuth, (req, res) => {
    const post = getPost.get(req.params.id) as any;
    if (!post) return res.status(404).json({ error: 'Post not found' });

    // A copy lands unscheduled and unapproved. Cloning a time would guarantee a spacing
    // conflict, and cloning an approval would publish text nobody reviewed in that slot.
    const info = db.prepare(`
      INSERT INTO posts (type_id, status, body, is_long, proposed_at, scheduled_at,
                         time_confirmed, notes, tags, priority, source_url, user_id)
      SELECT type_id, 'draft', body, is_long, NULL, NULL, 0, notes, tags, priority, source_url, user_id
      FROM posts WHERE id = ?
    `).run(post.id);

    res.status(201).json(getPost.get(info.lastInsertRowid));
  });

  /** Bulk actions from the timeline's multi-select. */
  router.post('/api/posts/bulk', requireAuth, (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isFinite) : [];
    const action = String(req.body?.action ?? '');
    if (!ids.length) return res.status(400).json({ error: 'No posts selected.' });

    const placeholders = ids.map(() => '?').join(',');
    // Never touch a post mid-flight or already live, whatever the action.
    const eligible = db.prepare(
      `SELECT * FROM posts WHERE id IN (${placeholders}) AND status NOT IN ('posting','posted')`
    ).all(...ids) as any[];

    let changed = 0;
    const skipped: Array<{ id: number; reason: string }> = [];

    const run = db.transaction(() => {
      for (const post of eligible) {
        if (action === 'approve') {
          if (!post.body?.trim()) { skipped.push({ id: post.id, reason: 'empty body' }); continue; }
          if (!post.scheduled_at) { skipped.push({ id: post.id, reason: 'no scheduled time' }); continue; }
          // Bulk approve goes through the same gate as the single one. A multi-select
          // must not be a way to wave posts past the rule checker.
          const check = ruleCheckFor(post);
          if (!check.ok) { skipped.push({ id: post.id, reason: check.errors[0].code }); continue; }
          db.prepare("UPDATE posts SET status='approved', time_confirmed=1, error=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(post.id);
        } else if (action === 'skip') {
          db.prepare("UPDATE posts SET status='skipped', error='skipped by hand', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(post.id);
        } else if (action === 'unapprove') {
          db.prepare("UPDATE posts SET status='needs_review', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(post.id);
        } else if (action === 'shift') {
          const mins = Number(req.body?.minutes);
          if (!Number.isFinite(mins)) { skipped.push({ id: post.id, reason: 'invalid shift' }); continue; }
          if (!post.scheduled_at) { skipped.push({ id: post.id, reason: 'no scheduled time' }); continue; }
          const moved = new Date(new Date(post.scheduled_at).getTime() + mins * 60_000);
          db.prepare('UPDATE posts SET scheduled_at=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(moved.toISOString(), post.id);
        } else {
          throw new Error(`Unknown action "${action}"`);
        }
        changed++;
      }
    });

    try {
      run();
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }

    // Report what was left out rather than a count that quietly under-delivers.
    const untouched = ids.length - eligible.length;
    res.json({ success: true, changed, skipped, lockedOrSent: untouched });
  });

  // ─── Versions (History tab) ──────────────────────────────────────────────────
  //
  // Phase D's bar is "every change can be undone". A version is recorded on every body
  // change, including the change a restore makes — so restoring is itself undoable and
  // you can never walk into a corner.

  const recordVersion = (postId: number, body: string, who: string | null, reason: string) => {
    try {
      db.prepare(`INSERT INTO post_versions (post_id, body, changed_by, reason) VALUES (?, ?, ?, ?)`)
        .run(postId, body, who, reason);
    } catch (err) {
      // History is valuable but must never block the edit it is recording.
      console.error('[postQueue] version write failed:', err);
    }
  };

  router.get('/api/posts/:id/versions', requireAuth, (req, res) => {
    const rows = db.prepare(
      'SELECT id, body, changed_by, changed_at, reason FROM post_versions WHERE post_id = ? ORDER BY changed_at DESC, id DESC'
    ).all(req.params.id);
    res.json({ versions: rows });
  });

  router.post('/api/posts/:id/versions/:versionId/restore', requireAuth, (req, res) => {
    const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id) as any;
    if (!post) return res.status(404).json({ error: 'Post not found' });
    if (['posting', 'posted'].includes(post.status)) {
      return res.status(409).json({ error: `Cannot restore a ${post.status} post.` });
    }

    const version = db.prepare('SELECT * FROM post_versions WHERE id = ? AND post_id = ?')
      .get(req.params.versionId, post.id) as any;
    if (!version) return res.status(404).json({ error: 'Version not found for this post' });

    // Snapshot where we are before overwriting it, so the restore can be undone.
    if (post.body !== version.body) {
      recordVersion(post.id, post.body ?? '', (req.session as any)?.userId ?? null, 'before restore');
    }

    // A restore is a content change, so an approved post goes back for review — same
    // rule as a manual edit. Restoring text nobody re-read must not stay approved.
    const status = post.status === 'approved' ? 'needs_review' : post.status;
    db.prepare('UPDATE posts SET body = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(version.body, status, post.id);
    recordVersion(post.id, version.body ?? '', (req.session as any)?.userId ?? null, `restored v${version.id}`);

    res.json({ ...(db.prepare('SELECT * FROM posts WHERE id = ?').get(post.id) as any), returnedToReview: status === 'needs_review' });
  });

  // ─── Sources ─────────────────────────────────────────────────────────────────

  router.get('/api/posts/:id/sources', requireAuth, (req, res) => {
    res.json({
      sources: db.prepare('SELECT * FROM post_sources WHERE post_id = ? ORDER BY id').all(req.params.id),
    });
  });

  router.post('/api/posts/:id/sources', requireAuth, (req, res) => {
    const post = db.prepare('SELECT id FROM posts WHERE id = ?').get(req.params.id) as any;
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const name = String(req.body?.name ?? '').trim();
    const url = String(req.body?.url ?? '').trim();
    if (!name && !url) return res.status(400).json({ error: 'A source needs a name or a link.' });
    if (url && !/^https?:\/\//i.test(url)) {
      return res.status(400).json({ error: 'Source links must start with http:// or https://' });
    }

    const info = db.prepare(
      `INSERT INTO post_sources (post_id, name, url, pulled_at, confirmed) VALUES (?, ?, ?, ?, ?)`
    ).run(post.id, name || url, url || null, new Date().toISOString(), req.body?.confirmed ? 1 : 0);

    res.status(201).json(db.prepare('SELECT * FROM post_sources WHERE id = ?').get(info.lastInsertRowid));
  });

  router.put('/api/posts/:id/sources/:sourceId', requireAuth, (req, res) => {
    const row = db.prepare('SELECT * FROM post_sources WHERE id = ? AND post_id = ?')
      .get(req.params.sourceId, req.params.id) as any;
    if (!row) return res.status(404).json({ error: 'Source not found' });
    db.prepare('UPDATE post_sources SET confirmed = ? WHERE id = ?')
      .run(req.body?.confirmed ? 1 : 0, row.id);
    res.json(db.prepare('SELECT * FROM post_sources WHERE id = ?').get(row.id));
  });

  router.delete('/api/posts/:id/sources/:sourceId', requireAuth, (req, res) => {
    db.prepare('DELETE FROM post_sources WHERE id = ? AND post_id = ?').run(req.params.sourceId, req.params.id);
    res.json({ success: true });
  });

  // ─── Thread ──────────────────────────────────────────────────────────────────
  //
  // A follow-up sits at parent time + offset. The Substack link reply is the main case:
  // the link stays out of the parent post (where it would cost 30-50% of reach) and
  // goes one level down.

  router.get('/api/posts/:id/thread', requireAuth, (req, res) => {
    res.json({
      children: db.prepare(`
        SELECT p.*, t.code AS type_code, t.color AS type_color
        FROM posts p LEFT JOIN post_types t ON t.id = p.type_id
        WHERE p.parent_post_id = ? ORDER BY COALESCE(p.offset_minutes, 0), p.id
      `).all(req.params.id),
    });
  });

  router.post('/api/posts/:id/thread', requireAuth, (req, res) => {
    const parent = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id) as any;
    if (!parent) return res.status(404).json({ error: 'Parent post not found' });
    if (parent.parent_post_id) {
      // One level only. A reply to a reply would need the publisher to resolve a chain
      // of X ids in order, which it does not do.
      return res.status(400).json({ error: 'This post is already a reply. Threads are one level deep.' });
    }

    const offset = Number(req.body?.offsetMinutes);
    if (!Number.isFinite(offset) || offset < 0) {
      return res.status(400).json({ error: 'offsetMinutes must be 0 or more.' });
    }

    const typeId = req.body?.typeId != null
      ? ((db.prepare('SELECT id FROM post_types WHERE id = ?').get(req.body.typeId) as any)?.id ?? null)
      : ((db.prepare("SELECT id FROM post_types WHERE code = 'LINK'").get() as any)?.id ?? null);

    // The child's time trails the parent's. It is recomputed whenever the parent moves
    // (see the reschedule handler), so the offset stays true.
    const at = parent.scheduled_at
      ? new Date(new Date(parent.scheduled_at).getTime() + offset * 60_000).toISOString()
      : null;

    const info = db.prepare(`
      INSERT INTO posts (type_id, status, body, proposed_at, scheduled_at, time_confirmed,
                         parent_post_id, offset_minutes, user_id)
      VALUES (?, 'draft', ?, ?, ?, 0, ?, ?, ?)
    `).run(typeId, String(req.body?.body ?? ''), at, at, parent.id, offset, (req.session as any)?.userId ?? null);

    res.status(201).json(db.prepare('SELECT * FROM posts WHERE id = ?').get(info.lastInsertRowid));
  });

  // ─── Media ───────────────────────────────────────────────────────────────────
  //
  // Images arrive base64-encoded in JSON rather than multipart, which avoids adding a
  // parser dependency. The body limit is raised on THIS route only — lifting the global
  // 100kb would widen the surface on every endpoint.

  const MEDIA_DIR = path.resolve(process.env.MEDIA_DIR || 'media');
  const MAX_IMAGE_BYTES = 5 * 1024 * 1024;   // X's own still-image ceiling
  const ALLOWED_MIME: Record<string, string> = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
  };

  const bigJson = express.json({ limit: '8mb' });

  router.get('/api/posts/:id/media', requireAuth, (req, res) => {
    res.json({ media: db.prepare('SELECT * FROM post_media WHERE post_id = ? ORDER BY id').all(req.params.id) });
  });

  router.post('/api/posts/:id/media', requireAuth, bigJson, (req, res) => {
    const post = db.prepare('SELECT id FROM posts WHERE id = ?').get(req.params.id) as any;
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const { dataUrl, altText = '', cardType = null } = req.body ?? {};
    const m = /^data:([\w/+.-]+);base64,(.+)$/s.exec(String(dataUrl ?? ''));
    if (!m) return res.status(400).json({ error: 'Expected an image as a base64 data URL.' });

    const mime = m[1].toLowerCase();
    const ext = ALLOWED_MIME[mime];
    if (!ext) {
      return res.status(400).json({ error: `Unsupported image type ${mime}. Use PNG, JPEG, WebP or GIF.` });
    }

    const buf = Buffer.from(m[2], 'base64');
    if (!buf.length) return res.status(400).json({ error: 'The image decoded to nothing.' });
    if (buf.length > MAX_IMAGE_BYTES) {
      return res.status(413).json({ error: `Image is ${(buf.length / 1024 / 1024).toFixed(1)}MB; X's limit is 5MB.` });
    }

    // Alt text is required: X surfaces it to screen readers, and a chart with no
    // description is unreadable to anyone using one.
    const alt = String(altText).trim();
    if (!alt) return res.status(400).json({ error: 'Alt text is required.' });

    fs.mkdirSync(MEDIA_DIR, { recursive: true });
    // Filename is derived, never taken from the client — no path traversal surface.
    const filename = `post-${post.id}-${Date.now()}.${ext}`;
    fs.writeFileSync(path.join(MEDIA_DIR, filename), buf);

    // One image per post for now; replacing removes the previous file.
    const existing = db.prepare('SELECT * FROM post_media WHERE post_id = ?').all(post.id) as any[];
    for (const old of existing) {
      try { if (old.file_path) fs.unlinkSync(path.join(MEDIA_DIR, path.basename(old.file_path))); } catch { /* already gone */ }
      db.prepare('DELETE FROM post_media WHERE id = ?').run(old.id);
    }

    const info = db.prepare(
      `INSERT INTO post_media (post_id, card_type, file_path, alt_text) VALUES (?, ?, ?, ?)`
    ).run(post.id, cardType, filename, alt);

    res.status(201).json(db.prepare('SELECT * FROM post_media WHERE id = ?').get(info.lastInsertRowid));
  });

  router.put('/api/posts/:id/media/:mediaId', requireAuth, (req, res) => {
    const row = db.prepare('SELECT * FROM post_media WHERE id = ? AND post_id = ?')
      .get(req.params.mediaId, req.params.id) as any;
    if (!row) return res.status(404).json({ error: 'Image not found' });
    const alt = String(req.body?.altText ?? '').trim();
    if (!alt) return res.status(400).json({ error: 'Alt text is required.' });
    db.prepare('UPDATE post_media SET alt_text = ? WHERE id = ?').run(alt, row.id);
    res.json(db.prepare('SELECT * FROM post_media WHERE id = ?').get(row.id));
  });

  router.delete('/api/posts/:id/media/:mediaId', requireAuth, (req, res) => {
    const row = db.prepare('SELECT * FROM post_media WHERE id = ? AND post_id = ?')
      .get(req.params.mediaId, req.params.id) as any;
    if (!row) return res.status(404).json({ error: 'Image not found' });
    try { if (row.file_path) fs.unlinkSync(path.join(MEDIA_DIR, path.basename(row.file_path))); } catch { /* already gone */ }
    db.prepare('DELETE FROM post_media WHERE id = ?').run(row.id);
    res.json({ success: true });
  });

  /** Serve a stored image for the preview. basename() keeps this inside MEDIA_DIR. */
  router.get('/api/media/:mediaId/file', requireAuth, (req, res) => {
    const row = db.prepare('SELECT * FROM post_media WHERE id = ?').get(req.params.mediaId) as any;
    if (!row?.file_path) return res.status(404).json({ error: 'Not found' });
    const full = path.join(MEDIA_DIR, path.basename(row.file_path));
    if (!fs.existsSync(full)) return res.status(404).json({ error: 'File missing from disk' });
    res.sendFile(full);
  });

  router.delete('/api/posts/:id', requireAuth, (req, res) => {
    const post = getPost.get(req.params.id) as any;
    if (!post) return res.status(404).json({ error: 'Post not found' });
    if (post.status === 'posting') return res.status(409).json({ error: 'That post is being sent right now.' });

    // Unlink the image files BEFORE the row goes. post_media cascades on delete, so
    // once the post is gone there is no record of which file belonged to it and the
    // upload sits orphaned on disk forever.
    const media = db.prepare('SELECT file_path FROM post_media WHERE post_id = ?').all(post.id) as any[];
    for (const m of media) {
      if (!m.file_path) continue;
      try { fs.unlinkSync(path.join(MEDIA_DIR, path.basename(m.file_path))); } catch { /* already gone */ }
    }

    // Detach thread children rather than letting them dangle against a missing parent.
    // Deleting them too would silently remove a second post the operator did not pick.
    db.prepare('UPDATE posts SET parent_post_id = NULL, offset_minutes = NULL WHERE parent_post_id = ?').run(post.id);

    db.prepare('DELETE FROM posts WHERE id = ?').run(post.id);
    res.json({ success: true, mediaRemoved: media.length });
  });

  return router;
}
