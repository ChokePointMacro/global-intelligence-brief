/**
 * Tweets — one page, four sections.
 *
 *   Generation → what to write, and the per-type settings that shape it
 *   Drafts     → written, not committed to a slot
 *   Planned    → approved with a confirmed time; exactly what the publisher will send
 *   Archive    → posted, skipped or failed
 *
 * The sections are derived from `posts.status`, not separate tables — a post moves
 * between them by being approved or published, never by being copied. That is why the
 * same card, detail panel and rule check work in all four.
 *
 * This replaces four separate screens (Queue, Schedule, Compose, Post Types). Splitting
 * one workflow across four routes was the original mistake.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader2, Plus, Check, AlertTriangle, Search, X as XIcon, Inbox, Zap, SkipForward,
  Settings, Calendar, Archive as ArchiveIcon, PencilLine, ExternalLink, Clock,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { BackButton } from './BackButton';
import { cn } from '../lib/utils';
import { etZoneAbbrev, etDateString, etInputValue, etDisplayTime, localDisplayTime } from '../services/time';
import { describeDays, type PostType } from '../services/postTypes';
import { PostDetail } from './PostDetail';
import {
  PostCard, dayHeading, labelCls, btn, STATUS_STYLE, STATUS_LABEL,
  type QueuePost, type EmptySlot, type Conflict,
} from './queueShared';

type Section = 'generation' | 'drafts' | 'planned' | 'archive';

const SECTIONS: Array<{ id: Section; label: string; icon: typeof Zap }> = [
  { id: 'generation', label: 'Generation', icon: Zap },
  { id: 'drafts',     label: 'Drafts',     icon: PencilLine },
  { id: 'planned',    label: 'Planned',    icon: Calendar },
  { id: 'archive',    label: 'Archive',    icon: ArchiveIcon },
];

export const Tweets = () => {
  const [section, setSection] = useState<Section>('generation');
  const [drafts, setDrafts] = useState<QueuePost[]>([]);
  const [planned, setPlanned] = useState<QueuePost[]>([]);
  const [archive, setArchive] = useState<QueuePost[]>([]);
  const [emptySlots, setEmptySlots] = useState<EmptySlot[]>([]);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [types, setTypes] = useState<PostType[]>([]);
  const [spacing, setSpacing] = useState(60);
  const [posting, setPosting] = useState<{ enabled: boolean } | null>(null);
  const [source, setSource] = useState<any>({ hasReport: false, total: 0, unused: 0 });

  const [openId, setOpenId] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const zone = useMemo(() => etZoneAbbrev(), []);
  const todayEt = useMemo(() => etDateString(), []);
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    try {
      const [sRes, pRes] = await Promise.all([
        apiFetch('/api/posts/sections?days=14'),
        apiFetch('/api/posting/status'),
      ]);
      if (seq !== loadSeq.current) return;
      const d = await sRes.json();
      setDrafts(d.drafts ?? []);
      setPlanned(d.planned ?? []);
      setArchive(d.archive ?? []);
      setEmptySlots(d.emptySlots ?? []);
      setConflicts(d.conflicts ?? []);
      setTypes(d.types ?? []);
      setSource(d.source ?? { hasReport: false, total: 0, unused: 0 });
      setSpacing(d.settings?.min_spacing_minutes ?? 60);
      setPosting(await pRes.json().catch(() => null));
    } catch {
      if (seq === loadSeq.current) setError('Could not load.');
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const call = async (url: string, options: RequestInit = {}) => {
    setBusy(true); setError(null);
    try {
      const res = await apiFetch(url, options);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || 'That action failed.');
        return null;
      }
      await load();
      return res;
    } finally { setBusy(false); }
  };

  const conflictIds = useMemo(() => {
    const s = new Set<number>();
    for (const c of conflicts) { s.add(c.a); s.add(c.b); }
    return s;
  }, [conflicts]);

  const all = useMemo(() => [...drafts, ...planned, ...archive], [drafts, planned, archive]);
  const openPost = useMemo(() => all.find(p => p.id === openId) ?? null, [all, openId]);

  const filtered = (list: QueuePost[]) =>
    query.trim()
      ? list.filter(p => (p.body ?? '').toLowerCase().includes(query.trim().toLowerCase()))
      : list;

  const toggleSelect = (id: number) =>
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const actionsFor = (p: QueuePost) => ({
    onOpen: () => setOpenId(p.id),
    onSelect: () => toggleSelect(p.id),
    onApprove: () => call(`/api/posts/${p.id}/approve`, { method: 'POST', body: JSON.stringify({ confirmTime: true }) }),
    onUnapprove: () => call(`/api/posts/${p.id}/unapprove`, { method: 'POST' }),
    onTime: async () => {
      const v = window.prompt(`New time in Eastern (${zone}) — YYYY-MM-DD HH:mm:`,
        p.scheduled_at ? etInputValue(new Date(p.scheduled_at)) : etInputValue(new Date()));
      if (v) await call(`/api/posts/${p.id}/reschedule`, { method: 'POST', body: JSON.stringify({ mode: 'at', at: v }) });
    },
    onNextOpen: () => call(`/api/posts/${p.id}/reschedule`, { method: 'POST', body: JSON.stringify({ mode: 'nextOpen' }) }),
    onSkip: () => call(`/api/posts/${p.id}/skip`, { method: 'POST' }),
    onDuplicate: () => call(`/api/posts/${p.id}/duplicate`, { method: 'POST' }),
    onDelete: () => call(`/api/posts/${p.id}`, { method: 'DELETE' }),
    onEdit: (body: string) => call(`/api/posts/${p.id}`, { method: 'PUT', body: JSON.stringify({ body }) }),
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

  if (loading) {
    return <div className="flex items-center justify-center py-32"><Loader2 className="animate-spin text-btc-orange" size={24} /></div>;
  }

  const counts: Record<Section, number> = {
    generation: emptySlots.length, drafts: drafts.length, planned: planned.length, archive: archive.length,
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-4">
      <BackButton />

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className={labelCls}>Tweet Engine</p>
          <h1 className="text-3xl font-serif italic text-white mt-1">Tweets.</h1>
          <p className="text-xs text-gray-500 mt-1.5">
            Generate, review, plan, publish. Times are {zone} with Phoenix underneath.
          </p>
        </div>
        <div className={cn('px-2 py-1 text-[10px] font-mono uppercase tracking-wider border self-start',
          posting?.enabled ? 'text-green-400 border-green-400/30 bg-green-400/5'
                           : 'text-red-400 border-red-400/30 bg-red-400/5')}>
          Posting {posting?.enabled ? 'on' : 'off'}
        </div>
      </div>

      {/* ── Section nav ── */}
      <div className="flex items-center gap-2 flex-wrap border-b border-btc-orange/15">
        {SECTIONS.map(s => {
          const Icon = s.icon;
          return (
            <button key={s.id} onClick={() => { setSection(s.id); setSelected(new Set()); }}
                    className={cn('flex items-center gap-1.5 px-3 py-2 text-[11px] font-mono uppercase tracking-wider transition-colors -mb-px border-b-2',
                      section === s.id ? 'text-btc-orange border-btc-orange' : 'text-gray-500 border-transparent hover:text-btc-orange')}>
              <Icon size={12} /> {s.label}
              {counts[s.id] > 0 && (
                <span className={cn('text-[9px] px-1 rounded-sm',
                  section === s.id ? 'bg-btc-orange/20 text-btc-orange' : 'bg-gray-700/40 text-gray-400')}>
                  {counts[s.id]}
                </span>
              )}
            </button>
          );
        })}
        <div className="ml-auto flex items-center gap-1.5 py-1 min-w-[150px]">
          <Search size={12} className="text-btc-orange/40 shrink-0" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search text…"
                 className="flex-1 bg-transparent text-[11px] text-gray-300 focus:outline-none" />
          {query && <button onClick={() => setQuery('')} className="text-gray-600 hover:text-white"><XIcon size={11} /></button>}
        </div>
      </div>

      {error && (
        <div className="flex items-start justify-between gap-3 px-3 py-2 border border-red-500/30 bg-red-500/5">
          <p className="text-xs text-red-400">{error}</p>
          <button onClick={() => setError(null)} className="text-red-400/50 hover:text-red-400"><XIcon size={13} /></button>
        </div>
      )}

      {selected.size > 0 && section !== 'archive' && (
        <div className="flex items-center gap-2 flex-wrap px-3 py-2 border border-btc-orange/30 bg-btc-orange/5 sticky top-2 z-30">
          <span className="text-[11px] font-mono text-btc-orange">{selected.size} selected</span>
          <button disabled={busy} onClick={() => bulk('approve')} className={cn(btn, 'text-green-400 border-green-400/30 hover:bg-green-400/10')}>
            <Check size={11} /> Approve
          </button>
          <button disabled={busy} onClick={() => bulk('unapprove')} className={cn(btn, 'text-amber-400 border-amber-400/30 hover:bg-amber-400/10')}>Unapprove</button>
          <button disabled={busy} onClick={() => bulk('shift', -15)} className={cn(btn, 'text-gray-300 border-btc-orange/20 hover:bg-btc-orange/10')}>−15m</button>
          <button disabled={busy} onClick={() => bulk('shift', 15)} className={cn(btn, 'text-gray-300 border-btc-orange/20 hover:bg-btc-orange/10')}>+15m</button>
          <button disabled={busy} onClick={() => bulk('skip')} className={cn(btn, 'text-gray-400 border-gray-500/30 hover:bg-gray-500/10')}>
            <SkipForward size={11} /> Skip
          </button>
          <button onClick={() => setSelected(new Set())} className="ml-auto text-[10px] font-mono uppercase text-gray-500 hover:text-white">Clear</button>
        </div>
      )}

      <div className="flex gap-4 items-start">
        <div className="flex-1 min-w-0">
          {section === 'generation' && (
            <GenerationSection
              types={types} emptySlots={emptySlots} busy={busy}
              source={source}
              onGenerate={(typeId, unscheduled) =>
                call('/api/posts', { method: 'POST', body: JSON.stringify({ typeId, unscheduled, body: '', generate: !unscheduled }) })}
              onTypesChanged={load}
            />
          )}

          {section === 'drafts' && (
            <PostList
              posts={filtered(drafts)} emptyLabel="No drafts. Generate some from the Generation tab."
              conflictIds={conflictIds} spacing={spacing} selected={selected} busy={busy}
              todayEt={todayEt} actionsFor={actionsFor} openId={openId}
            />
          )}

          {section === 'planned' && (
            <PostList
              posts={filtered(planned)} emptyLabel="Nothing planned. Approve a draft to schedule it."
              conflictIds={conflictIds} spacing={spacing} selected={selected} busy={busy}
              todayEt={todayEt} actionsFor={actionsFor} openId={openId}
            />
          )}

          {section === 'archive' && <ArchiveSection posts={filtered(archive)} onOpen={setOpenId} />}
        </div>

        {openPost && (
          <PostDetail post={openPost} types={types} onClose={() => setOpenId(null)} onChanged={load} />
        )}
      </div>
    </div>
  );
};

