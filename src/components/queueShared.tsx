/**
 * Shared pieces for the three Post Queue views (Timeline, Week, Board).
 *
 * Extracted so the views agree on what a post card looks like and what a status colour
 * means. A status rendered amber in one view and grey in another is the kind of drift
 * that makes a queue untrustworthy at a glance.
 */
import { useState } from 'react';
import { Check, Clock, Trash2, Copy, SkipForward, AlertTriangle, AlertCircle, Hourglass } from 'lucide-react';
import { cn } from '../lib/utils';
import { etDisplayTime, localDisplayTime } from '../services/time';
import { ageHours, isStale } from '../services/slots';

export interface QueuePost {
  id: number;
  type_id: number | null;
  status: string;
  body: string | null;
  scheduled_at: string | null;
  time_confirmed: number;
  locked?: number;
  error?: string | null;
  x_post_id?: string | null;
  created_at?: string | null;
  type_code?: string | null;
  type_name?: string | null;
  type_color?: string | null;
  length_mode?: string | null;
  staleness_hours?: number | null;
  notes?: string | null;
  parent_post_id?: number | null;
  offset_minutes?: number | null;
  et_date?: string;
  /** Rule-check summary computed server-side, so the card and the gate never disagree. */
  rule?: { ok: boolean; errors: number; warnings: number; weightedLength: number; first: string | null };
}

export interface EmptySlot {
  typeId: number; code: string; name: string; color: string; at: string; etDate: string;
}

export interface Conflict { a: number; b: number; minutesApart: number }

export const STATUS_STYLE: Record<string, string> = {
  draft:        'text-gray-400 border-gray-400/30 bg-gray-400/5',
  needs_review: 'text-amber-400 border-amber-400/30 bg-amber-400/5',
  approved:     'text-green-400 border-green-400/30 bg-green-400/5',
  posting:      'text-sky-400 border-sky-400/30 bg-sky-400/5',
  posted:       'text-green-500 border-green-500/40 bg-green-500/10',
  failed:       'text-red-400 border-red-400/30 bg-red-400/5',
  skipped:      'text-gray-500 border-gray-500/30 bg-gray-500/5',
  archived:     'text-gray-600 border-gray-600/30 bg-gray-600/5',
};

export const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft', needs_review: 'Needs review', approved: 'Approved', posting: 'Posting',
  posted: 'Posted', failed: 'Failed', skipped: 'Skipped', archived: 'Archived',
};

/** Statuses a post can be dragged into on the Board, and what that means. */
export const BOARD_COLUMNS: Array<{ status: string; label: string; droppable: boolean }> = [
  { status: 'draft',        label: 'Draft',        droppable: false },
  { status: 'needs_review', label: 'Needs review', droppable: true  },
  { status: 'approved',     label: 'Approved',     droppable: true  },
  { status: 'skipped',      label: 'Skipped',      droppable: true  },
  { status: 'posted',       label: 'Posted',       droppable: false },
];

export const labelCls = 'text-[10px] font-mono uppercase tracking-widest text-btc-orange/50';
export const btn =
  'flex items-center gap-1.5 px-2 py-1 text-[10px] font-mono uppercase tracking-wider ' +
  'border transition-colors disabled:opacity-25 disabled:cursor-not-allowed';

export function dayHeading(etDate: string, todayEt: string): string {
  // Parsed as a plain calendar date, not an instant, so it can never shift a day.
  const [y, m, d] = etDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const [ty, tm, td] = todayEt.split('-').map(Number);
  const next = new Date(Date.UTC(ty, tm - 1, td + 1));
  const tomorrow = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
  const name = dt.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
  if (etDate === todayEt) return `Today · ${name}`;
  if (etDate === tomorrow) return `Tomorrow · ${name}`;
  return name;
}

export interface CardActions {
  onOpen: () => void;
  onSelect: () => void;
  onApprove: () => void;
  onUnapprove: () => void;
  onTime: () => void;
  onNextOpen: () => void;
  onSkip: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onEdit: (body: string) => void;
}

