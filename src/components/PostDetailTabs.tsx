/**
 * Phase D tabs — Media, Sources, Thread and History.
 *
 * Split out of PostDetail.tsx to keep each file readable; the panel owns the tab
 * strip and these own the panes.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Loader2, Plus, Trash2, Check, Upload, ExternalLink, RotateCcw, Image as ImageIcon,
  AlertTriangle, CornerDownRight,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { cn } from '../lib/utils';
import { etDisplayTime, parseSqliteUtc } from '../services/time';
import { labelCls, btn, STATUS_STYLE, STATUS_LABEL } from './queueShared';

const input =
  'w-full bg-[#111] border border-btc-orange/20 px-2 py-1.5 text-xs text-gray-200 ' +
  'focus:outline-none focus:border-btc-orange/60';

function useResource<T>(url: string, key: string, deps: unknown[] = []) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    try {
      const res = await apiFetch(url);
      const d = await res.json();
      setData(d[key] ?? []);
    } catch { /* leave as-is */ } finally { setLoading(false); }
  }, [url, key]);
  useEffect(() => { void load(); }, [load, ...deps]);
  return { data, loading, reload: load };
}

// ─── Media ─────────────────────────────────────────────────────────────────────

export function MediaTab({ postId, disabled, onChanged }: { postId: number; disabled: boolean; onChanged: () => void }) {
  const { data: media, loading, reload } = useResource<any>(`/api/posts/${postId}/media`, 'media');
  const [alt, setAlt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const current = media[0] ?? null;
  useEffect(() => { setAlt(current?.alt_text ?? ''); }, [current?.id]);

  const upload = async (file: File) => {
    setError(null);
    if (!alt.trim()) { setError('Add alt text before uploading — X requires it for screen readers.'); return; }
    setBusy(true);
    try {
      // Read as a base64 data URL: the API takes JSON, which avoids a multipart parser.
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(r.error);
        r.readAsDataURL(file);
      });
      const res = await apiFetch(`/api/posts/${postId}/media`, {
        method: 'POST', body: JSON.stringify({ dataUrl, altText: alt }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d.error || 'Upload failed.'); return; }
      await reload(); onChanged();
    } finally { setBusy(false); }
  };

  const saveAlt = async () => {
    if (!current) return;
    const res = await apiFetch(`/api/posts/${postId}/media/${current.id}`, {
      method: 'PUT', body: JSON.stringify({ altText: alt }),
    });
    if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error || 'Could not save alt text.'); return; }
    await reload();
  };

  const remove = async () => {
    if (!current) return;
    await apiFetch(`/api/posts/${postId}/media/${current.id}`, { method: 'DELETE' });
    await reload(); onChanged();
  };

  if (loading) return <Spinner />;

  return (
    <div className="space-y-3">
      {error && <ErrorBar msg={error} onClose={() => setError(null)} />}

      {current ? (
        <div className="space-y-2">
          <img src={`/api/media/${current.id}/file`} alt={current.alt_text ?? ''}
               className="w-full border border-btc-orange/20 rounded" />
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono text-gray-600">{current.file_path}</span>
            <button disabled={disabled || busy} onClick={remove}
                    className="p-1 text-red-500/50 hover:text-red-500"><Trash2 size={12} /></button>
          </div>
        </div>
      ) : (
        <div className="border border-dashed border-btc-orange/20 py-8 text-center">
          <ImageIcon className="mx-auto text-btc-orange opacity-20 mb-2" size={28} />
          <p className="text-[11px] text-gray-500">No image yet</p>
        </div>
      )}

      <div>
        <p className={labelCls}>Alt text <span className="text-red-400">*</span></p>
        <textarea rows={2} value={alt} disabled={disabled}
                  onChange={e => setAlt(e.target.value)} onBlur={current ? saveAlt : undefined}
                  placeholder="Describe the chart or map for a screen reader"
                  className={cn(input, 'mt-1 resize-y')} />
        <p className="text-[9px] text-gray-600 mt-1">
          Required. A chart with no description is unreadable to anyone using a screen reader.
        </p>
      </div>

      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden"
             onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
      <button disabled={disabled || busy} onClick={() => fileRef.current?.click()}
              className={cn(btn, 'text-btc-orange border-btc-orange/30 hover:bg-btc-orange/10')}>
        {busy ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
        {current ? 'Replace image' : 'Upload image'}
      </button>

      <p className="text-[10px] text-gray-600 border border-btc-orange/10 px-2 py-1.5">
        PNG, JPEG, WebP or GIF up to 5MB. Uploaded to X with the post. Rendering the four
        brand card types automatically is a separate piece of work — this is the manual path.
      </p>
    </div>
  );
}

