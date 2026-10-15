/**
 * Post Types settings screen — Phase A of the Post Queue.
 *
 * Every recurring segment (S1 Morning Brief, S3 Close Analysis, …) is a row of settings
 * Mike edits here rather than a branch in the generator. Changing a slot time or a
 * cashtag limit is a data change, not a code change.
 *
 * Per the build plan: changing a slot only affects posts generated afterward. Posts
 * already in the queue keep their times.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Loader2, Plus, Copy, Trash2, Save, X as XIcon, Pause, Play, ChevronUp, ChevronDown, Clock,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { BackButton } from './BackButton';
import { cn } from '../lib/utils';
import { CARD_TYPES, describeDays, validatePostType, type PostType } from '../services/postTypes';
import { etZoneAbbrev } from '../services/time';

type Row = PostType & { queued_next_7d?: number };

const DAYS = [
  { n: 0, label: 'S' }, { n: 1, label: 'M' }, { n: 2, label: 'T' }, { n: 3, label: 'W' },
  { n: 4, label: 'T' }, { n: 5, label: 'F' }, { n: 6, label: 'S' },
];

const BLANK: Partial<PostType> = {
  name: '', code: '', color: '#f7931a', default_time_et: '', days_of_week: '1,2,3,4,5',
  max_per_day: 1, prompt_template: '', card_type: 'none', cashtag_min: 0, cashtag_max: 0,
  hashtag_max: 1, length_mode: 'short', source_required: 1, staleness_hours: null,
  active: 1, sort_order: 0,
};

const label = 'text-[10px] font-mono uppercase tracking-widest text-btc-orange/50';
const input =
  'w-full bg-[#0a0a0a] border border-btc-orange/20 px-2.5 py-1.5 text-xs text-white ' +
  'focus:border-btc-orange/60 focus:outline-none transition-colors';

export const PostTypes = () => {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<PostType> | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const zone = useMemo(() => etZoneAbbrev(), []);

  const load = async () => {
    try {
      const res = await apiFetch('/api/post-types?includeInactive=true');
      const data = await res.json();
      setRows(data.types ?? []);
    } catch {
      setError('Could not load post types.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  // Validate with the same function the server uses, so the screen can never submit
  // something the API will reject.
  const validation = useMemo(
    () => (editing ? validatePostType(editing) : { ok: true, errors: [] }),
    [editing],
  );

  const save = async () => {
    if (!editing || !validation.ok) return;
    setSaving(true);
    setError(null);
    try {
      const isNew = editing.id == null;
      const res = await apiFetch(
        isNew ? '/api/post-types' : `/api/post-types/${editing.id}`,
        { method: isNew ? 'POST' : 'PUT', body: JSON.stringify(editing) },
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.errors?.join(' ') || data.error || 'Save failed.');
        return;
      }
      setEditing(null);
      await load();
    } catch {
      setError('Save failed.');
    } finally {
      setSaving(false);
    }
  };

  const act = async (url: string, method = 'POST') => {
    setError(null);
    const res = await apiFetch(url, { method });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error || 'Action failed.');
      return false;
    }
    await load();
    return true;
  };

  const togglePaused = async (t: Row) => {
    setError(null);
    const res = await apiFetch(`/api/post-types/${t.id}`, {
      method: 'PUT',
      body: JSON.stringify({ active: t.active ? 0 : 1 }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.errors?.join(' ') || d.error || 'Could not change that type.');
      return;
    }
    await load();
  };

  const move = async (idx: number, dir: -1 | 1) => {
    const next = [...rows];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    setRows(next); // optimistic; the server renumbers sort_order
    await apiFetch('/api/post-types/reorder', {
      method: 'PUT',
      body: JSON.stringify({ order: next.map(r => r.id) }),
    });
  };

  const toggleDay = (n: number) => {
    if (!editing) return;
    const set = new Set(
      String(editing.days_of_week ?? '').split(',').map(d => d.trim()).filter(Boolean),
    );
    const key = String(n);
    set.has(key) ? set.delete(key) : set.add(key);
    setEditing({
      ...editing,
      days_of_week: [...set].sort((a, b) => Number(a) - Number(b)).join(','),
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="animate-spin text-btc-orange" size={24} />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-5">
      <BackButton />

      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className={label}>Post Queue · Settings</p>
          <h1 className="text-3xl font-serif italic text-white mt-1">Post Types.</h1>
          <p className="text-xs text-gray-500 mt-1.5 max-w-xl">
            The recurring segments the queue generates into. Slot times are {zone} (Eastern) and
            follow daylight saving automatically. Changing a slot only affects posts generated
            afterward — queued posts keep their times.
          </p>
        </div>
        <button
          onClick={() => setEditing({ ...BLANK })}
          className="flex items-center gap-2 px-3 py-2 text-[11px] font-mono uppercase tracking-widest
                     text-btc-orange border border-btc-orange/30 hover:bg-btc-orange/10 transition-colors"
        >
          <Plus size={13} /> New type
        </button>
      </div>

      {error && (
        <div className="px-3 py-2 border border-red-500/30 bg-red-500/5 text-xs text-red-400">{error}</div>
      )}

      {/* ── Table ── */}
      <div className="border border-btc-orange/15">
        <div className="grid grid-cols-[28px_1fr_70px_110px_90px_70px_60px_120px] gap-2 px-3 py-2
                        border-b border-btc-orange/15 bg-[#0a0a0a]">
          {['', 'Type', 'Slot', 'Days', 'Length', 'Tags', 'Queue', ''].map((h, i) => (
            <span key={i} className={label}>{h}</span>
          ))}
        </div>

        {rows.map((t, i) => (
          <div
            key={t.id}
            className={cn(
              'grid grid-cols-[28px_1fr_70px_110px_90px_70px_60px_120px] gap-2 px-3 py-2.5 items-center',
              'border-b border-btc-orange/10 hover:bg-btc-orange/[0.03] transition-colors',
              !t.active && 'opacity-40',
            )}
          >
            <div className="flex flex-col -my-1">
              <button onClick={() => move(i, -1)} disabled={i === 0}
                      className="text-gray-600 hover:text-btc-orange disabled:opacity-20 leading-none">
                <ChevronUp size={12} />
              </button>
              <button onClick={() => move(i, 1)} disabled={i === rows.length - 1}
                      className="text-gray-600 hover:text-btc-orange disabled:opacity-20 leading-none">
                <ChevronDown size={12} />
              </button>
            </div>

            <div className="min-w-0 flex items-center gap-2">
              <span className="shrink-0 w-2.5 h-2.5 rounded-sm" style={{ background: t.color }} />
              <span className="shrink-0 text-[9px] font-mono px-1 py-0.5 border border-btc-orange/25 text-btc-orange/80">
                {t.code}
              </span>
              <span className="text-xs text-white truncate">{t.name}</span>
              {!t.active && <span className="text-[9px] font-mono uppercase text-gray-500">paused</span>}
            </div>

            <span className="text-[11px] font-mono text-gray-300">
              {t.default_time_et || <span className="text-gray-600">—</span>}
            </span>
            <span className="text-[11px] font-mono text-gray-400">{describeDays(t.days_of_week)}</span>
            <span className="text-[11px] font-mono text-gray-400">
              {t.length_mode === 'long' ? 'Long' : '280'}
            </span>
            <span className="text-[11px] font-mono text-gray-400">
              {t.cashtag_max > 0 ? `$${t.cashtag_min}–${t.cashtag_max}` : <span className="text-gray-600">none</span>}
              {t.hashtag_max > 0 && <span className="text-gray-600"> #{t.hashtag_max}</span>}
            </span>
            <span className="text-[11px] font-mono text-gray-400">{t.queued_next_7d || 0}</span>

            <div className="flex items-center gap-1 justify-end">
              <button onClick={() => setEditing(t)} title="Edit"
                      className="px-2 py-1 text-[10px] font-mono uppercase text-btc-orange/70 hover:text-btc-orange">
                Edit
              </button>
              <button onClick={() => togglePaused(t)}
                      title={t.active ? 'Pause' : 'Resume'}
                      className="p-1 text-gray-500 hover:text-btc-orange">
                {t.active ? <Pause size={12} /> : <Play size={12} />}
              </button>
              <button onClick={() => act(`/api/post-types/${t.id}/duplicate`)} title="Duplicate"
                      className="p-1 text-gray-500 hover:text-btc-orange">
                <Copy size={12} />
              </button>
              <button onClick={() => act(`/api/post-types/${t.id}`, 'DELETE')} title="Delete"
                      className="p-1 text-red-500/40 hover:text-red-500">
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* ── Slot preview: spot overlaps before they happen ── */}
      <div className="border border-btc-orange/15 p-3">
        <p className={label}>Slot preview · {zone}</p>
        <div className="grid grid-cols-7 gap-1.5 mt-2.5">
          {DAYS.map(d => {
            const inDay = rows
              .filter(t => t.active && t.default_time_et &&
                           String(t.days_of_week).split(',').includes(String(d.n)))
              .sort((a, b) => (a.default_time_et! > b.default_time_et! ? 1 : -1));
            return (
              <div key={d.n} className="space-y-1">
                <p className="text-[9px] font-mono uppercase text-gray-600 text-center">
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.n]}
                </p>
                {inDay.length === 0 && <div className="h-6 border border-dashed border-btc-orange/10" />}
                {inDay.map(t => (
                  <div key={t.id} className="px-1 py-0.5 text-[9px] font-mono truncate border-l-2"
                       style={{ borderColor: t.color, background: `${t.color}10` }}
                       title={`${t.code} ${t.name} · ${t.default_time_et}`}>
                    <span className="text-gray-300">{t.default_time_et}</span>{' '}
                    <span className="text-gray-500">{t.code}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Editor ── */}
      {editing && (
        <div className="fixed inset-0 bg-black/70 flex items-start justify-center overflow-y-auto p-4 z-50"
             onClick={() => !saving && setEditing(null)}>
          <div className="bg-[#0a0a0a] border border-btc-orange/25 w-full max-w-2xl my-8 p-5 space-y-4"
               onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-serif italic text-white">
                {editing.id == null ? 'New post type' : `Edit ${editing.code}`}
              </h2>
              <button onClick={() => setEditing(null)} className="text-gray-500 hover:text-white">
                <XIcon size={16} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 sm:col-span-1">
                <p className={label}>Name</p>
                <input className={input} value={editing.name ?? ''}
                       onChange={e => setEditing({ ...editing, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3 col-span-2 sm:col-span-1">
                <div>
                  <p className={label}>Code</p>
                  <input className={input} maxLength={6} value={editing.code ?? ''}
                         onChange={e => setEditing({ ...editing, code: e.target.value.toUpperCase() })} />
                </div>
                <div>
                  <p className={label}>Colour</p>
                  <input type="color" className="w-full h-[30px] bg-[#0a0a0a] border border-btc-orange/20"
                         value={editing.color ?? '#f7931a'}
                         onChange={e => setEditing({ ...editing, color: e.target.value })} />
                </div>
              </div>

              <div>
                <p className={label}>Default slot ({zone})</p>
                <div className="flex items-center gap-1.5">
                  <Clock size={12} className="text-btc-orange/40 shrink-0" />
                  <input className={input} placeholder="16:20" value={editing.default_time_et ?? ''}
                         onChange={e => setEditing({ ...editing, default_time_et: e.target.value })} />
                </div>
                <p className="text-[9px] text-gray-600 mt-1">Blank = no fixed slot</p>
              </div>
              <div>
                <p className={label}>Max per day</p>
                <input type="number" min={1} className={input}
                       value={editing.max_per_day ?? ''}
                       onChange={e => setEditing({ ...editing, max_per_day: e.target.value === '' ? null : Number(e.target.value) })} />
                <p className="text-[9px] text-gray-600 mt-1">Blank = unlimited</p>
              </div>

              <div className="col-span-2">
                <p className={label}>Days</p>
                <div className="flex gap-1 mt-1">
                  {DAYS.map((d, i) => {
                    const on = String(editing.days_of_week ?? '').split(',').includes(String(d.n));
                    return (
                      <button key={i} onClick={() => toggleDay(d.n)}
                              className={cn('w-8 h-8 text-[11px] font-mono border transition-colors',
                                on ? 'border-btc-orange bg-btc-orange/15 text-btc-orange'
                                   : 'border-btc-orange/15 text-gray-600 hover:border-btc-orange/40')}>
                        {d.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <p className={label}>Length</p>
                <select className={input} value={editing.length_mode ?? 'short'}
                        onChange={e => setEditing({ ...editing, length_mode: e.target.value as any })}>
                  <option value="short">280 characters</option>
                  <option value="long">Long post</option>
                </select>
              </div>
              <div>
                <p className={label}>Card</p>
                <select className={input} value={editing.card_type ?? 'none'}
                        onChange={e => setEditing({ ...editing, card_type: e.target.value as any })}>
                  {CARD_TYPES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-3 gap-2 col-span-2">
                <div>
                  <p className={label}>Cashtag min</p>
                  <input type="number" min={0} className={input} value={editing.cashtag_min ?? 0}
                         onChange={e => setEditing({ ...editing, cashtag_min: Number(e.target.value) })} />
                </div>
                <div>
                  <p className={label}>Cashtag max</p>
                  <input type="number" min={0} className={input} value={editing.cashtag_max ?? 0}
                         onChange={e => setEditing({ ...editing, cashtag_max: Number(e.target.value) })} />
                </div>
                <div>
                  <p className={label}>Hashtag max</p>
                  <input type="number" min={0} max={2} className={input} value={editing.hashtag_max ?? 1}
                         onChange={e => setEditing({ ...editing, hashtag_max: Number(e.target.value) })} />
                </div>
                <p className="col-span-3 text-[9px] text-gray-600 -mt-1">
                  Cashtags ship at 0/0 across every type. Raise them here if you decide to use them.
                </p>
              </div>

              <div>
                <p className={label}>Staleness (hours)</p>
                <input type="number" min={1} className={input} value={editing.staleness_hours ?? ''}
                       onChange={e => setEditing({ ...editing, staleness_hours: e.target.value === '' ? null : Number(e.target.value) })} />
                <p className="text-[9px] text-gray-600 mt-1">Blank = never stale</p>
              </div>
              <div className="flex flex-col justify-end gap-2 pb-1">
                <label className="flex items-center gap-2 text-xs text-gray-300">
                  <input type="checkbox" checked={!!editing.source_required}
                         onChange={e => setEditing({ ...editing, source_required: e.target.checked ? 1 : 0 })} />
                  Source required
                </label>
                <label className="flex items-center gap-2 text-xs text-gray-300">
                  <input type="checkbox" checked={!!editing.active}
                         onChange={e => setEditing({ ...editing, active: e.target.checked ? 1 : 0 })} />
                  Active
                </label>
              </div>

              <div className="col-span-2">
                <p className={label}>Prompt template</p>
                <textarea rows={4} className={cn(input, 'font-mono leading-relaxed resize-y')}
                          value={editing.prompt_template ?? ''}
                          onChange={e => setEditing({ ...editing, prompt_template: e.target.value })} />
              </div>
            </div>

            {!validation.ok && (
              <ul className="text-[11px] text-red-400 space-y-0.5 border border-red-500/25 bg-red-500/5 p-2">
                {validation.errors.map((e, i) => <li key={i}>· {e}</li>)}
              </ul>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setEditing(null)}
                      className="px-3 py-2 text-[11px] font-mono uppercase tracking-widest text-gray-400 hover:text-white">
                Cancel
              </button>
              <button onClick={save} disabled={!validation.ok || saving}
                      className="flex items-center gap-2 px-3 py-2 text-[11px] font-mono uppercase tracking-widest
                                 text-btc-orange border border-btc-orange/30 hover:bg-btc-orange/10
                                 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
