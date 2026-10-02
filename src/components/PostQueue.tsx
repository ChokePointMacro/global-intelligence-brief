/**
 * Post Queue timeline — Phase B.
 *
 * One place for every future post, grouped by Eastern day and sorted by time. Drafts
 * with no confirmed time sit in the Unscheduled rail; empty default slots show as
 * dashed placeholders so a gap in the week is visible rather than merely absent.
 *
 * Times are shown in Eastern with Phoenix underneath, because the offset between them
 * changes twice a year and "4:20 PM ET" is not a time Mike can act on directly.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader2, Plus, Check, Clock, Trash2, Copy, SkipForward, AlertTriangle,
  ChevronLeft, ChevronRight, Search, X as XIcon, Calendar, Inbox, Zap,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { BackButton } from './BackButton';
import { cn } from '../lib/utils';
import { etDisplayTime, localDisplayTime, etZoneAbbrev, etDateString, etInputValue } from '../services/time';
import type { PostType } from '../services/postTypes';

interface QueuePost {
  id: number;
  type_id: number | null;
  status: string;
  body: string | null;
  scheduled_at: string | null;
  time_confirmed: number;
  locked?: number;
  error?: string | null;
  x_post_id?: string | null;
  type_code?: string | null;
  type_name?: string | null;
  type_color?: string | null;
  length_mode?: string | null;
  et_date?: string;
}

interface EmptySlot {
  typeId: number; code: string; name: string; color: string; at: string; etDate: string;
}

interface Conflict { a: number; b: number; minutesApart: number }

const STATUS_STYLE: Record<string, string> = {
  draft:        'text-gray-400 border-gray-400/30 bg-gray-400/5',
  needs_review: 'text-amber-400 border-amber-400/30 bg-amber-400/5',
  approved:     'text-green-400 border-green-400/30 bg-green-400/5',
  posting:      'text-sky-400 border-sky-400/30 bg-sky-400/5',
  posted:       'text-green-500 border-green-500/40 bg-green-500/10',
  failed:       'text-red-400 border-red-400/30 bg-red-400/5',
  skipped:      'text-gray-500 border-gray-500/30 bg-gray-500/5',
  archived:     'text-gray-600 border-gray-600/30 bg-gray-600/5',
};

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft', needs_review: 'Needs review', approved: 'Approved', posting: 'Posting',
  posted: 'Posted', failed: 'Failed', skipped: 'Skipped', archived: 'Archived',
};

const label = 'text-[10px] font-mono uppercase tracking-widest text-btc-orange/50';
const btn =
  'flex items-center gap-1.5 px-2 py-1 text-[10px] font-mono uppercase tracking-wider ' +
  'border transition-colors disabled:opacity-25 disabled:cursor-not-allowed';

const dayHeading = (etDate: string) => {
  // Parse as a plain calendar date — not an instant — so it never shifts a day.
  const [y, m, d] = etDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const today = etDateString();
  const tomorrow = (() => {
    const [ty, tm, td] = today.split('-').map(Number);
    const n = new Date(Date.UTC(ty, tm - 1, td + 1));
    return `${n.getUTCFullYear()}-${String(n.getUTCMonth() + 1).padStart(2, '0')}-${String(n.getUTCDate()).padStart(2, '0')}`;
  })();
  const name = dt.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
  if (etDate === today) return `Today · ${name}`;
  if (etDate === tomorrow) return `Tomorrow · ${name}`;
  return name;
};

export const PostQueue = () => {
  const [posts, setPosts] = useState<QueuePost[]>([]);
  const [unscheduled, setUnscheduled] = useState<QueuePost[]>([]);
  const [emptySlots, setEmptySlots] = useState<EmptySlot[]>([]);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [types, setTypes] = useState<PostType[]>([]);
  const [spacing, setSpacing] = useState(60);
  const [posting, setPosting] = useState<{ enabled: boolean } | null>(null);

  const [offsetDays, setOffsetDays] = useState(0);
  const [days] = useState(7);
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showGenerate, setShowGenerate] = useState(false);

  const zone = useMemo(() => etZoneAbbrev(), []);
  const from = useMemo(
    () => new Date(Date.now() + offsetDays * 24 * 3_600_000),
    [offsetDays],
  );

  // Guards against an in-flight load from a previous filter overwriting a newer one.
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    const params = new URLSearchParams({ from: from.toISOString(), days: String(days) });
    if (typeFilter) params.set('type', typeFilter);
    if (statusFilter) params.set('status', statusFilter);
    if (query.trim()) params.set('q', query.trim());

    try {
      const [qRes, pRes] = await Promise.all([
        apiFetch(`/api/posts?${params}`),
        apiFetch('/api/posting/status'),
      ]);
      if (seq !== loadSeq.current) return;   // a newer load has superseded this one
      const d = await qRes.json();
      setPosts(d.scheduled ?? []);
      setUnscheduled(d.unscheduled ?? []);
      setEmptySlots(d.emptySlots ?? []);
      setConflicts(d.conflicts ?? []);
      setTypes(d.types ?? []);
      setSpacing(d.settings?.min_spacing_minutes ?? 60);
      setPosting(await pRes.json().catch(() => null));
    } catch {
      if (seq === loadSeq.current) setError('Could not load the queue.');
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [from, days, typeFilter, statusFilter, query]);

  useEffect(() => { void load(); }, [load]);

  const call = async (url: string, options: RequestInit = {}) => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(url, options);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || 'That action failed.');
        return null;
      }
      await load();
      return res;
    } finally {
      setBusy(false);
    }
  };

  const conflictIds = useMemo(() => {
    const s = new Set<number>();
    for (const c of conflicts) { s.add(c.a); s.add(c.b); }
    return s;
  }, [conflicts]);

  /**
   * Merge posts and empty-slot placeholders into one chronological list per ET day.
   * Re-derived from state on every render, so a reschedule re-sorts with no extra work.
   */
  const timeline = useMemo(() => {
    type Entry = { at: string; kind: 'post'; post: QueuePost } | { at: string; kind: 'slot'; slot: EmptySlot };
    const entries: Entry[] = [
      ...posts.map(p => ({ at: p.scheduled_at!, kind: 'post' as const, post: p })),
      // Placeholders are suppressed while a filter is on — an empty S5 slot is not a
      // match for "show me failed posts", and showing it would misread as a result.
      ...(typeFilter || statusFilter || query.trim()
        ? []
        : emptySlots.map(s => ({ at: s.at, kind: 'slot' as const, slot: s }))),
    ].sort((a, b) => a.at.localeCompare(b.at));

    const byDay = new Map<string, Entry[]>();
    for (const e of entries) {
      const key = e.kind === 'post' ? (e.post.et_date ?? etDateString(new Date(e.at))) : e.slot.etDate;
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key)!.push(e);
    }
    return [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [posts, emptySlots, typeFilter, statusFilter, query]);

  const toggleSelect = (id: number) =>
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const bulk = async (action: string, minutes?: number) => {
    const res = await call('/api/posts/bulk', {
      method: 'POST',
      body: JSON.stringify({ ids: [...selected], action, minutes }),
    });
    if (res) {
      const d = await res.json().catch(() => null);
      if (d?.skipped?.length) {
        setError(`${d.changed} updated; ${d.skipped.length} skipped (${d.skipped.map((s: any) => s.reason).join(', ')}).`);
      }
      setSelected(new Set());
    }
  };

  const generate = async (typeId: number | null, unscheduledOnly = false) => {
    setShowGenerate(false);
    await call('/api/posts', {
      method: 'POST',
      body: JSON.stringify({ typeId, unscheduled: unscheduledOnly, body: '' }),
    });
  };

  const reschedule = async (id: number, mode: string, at?: string) =>
    call(`/api/posts/${id}/reschedule`, { method: 'POST', body: JSON.stringify({ mode, at }) });

  const promptTime = async (post: QueuePost) => {
    const current = post.scheduled_at ? etInputValue(new Date(post.scheduled_at)) : etInputValue(new Date());
    const next = window.prompt(`New time in Eastern (${zone}) — YYYY-MM-DD HH:mm:`, current);
    if (next) await reschedule(post.id, 'at', next);
  };

  if (loading) {
    return <div className="flex items-center justify-center py-32"><Loader2 className="animate-spin text-btc-orange" size={24} /></div>;
  }

  const typeCounts = new Map<string, number>();
  for (const p of posts) if (p.type_code) typeCounts.set(p.type_code, (typeCounts.get(p.type_code) ?? 0) + 1);

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-4">
      <BackButton />

      {/* ── Top bar ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className={label}>Post Queue</p>
          <h1 className="text-3xl font-serif italic text-white mt-1">The Queue.</h1>
          <p className="text-xs text-gray-500 mt-1.5">
            Grouped by {zone} day. Phoenix time shown underneath — the gap between them changes twice a year.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className={cn('px-2 py-1 text-[10px] font-mono uppercase tracking-wider border',
            posting?.enabled ? 'text-green-400 border-green-400/30 bg-green-400/5'
                             : 'text-red-400 border-red-400/30 bg-red-400/5')}>
            Posting {posting?.enabled ? 'on' : 'off'}
          </div>
          <div className="relative">
            <button onClick={() => setShowGenerate(v => !v)}
                    className={cn(btn, 'text-btc-orange border-btc-orange/30 hover:bg-btc-orange/10 px-3 py-2')}>
              <Plus size={13} /> Generate
            </button>
            {showGenerate && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowGenerate(false)} />
                <div className="absolute right-0 mt-1 w-60 bg-[#0a0a0a] border border-btc-orange/25 z-50 py-1">
                  <p className="px-3 py-1.5 text-[9px] font-mono uppercase tracking-widest text-gray-600">
                    Draft into a type's next slot
                  </p>
                  {types.filter(t => t.active).map(t => (
                    <button key={t.id} onClick={() => generate(t.id)}
                            className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-gray-300 hover:bg-btc-orange/10">
                      <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: t.color }} />
                      <span className="font-mono text-[10px] text-btc-orange/70 w-9">{t.code}</span>
                      <span className="truncate">{t.name}</span>
                    </button>
                  ))}
                  <div className="border-t border-btc-orange/15 mt-1 pt-1">
                    <button onClick={() => generate(null, true)}
                            className="w-full px-3 py-1.5 text-left text-xs text-gray-400 hover:bg-btc-orange/10">
                      Blank unscheduled draft
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="flex items-center gap-2 flex-wrap border border-btc-orange/15 p-2">
        <div className="flex items-center">
          <button onClick={() => setOffsetDays(d => d - 7)} className="p-1.5 text-gray-500 hover:text-btc-orange"><ChevronLeft size={14} /></button>
          <button onClick={() => setOffsetDays(0)}
                  className={cn('px-2 py-1 text-[10px] font-mono uppercase tracking-wider',
                    offsetDays === 0 ? 'text-btc-orange' : 'text-gray-500 hover:text-btc-orange')}>
            Today
          </button>
          <button onClick={() => setOffsetDays(d => d + 7)} className="p-1.5 text-gray-500 hover:text-btc-orange"><ChevronRight size={14} /></button>
        </div>

        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
                className="bg-[#0a0a0a] border border-btc-orange/20 px-2 py-1 text-[11px] text-gray-300">
          <option value="">All types</option>
          {types.map(t => <option key={t.id} value={t.code}>{t.code} · {t.name}</option>)}
        </select>

        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
                className="bg-[#0a0a0a] border border-btc-orange/20 px-2 py-1 text-[11px] text-gray-300">
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>

        <div className="flex items-center gap-1.5 flex-1 min-w-[160px]">
          <Search size={12} className="text-btc-orange/40 shrink-0" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search post text…"
                 className="flex-1 bg-transparent text-[11px] text-gray-300 focus:outline-none" />
          {query && <button onClick={() => setQuery('')} className="text-gray-600 hover:text-white"><XIcon size={12} /></button>}
        </div>

        {conflicts.length > 0 && (
          <span className="flex items-center gap-1 px-2 py-1 text-[10px] font-mono uppercase
                           text-amber-400 border border-amber-400/30 bg-amber-400/5">
            <AlertTriangle size={11} /> {conflicts.length} spacing conflict{conflicts.length > 1 ? 's' : ''}
          </span>
        )}
      </div>

      {error && (
        <div className="flex items-start justify-between gap-3 px-3 py-2 border border-red-500/30 bg-red-500/5">
          <p className="text-xs text-red-400">{error}</p>
          <button onClick={() => setError(null)} className="text-red-400/50 hover:text-red-400"><XIcon size={13} /></button>
        </div>
      )}

      {/* ── Bulk bar ── */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 flex-wrap px-3 py-2 border border-btc-orange/30 bg-btc-orange/5 sticky top-2 z-30">
          <span className="text-[11px] font-mono text-btc-orange">{selected.size} selected</span>
          <button disabled={busy} onClick={() => bulk('approve')} className={cn(btn, 'text-green-400 border-green-400/30 hover:bg-green-400/10')}>
            <Check size={11} /> Approve
          </button>
          <button disabled={busy} onClick={() => bulk('unapprove')} className={cn(btn, 'text-amber-400 border-amber-400/30 hover:bg-amber-400/10')}>
            Unapprove
          </button>
          <button disabled={busy} onClick={() => bulk('shift', -15)} className={cn(btn, 'text-gray-300 border-btc-orange/20 hover:bg-btc-orange/10')}>−15 min</button>
          <button disabled={busy} onClick={() => bulk('shift', 15)} className={cn(btn, 'text-gray-300 border-btc-orange/20 hover:bg-btc-orange/10')}>+15 min</button>
          <button disabled={busy} onClick={() => bulk('skip')} className={cn(btn, 'text-gray-400 border-gray-500/30 hover:bg-gray-500/10')}>
            <SkipForward size={11} /> Skip
          </button>
          <button onClick={() => setSelected(new Set())} className="ml-auto text-[10px] font-mono uppercase text-gray-500 hover:text-white">Clear</button>
        </div>
      )}

      <div className="flex gap-4 items-start">
        {/* ── Left rail ── */}
        <aside className="w-48 shrink-0 space-y-3">
          <div className="border border-btc-orange/15">
            <p className={cn(label, 'px-2.5 py-2 border-b border-btc-orange/15 flex items-center gap-1.5')}>
              <Inbox size={11} /> Unscheduled
            </p>
            {unscheduled.length === 0 ? (
              <p className="px-2.5 py-3 text-[10px] text-gray-600">Nothing waiting</p>
            ) : unscheduled.map(p => (
              <div key={p.id} className="px-2.5 py-2 border-b border-btc-orange/10 last:border-0 space-y-1.5">
                <div className="flex items-center gap-1.5">
                  {p.type_color && <span className="w-2 h-2 rounded-sm" style={{ background: p.type_color }} />}
                  <span className="text-[9px] font-mono text-btc-orange/70">{p.type_code ?? '—'}</span>
                </div>
                <p className="text-[10px] text-gray-400 line-clamp-2">{p.body || <em className="text-gray-600">empty draft</em>}</p>
                <div className="flex gap-1">
                  <button disabled={busy} onClick={() => reschedule(p.id, 'snap')} title="Snap to this type's slot"
                          className={cn(btn, 'text-btc-orange/70 border-btc-orange/20 hover:bg-btc-orange/10')}>
                    <Zap size={10} /> Slot
                  </button>
                  <button disabled={busy} onClick={() => promptTime(p)}
                          className={cn(btn, 'text-gray-400 border-btc-orange/15 hover:bg-btc-orange/10')}>
                    <Clock size={10} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="border border-btc-orange/15">
            <p className={cn(label, 'px-2.5 py-2 border-b border-btc-orange/15')}>Types · next {days}d</p>
            {types.filter(t => t.active).map(t => (
              <button key={t.id} onClick={() => setTypeFilter(typeFilter === t.code ? '' : t.code)}
                      className={cn('w-full flex items-center gap-2 px-2.5 py-1.5 text-left border-b border-btc-orange/10 last:border-0 hover:bg-btc-orange/5',
                        typeFilter === t.code && 'bg-btc-orange/10')}>
                <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: t.color }} />
                <span className="text-[10px] font-mono text-btc-orange/70 w-8">{t.code}</span>
                <span className="text-[10px] text-gray-500 ml-auto">{typeCounts.get(t.code) ?? 0}</span>
              </button>
            ))}
          </div>
        </aside>

        {/* ── Timeline ── */}
        <div className="flex-1 min-w-0 space-y-4">
          {timeline.length === 0 && (
            <div className="py-20 text-center border-2 border-dashed border-btc-orange/10">
              <Calendar className="mx-auto text-btc-orange opacity-10 mb-3" size={40} />
              <p className="text-xs font-mono uppercase tracking-widest text-btc-orange/30">Nothing in this window</p>
              <p className="text-[10px] font-mono text-gray-600 mt-2">Use Generate to draft into a type's next slot</p>
            </div>
          )}

          {timeline.map(([etDate, entries]) => (
            <div key={etDate} className="space-y-1.5">
              <div className="flex items-center gap-3">
                <p className="text-[10px] font-mono uppercase tracking-widest text-btc-orange/60">{dayHeading(etDate)}</p>
                <div className="flex-1 h-px bg-btc-orange/10" />
                <span className="text-[9px] font-mono text-gray-600">
                  {entries.filter(e => e.kind === 'post').length} post{entries.filter(e => e.kind === 'post').length === 1 ? '' : 's'}
                </span>
              </div>

              {entries.map(entry => entry.kind === 'slot' ? (
                <div key={`slot-${entry.slot.typeId}-${entry.at}`}
                     className="flex items-center gap-3 p-3 border border-dashed border-btc-orange/20">
                  <div className="shrink-0 w-16 text-center">
                    <p className="text-[11px] font-mono text-gray-500">{etDisplayTime(new Date(entry.at))}</p>
                    <p className="text-[9px] font-mono text-gray-700">{localDisplayTime(new Date(entry.at))} PHX</p>
                  </div>
                  <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: entry.slot.color }} />
                  <p className="text-[11px] text-gray-500 flex-1 min-w-0 truncate">
                    <span className="font-mono text-btc-orange/60">{entry.slot.code}</span> {entry.slot.name} — no post yet
                  </p>
                  <button disabled={busy} onClick={() => generate(entry.slot.typeId)}
                          className={cn(btn, 'text-btc-orange border-btc-orange/30 hover:bg-btc-orange/10')}>
                    <Plus size={11} /> Generate
                  </button>
                </div>
              ) : (
                <PostCard
                  key={entry.post.id}
                  post={entry.post}
                  conflicted={conflictIds.has(entry.post.id)}
                  spacing={spacing}
                  selected={selected.has(entry.post.id)}
                  busy={busy}
                  onSelect={() => toggleSelect(entry.post.id)}
                  onApprove={() => call(`/api/posts/${entry.post.id}/approve`, { method: 'POST', body: JSON.stringify({ confirmTime: true }) })}
                  onUnapprove={() => call(`/api/posts/${entry.post.id}/unapprove`, { method: 'POST' })}
                  onTime={() => promptTime(entry.post)}
                  onNextOpen={() => reschedule(entry.post.id, 'nextOpen')}
                  onSkip={() => call(`/api/posts/${entry.post.id}/skip`, { method: 'POST' })}
                  onDuplicate={() => call(`/api/posts/${entry.post.id}/duplicate`, { method: 'POST' })}
                  onDelete={() => call(`/api/posts/${entry.post.id}`, { method: 'DELETE' })}
                  onEdit={async (body) => call(`/api/posts/${entry.post.id}`, { method: 'PUT', body: JSON.stringify({ body }) })}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ─── Card ──────────────────────────────────────────────────────────────────────

function PostCard({
  post, conflicted, spacing, selected, busy,
  onSelect, onApprove, onUnapprove, onTime, onNextOpen, onSkip, onDuplicate, onDelete, onEdit,
}: {
  post: QueuePost; conflicted: boolean; spacing: number; selected: boolean; busy: boolean;
  onSelect: () => void; onApprove: () => void; onUnapprove: () => void; onTime: () => void;
  onNextOpen: () => void; onSkip: () => void; onDuplicate: () => void; onDelete: () => void;
  onEdit: (body: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(post.body ?? '');
  const at = post.scheduled_at ? new Date(post.scheduled_at) : null;
  const terminal = ['posted', 'posting'].includes(post.status);
  const chars = (post.body ?? '').length;
  const overFold = chars > 280;

  return (
    <div className={cn(
      'flex items-start gap-3 p-3 border transition-colors',
      post.status === 'approved' ? 'bg-[#0a0a0a] border-green-400/25' : 'bg-[#0a0a0a] border-btc-orange/15',
      post.time_confirmed ? '' : 'border-dashed',
      selected && 'ring-1 ring-btc-orange/50',
      conflicted && 'border-amber-400/40',
    )}>
      <input type="checkbox" checked={selected} onChange={onSelect} disabled={terminal}
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
          {conflicted && (
            <span className="flex items-center gap-1 text-[8px] font-mono uppercase text-amber-400">
              <AlertTriangle size={9} /> under {spacing}m spacing
            </span>
          )}
          <span className={cn('text-[8px] font-mono ml-auto', overFold ? 'text-amber-400/70' : 'text-gray-600')}>
            {chars}{overFold && post.length_mode !== 'long' ? ' · past the fold' : ''}
          </span>
        </div>

        {editing ? (
          <div className="space-y-1.5">
            <textarea rows={4} value={draft} onChange={e => setDraft(e.target.value)}
                      className="w-full bg-[#111] border border-btc-orange/25 px-2 py-1.5 text-xs text-gray-200 leading-relaxed resize-y focus:outline-none focus:border-btc-orange/60" />
            <div className="flex gap-1.5">
              <button disabled={busy} onClick={() => { onEdit(draft); setEditing(false); }}
                      className={cn(btn, 'text-btc-orange border-btc-orange/30 hover:bg-btc-orange/10')}>Save</button>
              <button onClick={() => { setDraft(post.body ?? ''); setEditing(false); }}
                      className={cn(btn, 'text-gray-400 border-btc-orange/15')}>Cancel</button>
              {post.status === 'approved' && (
                <span className="text-[9px] font-mono text-amber-400/70 self-center">saving returns this to Needs review</span>
              )}
            </div>
          </div>
        ) : (
          <p className="text-xs text-gray-400 leading-relaxed line-clamp-2">
            {post.body || <em className="text-gray-600">empty draft</em>}
          </p>
        )}

        {post.error && <p className="text-[10px] text-red-400/80">{post.error}</p>}
      </div>

      {!terminal && !editing && (
        <div className="shrink-0 flex items-center gap-1">
          {post.status === 'approved' ? (
            <button disabled={busy} onClick={onUnapprove} title="Pause / unapprove"
                    className={cn(btn, 'text-amber-400 border-amber-400/30 hover:bg-amber-400/10')}>Pause</button>
          ) : (
            <button disabled={busy || !post.body?.trim()} onClick={onApprove} title="Approve and confirm the time"
                    className={cn(btn, 'text-green-400 border-green-400/30 hover:bg-green-400/10')}>
              <Check size={11} /> Approve
            </button>
          )}
          <button disabled={busy || post.locked === 1} onClick={() => setEditing(true)}
                  className={cn(btn, 'text-gray-300 border-btc-orange/20 hover:bg-btc-orange/10')}>Edit</button>
          <button disabled={busy} onClick={onTime} title="Reschedule"
                  className="p-1.5 text-gray-500 hover:text-btc-orange"><Clock size={12} /></button>
          {conflicted && (
            <button disabled={busy} onClick={onNextOpen} title="Move to the next open time"
                    className="p-1.5 text-amber-400/70 hover:text-amber-400"><Zap size={12} /></button>
          )}
          <button disabled={busy} onClick={onDuplicate} title="Duplicate"
                  className="p-1.5 text-gray-500 hover:text-btc-orange"><Copy size={12} /></button>
          <button disabled={busy} onClick={onSkip} title="Skip"
                  className="p-1.5 text-gray-500 hover:text-gray-300"><SkipForward size={12} /></button>
          <button disabled={busy} onClick={onDelete} title="Delete"
                  className="p-1.5 text-red-500/40 hover:text-red-500"><Trash2 size={12} /></button>
        </div>
      )}
    </div>
  );
}