// ─── Sources ───────────────────────────────────────────────────────────────────

export function SourcesTab({ postId, disabled, onChanged }: { postId: number; disabled: boolean; onChanged: () => void }) {
  const { data: sources, loading, reload } = useResource<any>(`/api/posts/${postId}/sources`, 'sources');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    setError(null);
    const res = await apiFetch(`/api/posts/${postId}/sources`, {
      method: 'POST', body: JSON.stringify({ name, url }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { setError(d.error || 'Could not add that source.'); return; }
    setName(''); setUrl('');
    await reload(); onChanged();   // reload the post: the rule check depends on this
  };

  const toggle = async (s: any) => {
    await apiFetch(`/api/posts/${postId}/sources/${s.id}`, {
      method: 'PUT', body: JSON.stringify({ confirmed: !s.confirmed }),
    });
    await reload();
  };

  const remove = async (s: any) => {
    await apiFetch(`/api/posts/${postId}/sources/${s.id}`, { method: 'DELETE' });
    await reload(); onChanged();
  };

  if (loading) return <Spinner />;

  return (
    <div className="space-y-3">
      {error && <ErrorBar msg={error} onClose={() => setError(null)} />}

      {sources.length === 0 ? (
        <p className="text-[11px] text-gray-500 border border-dashed border-btc-orange/20 px-2 py-4 text-center">
          No sources attached
        </p>
      ) : (
        <ul className="space-y-1.5">
          {sources.map(s => (
            <li key={s.id} className="flex items-start gap-2 border border-btc-orange/15 px-2 py-1.5">
              <button disabled={disabled} onClick={() => toggle(s)} title={s.confirmed ? 'Confirmed' : 'Mark confirmed'}
                      className={cn('shrink-0 mt-0.5 w-3.5 h-3.5 border flex items-center justify-center',
                        s.confirmed ? 'border-green-400 bg-green-400/15 text-green-400' : 'border-gray-600 text-transparent')}>
                <Check size={9} />
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] text-gray-300 truncate">{s.name}</p>
                {s.url && (
                  <a href={s.url} target="_blank" rel="noreferrer"
                     className="flex items-center gap-1 text-[10px] text-sky-500 hover:underline truncate">
                    <ExternalLink size={9} className="shrink-0" />{s.url}
                  </a>
                )}
                {s.pulled_at && (
                  <p className="text-[9px] font-mono text-gray-600">
                    pulled {new Date(s.pulled_at).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} ET
                  </p>
                )}
              </div>
              <button disabled={disabled} onClick={() => remove(s)}
                      className="shrink-0 p-1 text-red-500/40 hover:text-red-500"><Trash2 size={11} /></button>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-1.5 border-t border-btc-orange/10 pt-2">
        <input className={input} placeholder="Source name (e.g. Lloyd's List)" value={name}
               disabled={disabled} onChange={e => setName(e.target.value)} />
        <input className={input} placeholder="https://…" value={url}
               disabled={disabled} onChange={e => setUrl(e.target.value)} />
        <button disabled={disabled || (!name.trim() && !url.trim())} onClick={add}
                className={cn(btn, 'text-btc-orange border-btc-orange/30 hover:bg-btc-orange/10')}>
          <Plus size={11} /> Add source
        </button>
      </div>

      <p className="text-[10px] text-amber-400/80 border border-amber-400/20 bg-amber-400/5 px-2 py-1.5">
        Now that sources can be attached, a post containing a figure with no source is a
        blocking error on any type with "source required" — it was only a warning before.
      </p>
    </div>
  );
}

// ─── Thread ────────────────────────────────────────────────────────────────────

export function ThreadTab({
  postId, isReply, disabled, onChanged,
}: { postId: number; isReply: boolean; disabled: boolean; onChanged: () => void }) {
  const { data: children, loading, reload } = useResource<any>(`/api/posts/${postId}/thread`, 'children');
  const [body, setBody] = useState('');
  const [offset, setOffset] = useState(60);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    setError(null);
    const res = await apiFetch(`/api/posts/${postId}/thread`, {
      method: 'POST', body: JSON.stringify({ body, offsetMinutes: offset }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { setError(d.error || 'Could not add that follow-up.'); return; }
    setBody('');
    await reload(); onChanged();
  };

  if (loading) return <Spinner />;

  if (isReply) {
    return (
      <p className="text-[11px] text-gray-500 border border-btc-orange/15 px-2 py-3">
        This post is itself a reply. Threads are one level deep — the publisher resolves a
        single parent id, not a chain.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {error && <ErrorBar msg={error} onClose={() => setError(null)} />}

      {children.length === 0 ? (
        <p className="text-[11px] text-gray-500 border border-dashed border-btc-orange/20 px-2 py-4 text-center">
          No follow-ups
        </p>
      ) : (
        <ul className="space-y-1.5">
          {children.map(c => (
            <li key={c.id} className="flex items-start gap-2 border border-btc-orange/15 px-2 py-1.5">
              <CornerDownRight size={12} className="text-btc-orange/40 shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] font-mono text-btc-orange/70">{c.type_code ?? '—'}</span>
                  <span className={cn('text-[8px] font-mono uppercase px-1 border rounded-sm', STATUS_STYLE[c.status])}>
                    {STATUS_LABEL[c.status] ?? c.status}
                  </span>
                  <span className="text-[9px] font-mono text-gray-600">+{c.offset_minutes ?? 0} min</span>
                  {c.scheduled_at && <span className="text-[9px] font-mono text-gray-500">{etDisplayTime(new Date(c.scheduled_at))}</span>}
                </div>
                <p className="text-[11px] text-gray-400 line-clamp-2">
                  {c.body || <em className="text-gray-600">empty</em>}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-1.5 border-t border-btc-orange/10 pt-2">
        <textarea rows={3} className={cn(input, 'resize-y')} value={body} disabled={disabled}
                  onChange={e => setBody(e.target.value)}
                  placeholder="Follow-up text — e.g. the Substack link, which keeps it out of the main post" />
        <div className="flex items-center gap-2">
          <label className="text-[10px] font-mono text-gray-500">+</label>
          <input type="number" min={0} className={cn(input, 'w-20')} value={offset}
                 disabled={disabled} onChange={e => setOffset(Number(e.target.value))} />
          <span className="text-[10px] font-mono text-gray-500">min after the parent</span>
          <button disabled={disabled} onClick={add}
                  className={cn(btn, 'ml-auto text-btc-orange border-btc-orange/30 hover:bg-btc-orange/10')}>
            <Plus size={11} /> Add
          </button>
        </div>
      </div>

      <p className="text-[10px] text-gray-600 border border-btc-orange/10 px-2 py-1.5">
        A follow-up publishes as a reply to the parent and will not go out before it. Moving
        the parent moves its follow-ups by the same offset.
      </p>
    </div>
  );
}

// ─── History ───────────────────────────────────────────────────────────────────

export function HistoryTab({
  postId, currentBody, disabled, onChanged,
}: { postId: number; currentBody: string; disabled: boolean; onChanged: () => void }) {
  const { data: versions, loading, reload } = useResource<any>(`/api/posts/${postId}/versions`, 'versions', [currentBody]);
  const [compare, setCompare] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const restore = async (v: any) => {
    setError(null);
    const res = await apiFetch(`/api/posts/${postId}/versions/${v.id}/restore`, { method: 'POST' });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { setError(d.error || 'Could not restore.'); return; }
    await reload(); onChanged();
  };

  if (loading) return <Spinner />;

  const selected = versions.find(v => v.id === compare) ?? null;

  return (
    <div className="space-y-3">
      {error && <ErrorBar msg={error} onClose={() => setError(null)} />}

      {versions.length === 0 ? (
        <p className="text-[11px] text-gray-500 border border-dashed border-btc-orange/20 px-2 py-4 text-center">
          No history yet — it records from the first edit.
        </p>
      ) : (
        <ul className="space-y-1">
          {versions.map((v, i) => {
            const isCurrent = v.body === currentBody && i === 0;
            return (
              <li key={v.id}
                  className={cn('border px-2 py-1.5 space-y-1 cursor-pointer transition-colors',
                    compare === v.id ? 'border-btc-orange/50 bg-btc-orange/5' : 'border-btc-orange/15 hover:border-btc-orange/30')}
                  onClick={() => setCompare(compare === v.id ? null : v.id)}>
                <div className="flex items-center gap-2">
                  <span className="text-[9px] font-mono text-btc-orange/70">v{v.id}</span>
                  <span className="text-[9px] font-mono text-gray-500">{v.reason}</span>
                  {isCurrent && <span className="text-[8px] font-mono uppercase text-green-400">current</span>}
                  <span className="text-[9px] font-mono text-gray-600 ml-auto">
                    {new Date(parseSqliteUtc(v.changed_at)).toLocaleString('en-US',
                      { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} ET
                  </span>
                </div>
                <p className="text-[10px] text-gray-500 line-clamp-2">{v.body || <em>empty</em>}</p>
                {!isCurrent && !disabled && (
                  <button onClick={e => { e.stopPropagation(); void restore(v); }}
                          className={cn(btn, 'text-btc-orange border-btc-orange/25 hover:bg-btc-orange/10')}>
                    <RotateCcw size={10} /> Restore
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {selected && selected.body !== currentBody && (
        <div className="space-y-1.5 border-t border-btc-orange/10 pt-2">
          <p className={labelCls}>Comparing v{selected.id} with current</p>
          <div className="grid grid-cols-2 gap-1.5">
            <div className="border border-btc-orange/15 p-1.5">
              <p className="text-[9px] font-mono uppercase text-gray-600 mb-1">v{selected.id}</p>
              <p className="text-[10px] text-gray-400 whitespace-pre-wrap break-words">{selected.body}</p>
            </div>
            <div className="border border-green-400/20 p-1.5">
              <p className="text-[9px] font-mono uppercase text-green-400/70 mb-1">Current</p>
              <p className="text-[10px] text-gray-300 whitespace-pre-wrap break-words">{currentBody}</p>
            </div>
          </div>
        </div>
      )}

      <p className="text-[10px] text-gray-600 border border-btc-orange/10 px-2 py-1.5">
        A restore is recorded as a version too, so it can itself be undone. Restoring
        returns an approved post to Needs review — the text would otherwise go out unread.
      </p>
    </div>
  );
}

// ─── Shared bits ───────────────────────────────────────────────────────────────

function Spinner() {
  return <div className="flex justify-center py-6"><Loader2 size={16} className="animate-spin text-btc-orange" /></div>;
}

function ErrorBar({ msg, onClose }: { msg: string; onClose: () => void }) {
  return (
    <div className="flex items-start justify-between gap-2 px-2 py-1.5 border border-red-500/30 bg-red-500/5">
      <p className="flex items-start gap-1.5 text-[11px] text-red-400">
        <AlertTriangle size={11} className="shrink-0 mt-px" />{msg}
      </p>
      <button onClick={onClose} className="text-red-400/50 hover:text-red-400 text-xs leading-none">×</button>
    </div>
  );
}
