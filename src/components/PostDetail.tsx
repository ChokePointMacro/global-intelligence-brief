/**
 * Detail panel — Phase C.
 *
 * Opens on the right when a post is clicked. Three tabs are in scope for this phase:
 * Content, Schedule and Attributes. Media, Sources, Thread and History are Phase D and
 * appear as disabled tabs rather than being hidden, so the shape of the thing is
 * visible and nobody wonders where they went.
 *
 * The goal is the phase's own bar: edit and approve a post in under a minute without
 * leaving the screen.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  X as XIcon, Check, AlertTriangle, AlertCircle, Clock, Loader2, Zap,
  Sun, Moon, Lock,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { cn } from '../lib/utils';
import { etDisplayTime, localDisplayTime, etZoneAbbrev, etInputValue } from '../services/time';
import { FOLD } from '../services/ruleCheck';
import type { RuleCheckResult, RuleFinding } from '../services/ruleCheck';
import type { PostType } from '../services/postTypes';
import { STATUS_STYLE, STATUS_LABEL, labelCls, btn, type QueuePost } from './queueShared';

type Tab = 'content' | 'schedule' | 'attributes' | 'media' | 'sources' | 'thread' | 'history';

const TABS: Array<{ id: Tab; label: string; phase?: string }> = [
  { id: 'content',    label: 'Content' },
  { id: 'schedule',   label: 'Schedule' },
  { id: 'attributes', label: 'Attributes' },
  { id: 'media',      label: 'Media',   phase: 'D' },
  { id: 'sources',    label: 'Sources', phase: 'D' },
  { id: 'thread',     label: 'Thread',  phase: 'D' },
  { id: 'history',    label: 'History', phase: 'D' },
];

export function PostDetail({
  post, types, onClose, onChanged,
}: {
  post: QueuePost;
  types: PostType[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [tab, setTab] = useState<Tab>('content');
  const [body, setBody] = useState(post.body ?? '');
  const [check, setCheck] = useState<RuleCheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<'dark' | 'light'>('dark');

  const zone = useMemo(() => etZoneAbbrev(), []);
  const type = types.find(t => t.id === post.type_id) ?? null;
  const dirty = body !== (post.body ?? '');
  const locked = post.locked === 1;
  const terminal = ['posted', 'posting'].includes(post.status);

  // Reset when a different post is opened into the same panel.
  useEffect(() => { setBody(post.body ?? ''); setTab('content'); setError(null); }, [post.id]);

  // ── Live rule check, debounced ──
  // Runs against the SERVER's checker rather than a second copy in the browser: two
  // implementations of the same rules will disagree eventually, and the one that
  // matters is the one approval enforces.
  const checkSeq = useRef(0);
  const runCheck = useCallback(async (text: string) => {
    const seq = ++checkSeq.current;
    setChecking(true);
    try {
      const res = await apiFetch('/api/rule-check', {
        method: 'POST', body: JSON.stringify({ body: text, typeId: post.type_id }),
      });
      const d = await res.json();
      if (seq === checkSeq.current) setCheck(d);
    } catch {
      /* a failed check must not block editing */
    } finally {
      if (seq === checkSeq.current) setChecking(false);
    }
  }, [post.type_id]);

  useEffect(() => {
    const t = setTimeout(() => void runCheck(body), 250);
    return () => clearTimeout(t);
  }, [body, runCheck]);

  const call = async (url: string, options: RequestInit = {}) => {
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch(url, options);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d.error || 'That action failed.'); return null; }
      onChanged();
      return d;
    } finally {
      setSaving(false);
    }
  };

  const save = () => call(`/api/posts/${post.id}`, { method: 'PUT', body: JSON.stringify({ body }) });

  const saveAndApprove = async () => {
    if (dirty) {
      const saved = await call(`/api/posts/${post.id}`, { method: 'PUT', body: JSON.stringify({ body }) });
      if (!saved) return;
    }
    await call(`/api/posts/${post.id}/approve`, { method: 'POST', body: JSON.stringify({ confirmTime: true }) });
  };

  const at = post.scheduled_at ? new Date(post.scheduled_at) : null;
  const weighted = check?.weightedLength ?? body.length;
  const isLong = type?.length_mode === 'long';
  const limit = isLong ? 25000 : FOLD;
  const overFold = weighted > FOLD;

  return (
    <aside className="w-[420px] shrink-0 border border-btc-orange/25 bg-[#0a0a0a] sticky top-4 max-h-[calc(100vh-2rem)] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-btc-orange/15">
        <div className="flex items-center gap-1.5 min-w-0">
          {post.type_color && <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: post.type_color }} />}
          <span className="text-[9px] font-mono px-1 py-0.5 border border-btc-orange/25 text-btc-orange/80">{post.type_code ?? '—'}</span>
          <span className={cn('text-[8px] font-mono uppercase px-1.5 py-0.5 border rounded-sm', STATUS_STYLE[post.status])}>
            {STATUS_LABEL[post.status] ?? post.status}
          </span>
          {locked && <Lock size={11} className="text-sky-400 shrink-0" />}
        </div>
        <button onClick={onClose} className="text-gray-500 hover:text-white shrink-0"><XIcon size={15} /></button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-btc-orange/15 overflow-x-auto">
        {TABS.map(t => (
          <button key={t.id} disabled={!!t.phase} onClick={() => setTab(t.id)}
                  title={t.phase ? `Phase ${t.phase}` : undefined}
                  className={cn('px-2.5 py-1.5 text-[10px] font-mono uppercase tracking-wider whitespace-nowrap transition-colors',
                    tab === t.id ? 'text-btc-orange border-b border-btc-orange'
                                 : t.phase ? 'text-gray-700 cursor-not-allowed' : 'text-gray-500 hover:text-btc-orange')}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {error && (
          <div className="flex items-start justify-between gap-2 px-2 py-1.5 border border-red-500/30 bg-red-500/5">
            <p className="text-[11px] text-red-400">{error}</p>
            <button onClick={() => setError(null)} className="text-red-400/50 hover:text-red-400"><XIcon size={12} /></button>
          </div>
        )}

        {/* ── Content ── */}
        {tab === 'content' && (
          <>
            <div>
              <div className="flex items-center justify-between mb-1">
                <p className={labelCls}>Text</p>
                <span className={cn('text-[10px] font-mono',
                  weighted > limit ? 'text-red-400' : overFold && !isLong ? 'text-amber-400' : 'text-gray-500')}>
                  {checking ? '…' : weighted} / {limit}
                  {overFold && isLong && <span className="text-gray-600"> · {weighted - FOLD} past the fold</span>}
                </span>
              </div>
              <textarea
                rows={9}
                value={body}
                disabled={locked || terminal}
                onChange={e => setBody(e.target.value)}
                className="w-full bg-[#111] border border-btc-orange/25 px-2 py-2 text-xs text-gray-200
                           leading-relaxed resize-y focus:outline-none focus:border-btc-orange/60
                           disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <p className="text-[9px] text-gray-600 mt-1">
                Counted the way X counts: a link weighs 23 characters whatever its length.
                {!isLong && ' X hides everything past 280 behind "Show more".'}
              </p>
            </div>

            <RuleCheckPanel check={check} checking={checking} />

            <XPreview body={body} theme={preview} onToggleTheme={() => setPreview(p => (p === 'dark' ? 'light' : 'dark'))} />
          </>
        )}

        {/* ── Schedule ── */}
        {tab === 'schedule' && (
          <div className="space-y-3">
            <div>
              <p className={labelCls}>Current slot</p>
              {at ? (
                <div className="mt-1 space-y-0.5">
                  <p className="text-sm font-mono text-white">{etDisplayTime(at)} <span className="text-gray-500 text-[11px]">{zone}</span></p>
                  <p className="text-[11px] font-mono text-gray-500">{localDisplayTime(at)} Phoenix</p>
                  <p className="text-[10px] font-mono text-gray-600">
                    {post.time_confirmed ? 'Time confirmed' : 'Proposed — not yet confirmed'}
                  </p>
                </div>
              ) : <p className="text-xs text-gray-500 mt-1">Unscheduled</p>}
            </div>

            <div className="flex flex-wrap gap-1.5">
              <button disabled={saving || terminal} className={cn(btn, 'text-btc-orange border-btc-orange/30 hover:bg-btc-orange/10')}
                      onClick={() => {
                        const v = window.prompt(`New time in Eastern (${zone}) — YYYY-MM-DD HH:mm:`,
                          at ? etInputValue(at) : etInputValue(new Date()));
                        if (v) void call(`/api/posts/${post.id}/reschedule`, { method: 'POST', body: JSON.stringify({ mode: 'at', at: v }) });
                      }}>
                <Clock size={11} /> Set time
              </button>
              <button disabled={saving || terminal} className={cn(btn, 'text-gray-300 border-btc-orange/20 hover:bg-btc-orange/10')}
                      onClick={() => call(`/api/posts/${post.id}/reschedule`, { method: 'POST', body: JSON.stringify({ mode: 'snap' }) })}>
                <Zap size={11} /> Snap to slot
              </button>
              <button disabled={saving || terminal} className={cn(btn, 'text-gray-300 border-btc-orange/20 hover:bg-btc-orange/10')}
                      onClick={() => call(`/api/posts/${post.id}/reschedule`, { method: 'POST', body: JSON.stringify({ mode: 'nextOpen' }) })}>
                Next open time
              </button>
            </div>

            {locked && (
              <p className="text-[10px] text-sky-400 border border-sky-400/25 bg-sky-400/5 px-2 py-1.5">
                This post sends shortly, so its text is locked. Pause it to make changes — rescheduling still works.
              </p>
            )}
          </div>
        )}

        {/* ── Attributes ── */}
        {tab === 'attributes' && (
          <div className="space-y-3">
            <div>
              <p className={labelCls}>Post type</p>
              <select
                value={post.type_id ?? ''}
                disabled={saving || terminal}
                onChange={e => call(`/api/posts/${post.id}`, { method: 'PUT', body: JSON.stringify({ typeId: Number(e.target.value) }) })}
                className="w-full mt-1 bg-[#0a0a0a] border border-btc-orange/20 px-2 py-1.5 text-xs text-gray-300"
              >
                {types.map(t => <option key={t.id} value={t.id}>{t.code} · {t.name}</option>)}
              </select>
              <p className="text-[9px] text-gray-600 mt-1">Changing the type changes which rules apply.</p>
            </div>

            {type && (
              <div className="border border-btc-orange/15 p-2 space-y-1">
                <p className={labelCls}>Rules from this type</p>
                <Row k="Length" v={type.length_mode === 'long' ? 'Long-form' : '280 characters'} />
                <Row k="Cashtags" v={type.cashtag_max === 0 ? 'None allowed' : `${type.cashtag_min}–${type.cashtag_max}`} />
                <Row k="Hashtags" v={`max ${type.hashtag_max}`} />
                <Row k="Source" v={type.source_required ? 'Required' : 'Optional'} />
                <Row k="Goes stale" v={type.staleness_hours ? `after ${type.staleness_hours}h` : 'never'} />
              </div>
            )}

            <div>
              <p className={labelCls}>Private notes</p>
              <textarea rows={3} defaultValue={post.notes ?? ''} disabled={saving || terminal}
                        onBlur={e => call(`/api/posts/${post.id}`, { method: 'PUT', body: JSON.stringify({ notes: e.target.value }) })}
                        className="w-full mt-1 bg-[#111] border border-btc-orange/20 px-2 py-1.5 text-xs text-gray-300 resize-y focus:outline-none focus:border-btc-orange/50" />
              <p className="text-[9px] text-gray-600 mt-1">Never published. Saved when you click away.</p>
            </div>

            <p className="text-[10px] text-gray-600 border border-btc-orange/10 px-2 py-1.5">
              Event scoring and the 48-hour traded-ticker check need the event and
              positions data that lands with Sources in Phase D.
            </p>
          </div>
        )}
      </div>

      {/* Footer actions */}
      {!terminal && (
        <div className="border-t border-btc-orange/15 p-2 flex items-center gap-1.5 flex-wrap">
          {post.status === 'approved' ? (
            <button disabled={saving} onClick={() => call(`/api/posts/${post.id}/unapprove`, { method: 'POST' })}
                    className={cn(btn, 'text-amber-400 border-amber-400/30 hover:bg-amber-400/10')}>Pause</button>
          ) : (
            <button
              disabled={saving || locked || !body.trim() || (check ? !check.ok : false)}
              onClick={saveAndApprove}
              title={check && !check.ok ? 'The rule check must pass before this can be approved' : undefined}
              className={cn(btn, 'text-green-400 border-green-400/30 hover:bg-green-400/10')}
            >
              {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
              {dirty ? 'Save & approve' : 'Approve'}
            </button>
          )}
          {dirty && (
            <button disabled={saving || locked} onClick={save} className={cn(btn, 'text-btc-orange border-btc-orange/30 hover:bg-btc-orange/10')}>
              Save
            </button>
          )}
          {dirty && post.status === 'approved' && (
            <span className="text-[9px] font-mono text-amber-400/70">saving returns this to Needs review</span>
          )}
        </div>
      )}
    </aside>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[10px] font-mono text-gray-600">{k}</span>
      <span className="text-[10px] font-mono text-gray-300">{v}</span>
    </div>
  );
}

function RuleCheckPanel({ check, checking }: { check: RuleCheckResult | null; checking: boolean }) {
  if (!check) {
    return <p className="text-[10px] font-mono text-gray-600">{checking ? 'Checking…' : ''}</p>;
  }

  const Line = ({ f }: { f: RuleFinding }) => (
    <li className={cn('flex items-start gap-1.5 text-[10px] leading-snug',
      f.severity === 'error' ? 'text-red-400' : 'text-amber-400')}>
      {f.severity === 'error' ? <AlertCircle size={11} className="shrink-0 mt-px" /> : <AlertTriangle size={11} className="shrink-0 mt-px" />}
      <span>{f.message}</span>
    </li>
  );

  return (
    <div className={cn('border p-2 space-y-1.5',
      check.errors.length ? 'border-red-500/30 bg-red-500/5'
      : check.warnings.length ? 'border-amber-400/25 bg-amber-400/5'
      : 'border-green-400/25 bg-green-400/5')}>
      <div className="flex items-center gap-1.5">
        {check.errors.length ? <AlertCircle size={12} className="text-red-400" />
          : check.warnings.length ? <AlertTriangle size={12} className="text-amber-400" />
          : <Check size={12} className="text-green-400" />}
        <p className={cn('text-[10px] font-mono uppercase tracking-wider',
          check.errors.length ? 'text-red-400' : check.warnings.length ? 'text-amber-400' : 'text-green-400')}>
          {check.errors.length ? `${check.errors.length} blocking`
            : check.warnings.length ? `${check.warnings.length} to review`
            : 'Rule check passed'}
        </p>
        {checking && <Loader2 size={10} className="animate-spin text-gray-600" />}
      </div>

      {check.findings.length > 0 && (
        <ul className="space-y-1">{check.findings.map((f, i) => <Line key={i} f={f} />)}</ul>
      )}

      {(check.hashtags.length > 0 || check.cashtags.length > 0) && (
        <p className="text-[9px] font-mono text-gray-600 pt-0.5">
          {check.hashtags.map(h => `#${h}`).join(' ')} {check.cashtags.map(c => `$${c}`).join(' ')}
        </p>
      )}
    </div>
  );
}

/**
 * A rough X-style render, at phone width, in both themes.
 *
 * Not pixel-perfect and not trying to be — its job is to show where the fold falls and
 * how the first ~280 characters read on their own, which is the thing that decides
 * whether a post works.
 */
function XPreview({ body, theme, onToggleTheme }: { body: string; theme: 'dark' | 'light'; onToggleTheme: () => void }) {
  const visible = body.slice(0, FOLD);
  const hidden = body.slice(FOLD);
  const dark = theme === 'dark';

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <p className={labelCls}>Preview</p>
        <button onClick={onToggleTheme} className="text-gray-500 hover:text-btc-orange p-1" title="Toggle light/dark">
          {dark ? <Moon size={11} /> : <Sun size={11} />}
        </button>
      </div>
      <div className={cn('border rounded-lg p-3 max-w-[340px]',
        dark ? 'bg-black border-gray-800' : 'bg-white border-gray-200')}>
        <div className="flex gap-2">
          <div className={cn('w-9 h-9 rounded-full shrink-0', dark ? 'bg-gray-800' : 'bg-gray-200')} />
          <div className="min-w-0 flex-1">
            <p className="flex items-baseline gap-1 flex-wrap">
              <span className={cn('text-[12px] font-bold', dark ? 'text-white' : 'text-black')}>ChokePoint Macro</span>
              <span className="text-[11px] text-gray-500">@ChokepointMacro</span>
            </p>
            <p className={cn('text-[12px] leading-snug whitespace-pre-wrap break-words mt-0.5',
              dark ? 'text-gray-100' : 'text-gray-900')}>
              {visible || <span className="text-gray-500 italic">empty</span>}
            </p>
            {hidden && (
              <>
                <div className={cn('my-1.5 border-t border-dashed', dark ? 'border-gray-700' : 'border-gray-300')} />
                <p className="text-[10px] font-mono text-sky-500">Show more ↓</p>
                <p className={cn('text-[12px] leading-snug whitespace-pre-wrap break-words opacity-40 mt-1',
                  dark ? 'text-gray-100' : 'text-gray-900')}>
                  {hidden.slice(0, 200)}{hidden.length > 200 ? '…' : ''}
                </p>
              </>
            )}
          </div>
        </div>
      </div>
      {hidden && (
        <p className="text-[9px] text-gray-600 mt-1">
          Everything below the line is hidden until someone taps Show more — the part above it has to stand alone.
        </p>
      )}
    </div>
  );
}