export function PostCard({
  post, conflicted, spacing, selected, busy, focused, actions,
}: {
  post: QueuePost;
  conflicted: boolean;
  spacing: number;
  selected: boolean;
  busy: boolean;
  focused?: boolean;
  actions: CardActions;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(post.body ?? '');
  const at = post.scheduled_at ? new Date(post.scheduled_at) : null;
  const terminal = ['posted', 'posting'].includes(post.status);
  const chars = (post.body ?? '').length;
  const overFold = chars > 280 && post.length_mode !== 'long';
  const stale = isStale(post);

  return (
    <div
      data-post-id={post.id}
      className={cn(
        'flex items-start gap-3 p-3 border transition-colors scroll-mt-24',
        post.status === 'approved' ? 'bg-[#0a0a0a] border-green-400/25' : 'bg-[#0a0a0a] border-btc-orange/15',
        post.time_confirmed ? '' : 'border-dashed',
        selected && 'ring-1 ring-btc-orange/50',
        focused && 'ring-2 ring-btc-orange',
        conflicted && 'border-amber-400/40',
      )}
    >
      <input type="checkbox" checked={selected} onChange={actions.onSelect} disabled={terminal}
             className="mt-1 shrink-0 accent-orange-500" />

      <div className="shrink-0 w-16 text-center pt-0.5">
        <p className="text-[11px] font-mono font-bold text-white">{at ? etDisplayTime(at) : '—'}</p>
        <p className="text-[9px] font-mono text-gray-600">{at ? `${localDisplayTime(at)} PHX` : ''}</p>
      </div>

      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          {post.type_color && <span className="w-2 h-2 rounded-sm" style={{ background: post.type_color }} />}
          <span className="text-[9px] font-mono px-1 py-0.5 border border-btc-orange/25 text-btc-orange/80">
            {post.type_code ?? '—'}
          </span>
          <span className={cn('text-[8px] font-mono uppercase px-1.5 py-0.5 border rounded-sm', STATUS_STYLE[post.status])}>
            {STATUS_LABEL[post.status] ?? post.status}
          </span>
          {!post.time_confirmed && post.scheduled_at && (
            <span className="text-[8px] font-mono uppercase text-gray-600">time proposed</span>
          )}
          {post.locked === 1 && (
            <span className="text-[8px] font-mono uppercase text-sky-400">locked — sends shortly</span>
          )}
          {stale && (
            <span className="flex items-center gap-1 text-[8px] font-mono uppercase text-amber-400"
                  title={`Drafted ${Math.round(ageHours(post) ?? 0)}h ago; this type goes stale after ${post.staleness_hours}h`}>
              <Hourglass size={9} /> stale
            </span>
          )}
          {conflicted && (
            <span className="flex items-center gap-1 text-[8px] font-mono uppercase text-amber-400">
              <AlertTriangle size={9} /> under {spacing}m spacing
            </span>
          )}
          {/* Rule verdict, from the same checker the approval gate enforces. */}
          {post.rule && (
            post.rule.errors > 0 ? (
              <span className="flex items-center gap-1 text-[8px] font-mono uppercase text-red-400"
                    title={post.rule.first ?? undefined}>
                <AlertCircle size={9} /> {post.rule.errors} blocking
              </span>
            ) : post.rule.warnings > 0 ? (
              <span className="flex items-center gap-1 text-[8px] font-mono uppercase text-amber-400/80"
                    title={post.rule.first ?? undefined}>
                <AlertTriangle size={9} /> {post.rule.warnings}
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[8px] font-mono uppercase text-green-400/70" title="Rule check passed">
                <Check size={9} /> ok
              </span>
            )
          )}
          <span className={cn('text-[8px] font-mono ml-auto', overFold ? 'text-amber-400/70' : 'text-gray-600')}>
            {post.rule?.weightedLength ?? chars}{overFold ? ' · past the fold' : ''}
          </span>
        </div>

        {editing ? (
          <div className="space-y-1.5">
            <textarea autoFocus rows={4} value={draft} onChange={e => setDraft(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Escape') { setDraft(post.body ?? ''); setEditing(false); } }}
                      className="w-full bg-[#111] border border-btc-orange/25 px-2 py-1.5 text-xs text-gray-200 leading-relaxed resize-y focus:outline-none focus:border-btc-orange/60" />
            <div className="flex gap-1.5 items-center">
              <button disabled={busy} onClick={() => { actions.onEdit(draft); setEditing(false); }}
                      className={cn(btn, 'text-btc-orange border-btc-orange/30 hover:bg-btc-orange/10')}>Save</button>
              <button onClick={() => { setDraft(post.body ?? ''); setEditing(false); }}
                      className={cn(btn, 'text-gray-400 border-btc-orange/15')}>Cancel</button>
              {post.status === 'approved' && (
                <span className="text-[9px] font-mono text-amber-400/70">saving returns this to Needs review</span>
              )}
            </div>
          </div>
        ) : (
          <p onClick={actions.onOpen}
             className="text-xs text-gray-400 leading-relaxed line-clamp-2 cursor-pointer hover:text-gray-300">
            {post.body || <em className="text-gray-600">empty draft</em>}
          </p>
        )}

        {post.error && <p className="text-[10px] text-red-400/80">{post.error}</p>}
      </div>

      {!terminal && !editing && (
        <div className="shrink-0 flex items-center gap-1">
          {post.status === 'approved' ? (
            <button disabled={busy} onClick={actions.onUnapprove} title="Pause / unapprove"
                    className={cn(btn, 'text-amber-400 border-amber-400/30 hover:bg-amber-400/10')}>Pause</button>
          ) : (
            <button disabled={busy || !post.body?.trim()} onClick={actions.onApprove} title="Approve and confirm the time"
                    className={cn(btn, 'text-green-400 border-green-400/30 hover:bg-green-400/10')}>
              <Check size={11} /> Approve
            </button>
          )}
          <button disabled={busy || post.locked === 1} onClick={() => setEditing(true)}
                  className={cn(btn, 'text-gray-300 border-btc-orange/20 hover:bg-btc-orange/10')}>Edit</button>
          <button disabled={busy} onClick={actions.onTime} title="Reschedule"
                  className="p-1.5 text-gray-500 hover:text-btc-orange"><Clock size={12} /></button>
          <button disabled={busy} onClick={actions.onDuplicate} title="Duplicate"
                  className="p-1.5 text-gray-500 hover:text-btc-orange"><Copy size={12} /></button>
          <button disabled={busy} onClick={actions.onSkip} title="Skip"
                  className="p-1.5 text-gray-500 hover:text-gray-300"><SkipForward size={12} /></button>
          <button disabled={busy} onClick={actions.onDelete} title="Delete"
                  className="p-1.5 text-red-500/40 hover:text-red-500"><Trash2 size={12} /></button>
        </div>
      )}
    </div>
  );
}

/** Compact card for the Week grid and Board columns, where vertical space is scarce. */
export function MiniCard({
  post, dragging, onDragStart, onDragEnd, onClick, conflicted,
}: {
  post: QueuePost;
  dragging?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
  onClick?: () => void;
  conflicted?: boolean;
}) {
  const at = post.scheduled_at ? new Date(post.scheduled_at) : null;
  const immovable = ['posted', 'posting'].includes(post.status);
  const stale = isStale(post);

  return (
    <div
      draggable={!immovable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      title={post.body ?? ''}
      className={cn(
        'px-1.5 py-1 border-l-2 text-left w-full space-y-0.5 transition-opacity',
        immovable ? 'cursor-default' : 'cursor-grab active:cursor-grabbing',
        dragging && 'opacity-30',
        post.status === 'approved' ? 'bg-green-400/5' : 'bg-[#111]',
        conflicted && 'ring-1 ring-amber-400/40',
      )}
      style={{ borderColor: post.type_color ?? '#f7931a' }}
    >
      <div className="flex items-center gap-1">
        {at && <span className="text-[9px] font-mono text-gray-300">{etDisplayTime(at)}</span>}
        <span className="text-[8px] font-mono text-btc-orange/60">{post.type_code}</span>
        {stale && <Hourglass size={8} className="text-amber-400 shrink-0" />}
        {conflicted && <AlertTriangle size={8} className="text-amber-400 shrink-0" />}
      </div>
      <p className="text-[9px] text-gray-500 line-clamp-2 leading-snug">
        {post.body || <em className="text-gray-700">empty</em>}
      </p>
      <span className={cn('inline-block text-[7px] font-mono uppercase px-1 border rounded-sm', STATUS_STYLE[post.status])}>
        {STATUS_LABEL[post.status] ?? post.status}
      </span>
    </div>
  );
}
