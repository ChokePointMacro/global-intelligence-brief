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
import type Database from 'better-sqlite3';
import { validatePostType, type PostType } from '../services/postTypes.ts';

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

  router.post('/api/posts/:id/approve', requireAuth, (req, res) => {
    const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id) as any;
    if (!post) return res.status(404).json({ error: 'Post not found' });

    if (['posting', 'posted'].includes(post.status)) {
      return res.status(409).json({ error: `Post is already ${post.status}.` });
    }
    if (!post.body?.trim()) {
      return res.status(400).json({ error: 'Cannot approve an empty post.' });
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

  return router;
}