// ─── Generation ────────────────────────────────────────────────────────────────

function GenerationSection({
  types, emptySlots, busy, source, onGenerate, onTypesChanged,
}: {
  types: PostType[];
  emptySlots: EmptySlot[];
  busy: boolean;
  source: { hasReport: boolean; reportType?: string | null; updatedAt?: string | null; total: number; unused: number };
  onGenerate: (typeId: number | null, unscheduled: boolean) => void;
  onTypesChanged: () => void;
}) {
  const [showSettings, setShowSettings] = useState(false);
  const slotsByType = useMemo(() => {
    const m = new Map<number, EmptySlot[]>();
    for (const s of emptySlots) {
      if (!m.has(s.typeId)) m.set(s.typeId, []);
      m.get(s.typeId)!.push(s);
    }
    return m;
  }, [emptySlots]);

  return (
    <div className="space-y-4">
      <SourceBanner source={source} />

      <div className="flex items-center justify-between">
        <p className="text-[11px] text-gray-500">
          Each type is a recurring segment with its own slot, rules and prompt. Generating
          writes a post into the next open slot for that type.
        </p>
        <button onClick={() => setShowSettings(v => !v)}
                className={cn(btn, 'shrink-0 ml-3 text-gray-400 border-btc-orange/20 hover:bg-btc-orange/10')}>
          <Settings size={11} /> {showSettings ? 'Hide' : 'Settings'}
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {types.filter(t => t.active).map(t => {
          const slots = slotsByType.get(t.id) ?? [];
          const next = slots[0];
          return (
            <div key={t.id} className="border border-btc-orange/15 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: t.color }} />
                <span className="text-[9px] font-mono px-1 py-0.5 border border-btc-orange/25 text-btc-orange/80">{t.code}</span>
                <span className="text-xs text-white truncate">{t.name}</span>
              </div>

              <div className="flex items-center gap-3 text-[10px] font-mono text-gray-500">
                <span>{t.default_time_et ?? 'no slot'} {t.default_time_et && 'ET'}</span>
                <span>{describeDays(t.days_of_week)}</span>
                <span>{t.length_mode === 'long' ? 'long' : '280'}</span>
              </div>

              {next ? (
                <p className="text-[10px] font-mono text-gray-400">
                  next open: {etDisplayTime(new Date(next.at))} ET · {localDisplayTime(new Date(next.at))} PHX
                  <span className="text-gray-600"> · {slots.length} open in 14d</span>
                </p>
              ) : (
                <p className="text-[10px] font-mono text-gray-600">no open slots in the next 14 days</p>
              )}

              {t.prompt_template && (
                <p className="text-[10px] text-gray-600 line-clamp-2 italic">{t.prompt_template}</p>
              )}

              <button disabled={busy} onClick={() => onGenerate(t.id, false)}
                      className={cn(btn, 'text-btc-orange border-btc-orange/30 hover:bg-btc-orange/10')}>
                <Plus size={11} /> Generate
              </button>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-2 flex-wrap border-t border-btc-orange/10 pt-3">
        <button disabled={busy} onClick={() => onGenerate(null, true)}
                className={cn(btn, 'text-gray-300 border-btc-orange/20 hover:bg-btc-orange/10')}>
          <Inbox size={11} /> Blank unscheduled draft
        </button>
      </div>

      {showSettings && <TypeSettings types={types} onChanged={onTypesChanged} />}
    </div>
  );
}

/**
 * Tweets are written FROM report headlines — the report generator writes a fold-tuned
 * socialPost for each one as part of the report run. So an empty or stale report is the
 * real blocker, and it belongs at the top of Generation rather than surfacing as a
 * failed click on Generate.
 */
function SourceBanner({ source }: { source: { hasReport: boolean; reportType?: string | null; updatedAt?: string | null; total: number; unused: number } }) {
  if (!source.hasReport) {
    return (
      <div className="border border-red-500/30 bg-red-500/5 px-3 py-2">
        <p className="text-[11px] text-red-400">No intelligence report to draw from.</p>
        <p className="text-[10px] text-red-400/70 mt-1">
          Tweets are written from report headlines. Generate a report on the Reports page first.
        </p>
      </div>
    );
  }
  const stale = source.updatedAt
    ? (Date.now() - new Date(String(source.updatedAt).replace(' ', 'T') + 'Z').getTime()) / 3_600_000 > 36
    : false;
  return (
    <div className={cn('px-3 py-2 border',
      source.unused === 0 ? 'border-amber-400/30 bg-amber-400/5'
      : stale ? 'border-amber-400/25 bg-amber-400/5'
      : 'border-btc-orange/20 bg-btc-orange/5')}>
      <p className="text-[11px] text-gray-300">
        Writing from the latest <strong className="text-btc-orange">{source.reportType}</strong> report —{' '}
        <strong className={source.unused === 0 ? 'text-amber-400' : 'text-white'}>{source.unused}</strong> of {source.total} stories unused.
      </p>
      <p className="text-[10px] text-gray-500 mt-1">
        {source.unused === 0
          ? 'Every story is already spoken for. Generate a fresh report for new material.'
          : stale
            ? 'This report is over a day old — the stories may have moved on.'
            : 'Short slots reuse the post the report already wrote. Long slots synthesise across stories.'}
      </p>
    </div>
  );
}

/** Inline per-type settings — the old /post-types screen, folded into Generation. */
function TypeSettings({ types, onChanged }: { types: PostType[]; onChanged: () => void }) {
  const [editing, setEditing] = useState<PostType | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await apiFetch(`/api/post-types/${editing.id}`, { method: 'PUT', body: JSON.stringify(editing) });
      setEditing(null);
      onChanged();
    } finally { setSaving(false); }
  };

  return (
    <div className="border border-btc-orange/20 p-3 space-y-2">
      <p className={labelCls}>Type settings</p>
      <div className="space-y-1">
        {types.map(t => (
          <div key={t.id} className="flex items-center gap-2 py-1 border-b border-btc-orange/10 last:border-0">
            <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: t.color }} />
            <span className="text-[10px] font-mono text-btc-orange/70 w-10">{t.code}</span>
            <span className="text-[11px] text-gray-300 flex-1 truncate">{t.name}</span>
            <span className="text-[10px] font-mono text-gray-500">{t.default_time_et ?? '—'}</span>
            <span className="text-[10px] font-mono text-gray-600">{describeDays(t.days_of_week)}</span>
            <button onClick={() => setEditing(t)}
                    className="text-[10px] font-mono uppercase text-btc-orange/70 hover:text-btc-orange px-2">
              Edit
            </button>
          </div>
        ))}
      </div>

      {editing && (
        <div className="border-t border-btc-orange/15 pt-2 space-y-2">
          <p className="text-[11px] text-white">{editing.code} · {editing.name}</p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className={labelCls}>Slot (ET)</p>
              <input className="w-full bg-[#111] border border-btc-orange/20 px-2 py-1 text-xs text-gray-200"
                     value={editing.default_time_et ?? ''}
                     onChange={e => setEditing({ ...editing, default_time_et: e.target.value || null })} />
            </div>
            <div>
              <p className={labelCls}>Days (0=Sun)</p>
              <input className="w-full bg-[#111] border border-btc-orange/20 px-2 py-1 text-xs text-gray-200"
                     value={editing.days_of_week}
                     onChange={e => setEditing({ ...editing, days_of_week: e.target.value })} />
            </div>
          </div>
          <div>
            <p className={labelCls}>Prompt template</p>
            <textarea rows={3}
                      className="w-full bg-[#111] border border-btc-orange/20 px-2 py-1 text-xs text-gray-200 font-mono resize-y"
                      value={editing.prompt_template}
                      onChange={e => setEditing({ ...editing, prompt_template: e.target.value })} />
          </div>
          <div className="flex gap-1.5">
            <button disabled={saving} onClick={save}
                    className={cn(btn, 'text-btc-orange border-btc-orange/30 hover:bg-btc-orange/10')}>Save</button>
            <button onClick={() => setEditing(null)} className={cn(btn, 'text-gray-400 border-btc-orange/15')}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Drafts / Planned list ─────────────────────────────────────────────────────

function PostList({
  posts, emptyLabel, conflictIds, spacing, selected, busy, todayEt, actionsFor, openId,
}: {
  posts: QueuePost[]; emptyLabel: string; conflictIds: Set<number>; spacing: number;
  selected: Set<number>; busy: boolean; todayEt: string; openId: number | null;
  actionsFor: (p: QueuePost) => any;
}) {
  const grouped = useMemo(() => {
    const unscheduled = posts.filter(p => !p.scheduled_at);
    const byDay = new Map<string, QueuePost[]>();
    for (const p of posts) {
      if (!p.scheduled_at) continue;
      const k = p.et_date ?? etDateString(new Date(p.scheduled_at));
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k)!.push(p);
    }
    return { unscheduled, days: [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])) };
  }, [posts]);

  if (!posts.length) {
    return (
      <div className="py-16 text-center border-2 border-dashed border-btc-orange/10">
        <p className="text-xs font-mono uppercase tracking-widest text-btc-orange/30">{emptyLabel}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {grouped.unscheduled.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-3">
            <p className="text-[10px] font-mono uppercase tracking-widest text-btc-orange/60">No time set</p>
            <div className="flex-1 h-px bg-btc-orange/10" />
          </div>
          {grouped.unscheduled.map(p => (
            <PostCard key={p.id} post={p} conflicted={false} spacing={spacing}
                      selected={selected.has(p.id)} focused={openId === p.id}
                      busy={busy} actions={actionsFor(p)} />
          ))}
        </div>
      )}

      {grouped.days.map(([etDate, list]) => (
        <div key={etDate} className="space-y-1.5">
          <div className="flex items-center gap-3">
            <p className="text-[10px] font-mono uppercase tracking-widest text-btc-orange/60">{dayHeading(etDate, todayEt)}</p>
            <div className="flex-1 h-px bg-btc-orange/10" />
            <span className="text-[9px] font-mono text-gray-600">{list.length}</span>
          </div>
          {list.map(p => (
            <PostCard key={p.id} post={p} conflicted={conflictIds.has(p.id)} spacing={spacing}
                      selected={selected.has(p.id)} focused={openId === p.id}
                      busy={busy} actions={actionsFor(p)} />
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── Archive ───────────────────────────────────────────────────────────────────

function ArchiveSection({ posts, onOpen }: { posts: QueuePost[]; onOpen: (id: number) => void }) {
  if (!posts.length) {
    return (
      <div className="py-16 text-center border-2 border-dashed border-btc-orange/10">
        <p className="text-xs font-mono uppercase tracking-widest text-btc-orange/30">Nothing archived yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {posts.map(p => {
        const when = p.posted_at ?? p.scheduled_at;
        return (
          <div key={p.id} onClick={() => onOpen(p.id)}
               className="flex items-start gap-3 p-2.5 border border-btc-orange/10 hover:border-btc-orange/25 cursor-pointer transition-colors">
            <div className="shrink-0 w-20 text-center pt-0.5">
              <p className="text-[10px] font-mono text-gray-400">
                {when ? new Date(when).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' }) : '—'}
              </p>
              <p className="text-[9px] font-mono text-gray-600">{when ? etDisplayTime(new Date(when)) : ''}</p>
            </div>
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                {p.type_color && <span className="w-2 h-2 rounded-sm" style={{ background: p.type_color }} />}
                <span className="text-[9px] font-mono text-btc-orange/70">{p.type_code ?? '—'}</span>
                <span className={cn('text-[8px] font-mono uppercase px-1.5 py-0.5 border rounded-sm', STATUS_STYLE[p.status])}>
                  {STATUS_LABEL[p.status] ?? p.status}
                </span>
                {p.x_post_id && (
                  <a href={`https://x.com/ChokepointMacro/status/${p.x_post_id}`} target="_blank" rel="noreferrer"
                     onClick={e => e.stopPropagation()}
                     className="flex items-center gap-1 text-[9px] font-mono text-sky-500 hover:underline">
                    <ExternalLink size={9} /> view on X
                  </a>
                )}
              </div>
              <p className="text-[11px] text-gray-500 line-clamp-2">{p.body || <em className="text-gray-700">empty</em>}</p>
              {p.error && <p className="text-[9px] text-red-400/70">{p.error}</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
