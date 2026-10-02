/**
 * Post Queue — Phases B and E.
 *
 * One place for every future post. Three views over the same data:
 *   Timeline — grouped by Eastern day, the default for working through a day
 *   Week     — seven-column grid, drag a post to another day
 *   Board    — columns by status, drag a post through its lifecycle
 *
 * Times are shown in Eastern with Phoenix underneath, because the offset between them
 * changes twice a year and "4:20 PM ET" is not a time Mike can act on directly.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader2, Plus, Check, AlertTriangle, ChevronLeft, ChevronRight, Search,
  X as XIcon, Calendar, Inbox, Zap, SkipForward, Keyboard,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { BackButton } from './BackButton';
import { cn } from '../lib/utils';
import { etZoneAbbrev, etDateString, etInputValue, etToUtc, etParts, etDisplayTime, localDisplayTime } from '../services/time';
import type { PostType } from '../services/postTypes';
import { PostQueueWeek } from './PostQueueWeek';
import { PostQueueBoard } from './PostQueueBoard';
import {
  PostCard, dayHeading, labelCls, btn, STATUS_LABEL,
  type QueuePost, type EmptySlot, type Conflict,
} from './queueShared';

type View = 'timeline' | 'week' | 'board';

const SHORTCUTS: Array<[string, string]> = [
  ['J / ↓', 'next post'], ['K / ↑', 'previous post'], ['Enter', 'edit'],
  ['A', 'approve'], ['E', 'edit'], ['S', 'reschedule'], ['X', 'select'],
  ['Esc', 'clear focus'],
];

export const PostQueue = () => {
  const [posts, setPosts] = useState<QueuePost[]>([]);
  const [unscheduled, setUnscheduled] = useState<QueuePost[]>([]);
  const [emptySlots, setEmptySlots] = useState<EmptySlot[]>([]);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [types, setTypes] = useState<PostType[]>([]);
  const [spacing, setSpacing] = useState(60);
  const [posting, setPosting] = useState<{ enabled: boolean } | null>(null);

  const [view, setView] = useState<View>('timeline');
  const [offsetDays, setOffsetDays] = useState(0);
  const days = 7;
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [focusIdx, setFocusIdx] = useState(-1);
  const [showHelp, setShowHelp] = useState(false);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showGenerate, setShowGenerate] = useState(false);

  const zone = useMemo(() => etZoneAbbrev(), []);
  const from = useMemo(() => new Date(Date.now() + offsetDays * 24 * 3_600_000), [offsetDays]);
  const todayEt = useMemo(() => etDateString(), []);

  // Guards against an in-flight load from a previous filter overwriting a newer one.
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    const params = new URLSearchParams({ from: from.toISOString(), days: String(days) });
    if (typeFilter) params.set('type', typeFilter);
    if (statusFilter) params.set('status', statusFilter);
    if (query.trim()) params.set('q', query.trim());

    try {
      const [qRes, pRes] = await Promise.all([apiFetch(`/api/posts?${params}`), apiFetch('/api/posting/status')]);
      if (seq !== loadSeq.current) return;
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
  }, [from, typeFilter, statusFilter, query]);

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

  const filtersOn = Boolean(typeFilter || statusFilter || query.trim());

  /** Posts in display order — the sequence J/K walks. */
  const ordered = useMemo(
    () => [...posts].sort((a, b) => (a.scheduled_at ?? '').localeCompare(b.scheduled_at ?? '')),
    [posts],
  );

  const timeline = useMemo(() => {
    type Entry = { at: string; kind: 'post'; post: QueuePost } | { at: string; kind: 'slot'; slot: EmptySlot };
    const entries: Entry[] = [
      ...posts.map(p => ({ at: p.scheduled_at!, kind: 'post' as const, post: p })),
      // Placeholders are suppressed while a filter is on: an empty S5 slot is not a
      // match for "show me failed posts", and showing it would read as a result.
      ...(filtersOn ? [] : emptySlots.map(s => ({ at: s.at, kind: 'slot' as const, slot: s }))),
    ].sort((a, b) => a.at.localeCompare(b.at));

    const byDay = new Map<string, Entry[]>();
    for (const e of entries) {
      const key = e.kind === 'post' ? (e.post.et_date ?? etDateString(new Date(e.at))) : e.slot.etDate;
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key)!.push(e);
    }
    return [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [posts, emptySlots, filtersOn]);

  const toggleSelect = (id: number) =>
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const bulk = async (action: string, minutes?: number) => {
    const res = await call('/api/posts/bulk', {
      method: 'POST', body: JSON.stringify({ ids: [...selected], action, minutes }),
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
    await call('/api/posts', { method: 'POST', body: JSON.stringify({ typeId, unscheduled: unscheduledOnly, body: '' }) });
  };

  const reschedule = (id: number, mode: string, at?: string) =>
    call(`/api/posts/${id}/reschedule`, { method: 'POST', body: JSON.stringify({ mode, at }) });

  const approve = (id: number) =>
    call(`/api/posts/${id}/approve`, { method: 'POST', body: JSON.stringify({ confirmTime: true }) });

  const promptTime = async (post: QueuePost) => {
    const current = post.scheduled_at ? etInputValue(new Date(post.scheduled_at)) : etInputValue(new Date());
    const next = window.prompt(`New time in Eastern (${zone}) — YYYY-MM-DD HH:mm:`, current);
    if (next) await reschedule(post.id, 'at', next);
  };

  /**
   * Week-view drop: keep the post's clock time, change only its ET date.
   * Recomposed through etToUtc so the result is correct across a DST boundary rather
   * than being the original instant shifted by a whole number of days.
   */
  const moveToDay = async (id: number, etDate: string) => {
    const post = posts.find(p => p.id === id);
    if (!post?.scheduled_at) return;
    const t = etParts(new Date(post.scheduled_at));
    const [y, m, d] = etDate.split('-').map(Number);
    const at = etToUtc(y, m, d, t.hour, t.minute);
    await reschedule(id, 'at', at.toISOString());
  };

  /** Board drop: route each target column to the endpoint that enforces its rules. */
  const transition = async (id: number, target: string) => {
    if (target === 'approved') return approve(id);
    if (target === 'needs_review') return call(`/api/posts/${id}/unapprove`, { method: 'POST' });
    if (target === 'skipped') return call(`/api/posts/${id}/skip`, { method: 'POST' });
  };

  // ── Keyboard shortcuts ──
  // Ignored while typing: a search box that eats "A" as "approve" is worse than no
  // shortcuts at all.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (!ordered.length && !['Escape', '?'].includes(e.key)) return;

      const focused = focusIdx >= 0 ? ordered[focusIdx] : null;

      switch (e.key) {
        case 'j': case 'ArrowDown':
          e.preventDefault(); setFocusIdx(i => Math.min(ordered.length - 1, i + 1)); break;
        case 'k': case 'ArrowUp':
          e.preventDefault(); setFocusIdx(i => Math.max(0, i - 1)); break;
        case 'a':
          if (focused && focused.status !== 'approved' && focused.body?.trim()) { e.preventDefault(); void approve(focused.id); }
          break;
        case 's':
          if (focused) { e.preventDefault(); void promptTime(focused); }
          break;
        case 'x':
          if (focused) { e.preventDefault(); toggleSelect(focused.id); }
          break;
        case 'e': case 'Enter': {
          if (!focused) break;
          e.preventDefault();
          // The detail panel is Phase C; until then Enter/E opens the inline editor.
          const node = document.querySelector<HTMLElement>(`[data-post-id="${focused.id}"] button`);
          const editBtn = Array.from(document.querySelectorAll<HTMLButtonElement>(`[data-post-id="${focused.id}"] button`))
            .find(b => b.textContent?.trim() === 'Edit');
          (editBtn ?? node)?.click();
          break;
        }
        case 'Escape':
          setFocusIdx(-1); setSelected(new Set()); setShowHelp(false); break;
        case '?':
          setShowHelp(v => !v); break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ordered, focusIdx]);

  // Keep the focused card in view as J/K walks past the fold.
  useEffect(() => {
    if (focusIdx < 0 || !ordered[focusIdx]) return;
    document.querySelector(`[data-post-id="${ordered[focusIdx].id}"]`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [focusIdx, ordered]);

  if (loading) {
    return <div className="flex items-center justify-center py-32"><Loader2 className="animate-spin text-btc-orange" size={24} /></div>;
  }

  const typeCounts = new Map<string, number>();
  for (const p of posts) if (p.type_code) typeCounts.set(p.type_code, (typeCounts.get(p.type_code) ?? 0) + 1);

  const actionsFor = (p: QueuePost) => ({
    onSelect: () => toggleSelect(p.id),
    onApprove: () => approve(p.id),
    onUnapprove: () => call(`/api/posts/${p.id}/unapprove`, { method: 'POST' }),
    onTime: () => promptTime(p),
    onNextOpen: () => reschedule(p.id, 'nextOpen'),
    onSkip: () => call(`/api/posts/${p.id}/skip`, { method: 'POST' }),
    onDuplicate: () => call(`/api/posts/${p.id}/duplicate`, { method: 'POST' }),
    onDelete: () => call(`/api/posts/${p.id}`, { method: 'DELETE' }),
    onEdit: (body: string) => call(`/api/posts/${p.id}`, { method: 'PUT', body: JSON.stringify({ body }) }),
  });

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-4">
      <BackButton />

      {/* ── Top bar ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className={labelCls}>Post Queue</p>
          <h1 className="text-3xl font-serif italic text-white mt-1">The Queue.</h1>
          <p className="text-xs text-gray-500 mt-1.5">
            Grouped by {zone} day. Phoenix time shown underneath — the gap between them changes twice a year.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setShowHelp(v => !v)} title="Keyboard shortcuts (?)"
                  className="p-2 text-gray-500 hover:text-btc-orange"><Keyboard size={14} /></button>
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

      {/* ── Controls ── */}
      <div className="flex items-center gap-2 flex-wrap border border-btc-orange/15 p-2">
        <div className="flex border border-btc-orange/20">
          {(['timeline', 'week', 'board'] as View[]).map(v => (
            <button key={v} onClick={() => setView(v)}
                    className={cn('px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider transition-colors',
                      view === v ? 'bg-btc-orange/15 text-btc-orange' : 'text-gray-500 hover:text-btc-orange')}>
              {v}
            </button>
          ))}
        </div>

        <div className="flex items-center">
          <button onClick={() => setOffsetDays(d => d - 7)} className="p-1.5 text-gray-500 hover:text-btc-orange"><ChevronLeft size={14} /></button>
          <button onClick={() => setOffsetDays(0)}
                  className={cn('px-2 py-1 text-[10px] font-mono uppercase tracking-wider',
                    offsetDays === 0 ? 'text-btc-orange' : 'text-gray-500 hover:text-btc-orange')}>Today</button>
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

      {showHelp && (
        <div className="flex flex-wrap gap-x-5 gap-y-1 px-3 py-2 border border-btc-orange/25 bg-btc-orange/5">
          {SHORTCUTS.map(([k, v]) => (
            <span key={k} className="text-[10px] font-mono text-gray-400">
              <span className="text-btc-orange">{k}</span> {v}
            </span>
          ))}
        </div>
      )}

      {error && (
        <div className="flex items-start justify-between gap-3 px-3 py-2 border border-red-500/30 bg-red-500/5">
          <p className="text-xs text-red-400">{error}</p>
          <button onClick={() => setError(null)} className="text-red-400/50 hover:text-red-400"><XIcon size={13} /></button>
        </div>
      )}

      {selected.size > 0 && (
        <div className="flex items-center gap-2 flex-wrap px-3 py-2 border border-btc-orange/30 bg-btc-orange/5 sticky top-2 z-30">
          <span className="text-[11px] font-mono text-btc-orange">{selected.size} selected</span>
          <button disabled={busy} onClick={() => bulk('approve')} className={cn(btn, 'text-green-400 border-green-400/30 hover:bg-green-400/10')}>
            <Check size={11} /> Approve
          </button>
          <button disabled={busy} onClick={() => bulk('unapprove')} className={cn(btn, 'text-amber-400 border-amber-400/30 hover:bg-amber-400/10')}>Unapprove</button>
          <button disabled={busy} onClick={() => bulk('shift', -15)} className={cn(btn, 'text-gray-300 border-btc-orange/20 hover:bg-btc-orange/10')}>−15 min</button>
          <button disabled={busy} onClick={() => bulk('shift', 15)} className={cn(btn, 'text-gray-300 border-btc-orange/20 hover:bg-btc-orange/10')}>+15 min</button>
          <button disabled={busy} onClick={() => bulk('skip')} className={cn(btn, 'text-gray-400 border-gray-500/30 hover:bg-gray-500/10')}>
            <SkipForward size={11} /> Skip
          </button>
          <button onClick={() => setSelected(new Set())} className="ml-auto text-[10px] font-mono uppercase text-gray-500 hover:text-white">Clear</button>
        </div>
      )}

      {view === 'timeline' ? (
        <div className="flex gap-4 items-start">
          <aside className="w-48 shrink-0 space-y-3">
            <div className="border border-btc-orange/15">
              <p className={cn(labelCls, 'px-2.5 py-2 border-b border-btc-orange/15 flex items-center gap-1.5')}>
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
                            className={cn(btn, 'text-gray-400 border-btc-orange/15 hover:bg-btc-orange/10')}>Time</button>
                  </div>
                </div>
              ))}
            </div>

            <div className="border border-btc-orange/15">
              <p className={cn(labelCls, 'px-2.5 py-2 border-b border-btc-orange/15')}>Types · next {days}d</p>
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
                  <p className="text-[10px] font-mono uppercase tracking-widest text-btc-orange/60">{dayHeading(etDate, todayEt)}</p>
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
                    focused={ordered[focusIdx]?.id === entry.post.id}
                    busy={busy}
                    actions={actionsFor(entry.post)}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : view === 'week' ? (
        <PostQueueWeek
          posts={posts}
          emptySlots={filtersOn ? [] : emptySlots}
          from={from}
          conflictIds={conflictIds}
          busy={busy}
          onMove={moveToDay}
          onGenerate={generate}
          onOpen={id => { setView('timeline'); setFocusIdx(ordered.findIndex(p => p.id === id)); }}
        />
      ) : (
        <PostQueueBoard
          posts={posts}
          conflictIds={conflictIds}
          onTransition={transition}
          onOpen={id => { setView('timeline'); setFocusIdx(ordered.findIndex(p => p.id === id)); }}
        />
      )}
    </div>
  );
};
