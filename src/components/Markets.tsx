import React, { useState, useEffect, useCallback, useRef } from 'react';
import { TrendingUp, TrendingDown, RefreshCw, Activity, Star, Plus, X, Search, Loader2, ChevronDown, Sparkles } from 'lucide-react';
import { cn } from '../lib/utils';
import { apiFetch } from '../lib/api';
import { BackButton } from './BackButton';
import type { UserData } from '../types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Tile {
  symbol: string; name: string; type: string;
  isCrypto: boolean; isIndex: boolean;
  price: number | null; change: number | null; changePercent: number | null;
  bid: number | null; ask: number | null; spread: number | null;
  volume: number | null; lastTimestamp: string | null;
}

interface Candle { t: number; o: number; h: number; l: number; c: number; }

interface Pivots { p: number; r1: number; r2: number; r3: number; s1: number; s2: number; s3: number; }

interface HistoryRec { symbol: string; candles: Candle[]; pivotLevels: Pivots | null; }

interface Contract {
  symbol: string; side: 'CALL' | 'PUT'; strike: number | null;
  last: number | null; bid: number | null; ask: number | null;
  volume: number; openInterest: number;
}

interface OptionsRec { symbol: string; expiry: string; contracts: Contract[]; }

interface CustomEntry { tile: Tile; candles: Candle[]; pivotLevels: Pivots | null; }

// ─── Helpers ──────────────────────────────────────────────────────────────────

const REFRESH = 30_000;
const CUSTOM_KEY = 'gib_custom_tickers'; // localStorage key

function loadCustomSymbols(): string[] {
  try { return JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]'); } catch { return []; }
}
function saveCustomSymbols(syms: string[]) {
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(syms));
}

const fp = (n: number | null, isIdx = false) => {
  if (n == null) return '—';
  const s = n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return isIdx ? s : `$${s}`;
};

const fv = (n: number | null) => {
  if (!n) return '—';
  if (n >= 1e9) return `${(n/1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n/1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n/1e3).toFixed(0)}K`;
  return String(n);
};

const ft = (ts: string | null) =>
  ts ? new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' }) : '';

async function safeFetch(path: string): Promise<any> {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await apiFetch(path, { signal: ctrl.signal } as any);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Mini Candlestick Background ─────────────────────────────────────────────

const CandleBg = ({ candles }: { candles: Candle[] }) => {
  if (!candles.length) return null;
  const W = 400; const H = 100;
  const lo = Math.min(...candles.map(c => c.l));
  const hi = Math.max(...candles.map(c => c.h));
  const rng = hi - lo || 1;
  const sy = (v: number) => H - ((v - lo) / rng) * H;
  const n = candles.length;
  const cw = Math.max(2, W / n - 1);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
      className="absolute inset-0 w-full h-full pointer-events-none" style={{ opacity: 0.18 }}>
      {candles.map((c, i) => {
        const x = i * (cw + 1);
        const up = c.c >= c.o;
        const col = up ? '#10b981' : '#ef4444';
        const by = Math.min(sy(c.o), sy(c.c));
        const bh = Math.max(1, Math.abs(sy(c.o) - sy(c.c)));
        return (
          <g key={i}>
            <line x1={x + cw/2} y1={sy(c.h)} x2={x + cw/2} y2={sy(c.l)} stroke={col} strokeWidth={0.7} />
            <rect x={x} y={by} width={cw} height={bh} fill={col} />
          </g>
        );
      })}
    </svg>
  );
};

// ─── Pivot Bar ────────────────────────────────────────────────────────────────

const PLABELS = [
  { k: 's3', l: 'S3', col: '#60a5fa' }, { k: 's2', l: 'S2', col: '#3b82f6' },
  { k: 's1', l: 'S1', col: '#38bdf8' }, { k: 'p',  l: 'P',  col: '#f7931a' },
  { k: 'r1', l: 'R1', col: '#fb923c' }, { k: 'r2', l: 'R2', col: '#f87171' },
  { k: 'r3', l: 'R3', col: '#fca5a5' },
] as const;

const PivotSection = ({ pivots, price, isIdx }: { pivots: Pivots; price: number | null; isIdx: boolean }) => {
  const vals = { s3: pivots.s3, s2: pivots.s2, s1: pivots.s1, p: pivots.p, r1: pivots.r1, r2: pivots.r2, r3: pivots.r3 };
  const all = Object.values(vals);
  const lo = Math.min(...all); const hi = Math.max(...all); const rng = hi - lo || 1;
  const pct = (v: number) => ((v - lo) / rng) * 100;
  const curPct = price != null ? Math.max(2, Math.min(98, ((price - lo) / rng) * 100)) : null;

  return (
    <div className="mt-3 pt-3 border-t border-white/5 space-y-2">
      <p className="text-[8px] font-mono uppercase tracking-widest text-btc-orange/40">Pivot Levels</p>
      {/* Visual bar */}
      <div className="relative h-4 bg-black/60 border border-white/5">
        {PLABELS.map(({ k, col }) => (
          <div key={k} className="absolute top-0 w-px h-full"
            style={{ left: `${pct(vals[k])}%`, backgroundColor: col, opacity: 0.6 }} />
        ))}
        {curPct != null && (
          <div className="absolute top-0 w-[2px] h-full bg-white shadow-[0_0_4px_white]"
            style={{ left: `${curPct}%` }} />
        )}
      </div>
      {/* Labels */}
      <div className="flex justify-between">
        {PLABELS.map(({ k, l, col }) => (
          <div key={k} className="text-center">
            <p className="text-[7px] font-mono font-bold" style={{ color: col }}>{l}</p>
            <p className="text-[7px] font-mono text-gray-600 mt-px">
              {isIdx ? Math.round(vals[k]).toLocaleString() : `$${Math.round(vals[k]).toLocaleString()}`}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── Options Section ──────────────────────────────────────────────────────────

const OptionsSection = ({ contracts, expiry }: { contracts: Contract[]; expiry: string }) => {
  const top = contracts.slice(0, 4);
  if (!top.length) return null;

  return (
    <div className="mt-3 pt-3 border-t border-white/5 space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-[8px] font-mono uppercase tracking-widest text-btc-orange/40">Most Traded Options</p>
        <p className="text-[7px] font-mono text-gray-600">Exp {expiry}</p>
      </div>
      <div className="space-y-1">
        {top.map((c, i) => (
          <div key={i} className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className={cn('text-[7px] font-mono font-bold px-1 py-px border',
                c.side === 'CALL' ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/5'
                                  : 'text-red-400 border-red-500/30 bg-red-500/5'
              )}>{c.side[0]}</span>
              <span className="text-[9px] font-mono text-white">${c.strike?.toFixed(0)}</span>
              <span className="text-[8px] font-mono text-gray-600">
                {c.last != null ? `@ $${c.last.toFixed(2)}` : ''}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[8px] font-mono text-btc-orange">Vol {fv(c.volume)}</span>
              {c.openInterest > 0 && <span className="text-[7px] font-mono text-gray-600">OI {fv(c.openInterest)}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── Tile Card ────────────────────────────────────────────────────────────────

const TileCard = ({
  tile, candles, pivots, opts, watched, onToggleWatch,
}: {
  tile: Tile;
  candles: Candle[];
  pivots: Pivots | null;
  opts: OptionsRec | null;
  watched: boolean;
  onToggleWatch: () => void;
}) => {
  const hasChange = tile.changePercent != null;
  const up = (tile.changePercent ?? 0) >= 0;
  const border = hasChange
    ? (up ? 'border-emerald-500/20 hover:border-emerald-500/40' : 'border-red-500/20 hover:border-red-500/40')
    : 'border-white/5 hover:border-white/10';

  return (
    <div className={cn('relative bg-[#0a0a0a] border p-4 transition-colors overflow-hidden flex flex-col', border)}>
      <CandleBg candles={candles} />

      <div className="relative flex-1 flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div>
            <p className="text-[9px] font-mono uppercase tracking-widest text-gray-600">{tile.name}</p>
            <p className="text-[10px] font-mono font-bold text-white mt-0.5">{tile.symbol}</p>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={onToggleWatch} title={watched ? 'Remove from watchlist' : 'Add to watchlist'}
              className={cn('p-1 transition-colors', watched ? 'text-btc-orange' : 'text-gray-700 hover:text-btc-orange/60')}>
              <Star size={11} fill={watched ? 'currentColor' : 'none'} />
            </button>
            {hasChange && (
              <div className={cn('p-1.5 border',
                up ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-red-500/20 bg-red-500/5'
              )}>
                {up ? <TrendingUp size={11} className="text-emerald-400" /> : <TrendingDown size={11} className="text-red-400" />}
              </div>
            )}
          </div>
        </div>

        {/* Price */}
        <p className="text-2xl font-mono font-bold text-white leading-none">
          {fp(tile.price, tile.isIndex)}
        </p>
        {hasChange ? (
          <p className={cn('text-[10px] font-mono font-bold mt-1', up ? 'text-emerald-400' : 'text-red-400')}>
            {up ? '+' : ''}{tile.isIndex
              ? (tile.change?.toFixed(2) ?? '—')
              : (tile.change != null ? `$${Math.abs(tile.change).toFixed(2)}` : '—')
            }&nbsp;
            <span className="opacity-70">({up ? '+' : ''}{tile.changePercent?.toFixed(2)}%)</span>
          </p>
        ) : (
          <p className="text-[9px] font-mono text-gray-600 mt-1">tracking…</p>
        )}

        {/* Bid / Ask / Vol row */}
        <div className="grid grid-cols-3 gap-1 mt-3 pt-2 border-t border-white/5">
          {[
            { l: 'Bid', v: tile.bid  != null ? fp(tile.bid,  tile.isIndex) : '—' },
            { l: 'Ask', v: tile.ask  != null ? fp(tile.ask,  tile.isIndex) : '—' },
            { l: 'Vol', v: fv(tile.volume) },
          ].map(({ l, v }) => (
            <div key={l}>
              <p className="text-[7px] font-mono uppercase text-gray-600">{l}</p>
              <p className="text-[9px] font-mono text-gray-300 mt-px">{v}</p>
            </div>
          ))}
        </div>

        {/* Pivot levels — crypto + indices */}
        {pivots && (tile.isCrypto || tile.isIndex) && (
          <PivotSection pivots={pivots} price={tile.price} isIdx={tile.isIndex} />
        )}

        {/* Options — equities */}
        {opts && !tile.isCrypto && !tile.isIndex && opts.contracts.length > 0 && (
          <OptionsSection contracts={opts.contracts} expiry={opts.expiry} />
        )}

        {tile.lastTimestamp && (
          <p className="text-[7px] font-mono text-gray-700 mt-2">{ft(tile.lastTimestamp)}</p>
        )}
      </div>
    </div>
  );
};

// ─── Bitcoin Hero ─────────────────────────────────────────────────────────────

const BtcHero = ({ tile, candles, pivots, watched, onToggleWatch }: {
  tile: Tile; candles: Candle[]; pivots: Pivots | null;
  watched: boolean; onToggleWatch: () => void;
}) => {
  const up = (tile.changePercent ?? 0) >= 0;
  const hasChange = tile.changePercent != null;

  return (
    <div className={cn('relative overflow-hidden p-6 border',
      up ? 'bg-[#0a0a0a] border-btc-orange/40 shadow-[0_0_40px_rgba(247,147,26,0.08)]'
         : 'bg-[#0a0a0a] border-red-500/30'
    )}>
      <CandleBg candles={candles} />
      <div className={cn('absolute inset-0 pointer-events-none', up
        ? 'bg-gradient-to-br from-btc-orange/5 to-transparent'
        : 'bg-gradient-to-br from-red-500/5 to-transparent'
      )} />

      <div className="relative">
        {/* Top row */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-btc-orange flex items-center justify-center text-black font-bold text-base shadow-[0_0_12px_rgba(247,147,26,0.5)]">₿</div>
              <div>
                <p className="text-[10px] font-mono uppercase tracking-widest text-btc-orange/70">Bitcoin</p>
                <p className="text-[9px] font-mono text-gray-600">BTC-USD · Public.com</p>
              </div>
              <button onClick={onToggleWatch} title={watched ? 'Remove from watchlist' : 'Add to watchlist'}
                className={cn('ml-1 p-1 transition-colors', watched ? 'text-btc-orange' : 'text-gray-700 hover:text-btc-orange/60')}>
                <Star size={14} fill={watched ? 'currentColor' : 'none'} />
              </button>
            </div>
            <p className="text-5xl font-mono font-bold text-white tracking-tight">{fp(tile.price)}</p>
            {hasChange ? (
              <div className={cn('flex items-center gap-2 text-sm font-mono font-bold', up ? 'text-emerald-400' : 'text-red-400')}>
                {up ? <TrendingUp size={15} /> : <TrendingDown size={15} />}
                {up ? '+' : ''}{tile.change != null ? `$${Math.abs(tile.change).toFixed(2)}` : '—'}&nbsp;
                <span className="opacity-80">({up ? '+' : ''}{tile.changePercent?.toFixed(2)}%)</span>
                <span className="text-[9px] font-normal text-gray-600">session</span>
              </div>
            ) : (
              <p className="text-xs font-mono text-gray-600">Accumulating session change…</p>
            )}
          </div>

          <div className="grid grid-cols-3 gap-5">
            {[{ l: 'Bid', v: fp(tile.bid) }, { l: 'Ask', v: fp(tile.ask) },
              { l: 'Spread', v: tile.spread != null ? `$${tile.spread.toFixed(2)}` : '—' }
            ].map(({ l, v }) => (
              <div key={l} className="text-center">
                <p className="text-[8px] font-mono uppercase text-gray-600">{l}</p>
                <p className="text-sm font-mono font-bold text-white mt-0.5">{v}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Volume + timestamp */}
        <div className="flex items-center gap-6 mt-4 pt-3 border-t border-btc-orange/10">
          {tile.volume != null && tile.volume > 0 && (
            <div><p className="text-[8px] font-mono uppercase text-gray-600">Volume</p><p className="text-xs font-mono text-gray-300">{fv(tile.volume)}</p></div>
          )}
          {tile.lastTimestamp && (
            <div><p className="text-[8px] font-mono uppercase text-gray-600">Last Trade</p><p className="text-xs font-mono text-gray-400">{ft(tile.lastTimestamp)}</p></div>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            <Activity size={10} className="text-btc-orange animate-pulse" />
            <span className="text-[9px] font-mono text-btc-orange/60 uppercase">Live</span>
          </div>
        </div>

        {/* Pivot levels */}
        {pivots && <PivotSection pivots={pivots} price={tile.price} isIdx={false} />}
      </div>
    </div>
  );
};

// ─── Insights Panel ───────────────────────────────────────────────────────────

function renderInsightsMd(md: string): React.ReactNode {
  return md.split('\n').map((line, i) => {
    if (!line.trim()) return <div key={i} className="h-2" />;
    // H2 bold headers like **Overall Tone**
    if (/^\*\*\d/.test(line) || /^\d+\.\s\*\*/.test(line)) {
      const clean = line.replace(/\*\*/g, '').replace(/^\d+\.\s/, '');
      return <p key={i} className="text-[11px] font-mono font-bold text-btc-orange mt-3 mb-1 uppercase tracking-widest">{clean}</p>;
    }
    // Bullet points
    if (/^[-•*]\s/.test(line)) {
      const content = line.replace(/^[-•*]\s/, '');
      const parts = content.split(/\*\*(.*?)\*\*/g);
      return (
        <div key={i} className="flex gap-2 text-[11px] font-mono text-gray-300 leading-relaxed">
          <span className="text-btc-orange/50 mt-px shrink-0">›</span>
          <span>{parts.map((p, j) => j % 2 === 1 ? <strong key={j} className="text-white">{p}</strong> : p)}</span>
        </div>
      );
    }
    // Normal line — inline bold
    const parts = line.split(/\*\*(.*?)\*\*/g);
    return (
      <p key={i} className="text-[11px] font-mono text-gray-300 leading-relaxed">
        {parts.map((p, j) => j % 2 === 1 ? <strong key={j} className="text-white">{p}</strong> : p)}
      </p>
    );
  });
}

const InsightsPanel = () => {
  const [open,        setOpen]        = useState(false);
  const [text,        setText]        = useState<string | null>(null);
  const [loading,     setLoading]     = useState(false);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [error,       setError]       = useState<string | null>(null);
  const fetched = useRef(false);

  const fetchInsights = useCallback(async (force = false) => {
    setLoading(true);
    setError(null);
    const url = force ? '/api/markets/insights?force=1' : '/api/markets/insights';
    const data = await safeFetch(url);
    setLoading(false);
    if (!data) { setError('Could not generate insights. Try again.'); return; }
    setText(data.text);
    setGeneratedAt(data.generatedAt);
  }, []);

  // Fetch on first open
  useEffect(() => {
    if (open && !fetched.current) {
      fetched.current = true;
      fetchInsights();
    }
  }, [open, fetchInsights]);

  const age = generatedAt
    ? Math.round((Date.now() - new Date(generatedAt).getTime()) / 60000)
    : null;

  return (
    <div className="border border-btc-orange/20 bg-[#0a0a0a]">
      {/* Header / toggle */}
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.02] transition-colors group"
      >
        <div className="flex items-center gap-2.5">
          <Sparkles size={12} className="text-btc-orange" />
          <span className="text-[11px] font-mono uppercase tracking-widest text-btc-orange/80">Current Insights</span>
          {age !== null && !loading && (
            <span className="text-[9px] font-mono text-gray-600">· {age === 0 ? 'just now' : `${age}m ago`}</span>
          )}
          {loading && <Loader2 size={10} className="animate-spin text-btc-orange/40" />}
        </div>
        <ChevronDown size={12} className={cn('text-gray-600 transition-transform', open && 'rotate-180')} />
      </button>

      {/* Body */}
      {open && (
        <div className="px-4 pb-4 border-t border-white/5">
          {error ? (
            <div className="pt-3 space-y-2">
              <p className="text-[10px] font-mono text-red-400">{error}</p>
              <button onClick={() => fetchInsights()} className="text-[9px] font-mono text-btc-orange/60 hover:text-btc-orange underline">Retry</button>
            </div>
          ) : loading && !text ? (
            <div className="pt-4 flex items-center gap-2 text-gray-600">
              <Loader2 size={12} className="animate-spin text-btc-orange/40" />
              <span className="text-[10px] font-mono">Analyzing live market data…</span>
            </div>
          ) : text ? (
            <div className="pt-3 space-y-0.5">
              {renderInsightsMd(text)}
              <div className="flex items-center justify-between mt-4 pt-3 border-t border-white/5">
                <span className="text-[8px] font-mono text-gray-700">
                  Generated {generatedAt ? new Date(generatedAt).toLocaleTimeString() : ''} · refreshes every 10 min
                </span>
                <button onClick={() => fetchInsights(true)} disabled={loading}
                  className="flex items-center gap-1 text-[9px] font-mono text-gray-600 hover:text-btc-orange transition-colors">
                  <RefreshCw size={9} className={cn(loading && 'animate-spin')} /> Refresh now
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export const Markets = ({ user }: { user: UserData | null }) => {
  const [tiles,        setTiles]        = useState<Tile[]>([]);
  const [history,      setHistory]      = useState<HistoryRec[]>([]);
  const [options,      setOptions]      = useState<OptionsRec[]>([]);
  const [watchlist,    setWatchlist]    = useState<string[]>([]);
  const [customEntries,setCustomEntries]= useState<CustomEntry[]>([]);
  const [addInput,     setAddInput]     = useState('');
  const [addType,      setAddType]      = useState<'EQUITY'|'CRYPTO'|'INDEX'>('EQUITY');
  const [addLoading,   setAddLoading]   = useState(false);
  const [addError,     setAddError]     = useState<string | null>(null);
  const [showAddBar,   setShowAddBar]   = useState(false);
  const addInputRef = useRef<HTMLInputElement>(null);
  const [loading,      setLoading]      = useState(true);
  const [refreshing,   setRefreshing]   = useState(false);
  const [lastUp,       setLastUp]       = useState<Date | null>(null);
  const [error,        setError]        = useState<string | null>(null);
  const [countdown,    setCountdown]    = useState(REFRESH / 1000);

  const histMap  = Object.fromEntries(history.map(h => [h.symbol, h]));
  const optsMap  = Object.fromEntries(options.map(o => [o.symbol, o]));

  const loadAll = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true);
    setError(null);

    const [tilesData, histData, optsData] = await Promise.all([
      safeFetch('/api/markets'),
      safeFetch('/api/markets/history'),
      safeFetch('/api/markets/options'),
    ]);

    if (!tilesData) {
      setError('Could not reach market data server. Is the server running?');
    } else {
      setTiles(tilesData);
      setLastUp(new Date());
      setCountdown(REFRESH / 1000);
    }
    if (histData)  setHistory(histData);
    if (optsData)  setOptions(optsData);

    setLoading(false);
    setRefreshing(false);
  }, []);

  // Load watchlist when user is logged in
  useEffect(() => {
    if (!user) { setWatchlist([]); return; }
    apiFetch('/api/watchlist')
      .then(r => r.ok ? r.json() : [])
      .then((data: { symbol: string }[]) => setWatchlist(data.map(w => w.symbol)))
      .catch(() => {});
  }, [user]);

  // Load saved custom tickers from localStorage on mount
  useEffect(() => {
    const saved = loadCustomSymbols();
    if (!saved.length) return;
    Promise.all(
      saved.map(sym =>
        safeFetch(`/api/markets/lookup?symbol=${encodeURIComponent(sym)}`)
          .then(d => d ?? null)
      )
    ).then(results => {
      const entries = results.filter(Boolean) as CustomEntry[];
      setCustomEntries(entries);
    });
  }, []);

  const addTicker = useCallback(async () => {
    const sym = addInput.trim().toUpperCase();
    if (!sym) return;
    if (customEntries.some(e => e.tile.symbol === sym)) {
      setAddError(`${sym} is already on the page`);
      return;
    }
    setAddLoading(true);
    setAddError(null);
    const data = await safeFetch(`/api/markets/lookup?symbol=${encodeURIComponent(sym)}&type=${addType}`);
    setAddLoading(false);
    if (!data) { setAddError(`Could not find ${sym} — check symbol and type`); return; }
    setCustomEntries(prev => {
      const next = [...prev, data as CustomEntry];
      saveCustomSymbols(next.map(e => e.tile.symbol));
      return next;
    });
    setAddInput('');
    setAddError(null);
  }, [addInput, addType, customEntries]);

  const removeCustom = useCallback((symbol: string) => {
    setCustomEntries(prev => {
      const next = prev.filter(e => e.tile.symbol !== symbol);
      saveCustomSymbols(next.map(e => e.tile.symbol));
      return next;
    });
  }, []);

  const toggleWatch = useCallback(async (tile: Tile) => {
    if (!user) return;
    const isWatched = watchlist.includes(tile.symbol);
    if (isWatched) {
      setWatchlist(prev => prev.filter(s => s !== tile.symbol));
      await apiFetch(`/api/watchlist/${encodeURIComponent(tile.symbol)}`, { method: 'DELETE' });
    } else {
      setWatchlist(prev => [...prev, tile.symbol]);
      await apiFetch('/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: tile.symbol, name: tile.name, type: tile.type }),
      });
    }
  }, [user, watchlist]);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => { const iv = setInterval(() => loadAll(true), REFRESH); return () => clearInterval(iv); }, [loadAll]);
  useEffect(() => { const t = setInterval(() => setCountdown(c => Math.max(0, c - 1)), 1000); return () => clearInterval(t); }, [lastUp]);
  useEffect(() => { if (showAddBar) setTimeout(() => addInputRef.current?.focus(), 50); }, [showAddBar]);

  const btc         = tiles.find(t => t.symbol === 'BTC');
  const indices     = tiles.filter(t => t.isIndex);
  const equities    = tiles.filter(t => !t.isCrypto && !t.isIndex);
  const watchedTiles = tiles.filter(t => watchlist.includes(t.symbol));

  return (
    <div className="space-y-8">
      <BackButton />

      <InsightsPanel />

      <div className="border-b border-btc-orange/20 pb-5 space-y-3">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-serif italic text-white bitcoin-glow">Live Markets</h1>
            <p className="text-[10px] font-mono uppercase tracking-widest text-btc-orange/40 mt-1">
              Prices via Public.com · Candles & Pivots via Yahoo Finance · Options via Public.com
            </p>
          </div>
          <div className="flex items-center gap-2">
            {lastUp && (
              <div className="text-right">
                <p className="text-[9px] font-mono uppercase text-gray-600">Updated</p>
                <p className="text-[10px] font-mono text-gray-400">{lastUp.toLocaleTimeString()}</p>
                <p className="text-[9px] font-mono text-btc-orange/40">↻ {countdown}s</p>
              </div>
            )}
            <button onClick={() => { setShowAddBar(v => !v); setAddError(null); }}
              className={cn('flex items-center gap-1.5 px-3 py-2 border text-[10px] font-mono uppercase tracking-wider transition-colors',
                showAddBar
                  ? 'border-btc-orange/60 text-btc-orange bg-btc-orange/5'
                  : 'border-white/10 text-gray-500 hover:border-btc-orange/40 hover:text-btc-orange/70'
              )}>
              <Plus size={11} />Add Ticker
            </button>
            <button onClick={() => loadAll(true)} disabled={refreshing}
              className="p-2 border border-btc-orange/20 hover:border-btc-orange/60 hover:text-btc-orange transition-colors text-gray-500">
              <RefreshCw size={14} className={cn(refreshing && 'animate-spin')} />
            </button>
          </div>
        </div>

        {/* Add Ticker Bar */}
        {showAddBar && (
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[140px]">
              <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-600" />
              <input
                ref={addInputRef}
                value={addInput}
                onChange={e => { setAddInput(e.target.value.toUpperCase()); setAddError(null); }}
                onKeyDown={e => e.key === 'Enter' && addTicker()}
                placeholder="TICKER"
                className="w-full pl-7 pr-3 py-2 bg-black border border-white/10 text-white text-[11px] font-mono uppercase placeholder:text-gray-700 focus:outline-none focus:border-btc-orange/40"
              />
            </div>
            <select value={addType} onChange={e => setAddType(e.target.value as any)}
              className="px-2 py-2 bg-black border border-white/10 text-gray-400 text-[10px] font-mono focus:outline-none focus:border-btc-orange/40">
              <option value="EQUITY">Equity</option>
              <option value="CRYPTO">Crypto</option>
              <option value="INDEX">Index</option>
            </select>
            <button onClick={addTicker} disabled={addLoading || !addInput.trim()}
              className={cn('flex items-center gap-1.5 px-3 py-2 border text-[10px] font-mono uppercase transition-colors',
                addLoading || !addInput.trim()
                  ? 'border-white/5 text-gray-700 cursor-not-allowed'
                  : 'border-btc-orange/40 text-btc-orange hover:border-btc-orange hover:bg-btc-orange/5'
              )}>
              {addLoading ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
              Add
            </button>
            {addError && <p className="text-[9px] font-mono text-red-400">{addError}</p>}
          </div>
        )}
      </div>

      {error && (
        <div className="p-4 border border-red-500/30 bg-red-500/5 text-red-400 text-xs font-mono space-y-1">
          <p>{error}</p>
          <button onClick={() => loadAll()} className="underline text-red-400/70 hover:text-red-400">Retry</button>
        </div>
      )}

      {loading ? (
        <div className="py-32 flex flex-col items-center gap-3">
          <RefreshCw size={20} className="animate-spin text-btc-orange/40" />
          <p className="text-[10px] font-mono uppercase tracking-widest text-gray-600">Loading market data…</p>
        </div>
      ) : (
        <div className="space-y-6">

          {/* ── Watchlist ── */}
          {user ? (
            watchedTiles.length > 0 ? (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Star size={10} className="text-btc-orange" fill="currentColor" />
                  <p className="text-[9px] font-mono uppercase tracking-widest text-btc-orange/60">Watchlist</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {watchedTiles.map(t => (
                    <TileCard key={t.symbol} tile={t}
                      candles={histMap[t.symbol]?.candles ?? []}
                      pivots={histMap[t.symbol]?.pivotLevels ?? null}
                      opts={optsMap[t.symbol] ?? null}
                      watched={true}
                      onToggleWatch={() => toggleWatch(t)}
                    />
                  ))}
                </div>
                <div className="mt-4 border-b border-white/5" />
              </div>
            ) : (
              <div className="flex items-center gap-2 p-3 border border-white/5 bg-white/[0.01]">
                <Star size={10} className="text-gray-700" />
                <p className="text-[9px] font-mono text-gray-600">Star any instrument to pin it to your watchlist</p>
              </div>
            )
          ) : (
            <div className="flex items-center gap-2 p-3 border border-white/5 bg-white/[0.01]">
              <Star size={10} className="text-gray-700" />
              <p className="text-[9px] font-mono text-gray-600">Sign in to use the watchlist</p>
            </div>
          )}

          {btc && <BtcHero tile={btc} candles={histMap['BTC']?.candles ?? []} pivots={histMap['BTC']?.pivotLevels ?? null}
            watched={watchlist.includes('BTC')} onToggleWatch={() => toggleWatch(btc)} />}

          <div>
            <p className="text-[9px] font-mono uppercase tracking-widest text-gray-600 mb-3">Indices</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {indices.map(t => (
                <TileCard key={t.symbol} tile={t}
                  candles={histMap[t.symbol]?.candles ?? []}
                  pivots={histMap[t.symbol]?.pivotLevels ?? null}
                  opts={null}
                  watched={watchlist.includes(t.symbol)}
                  onToggleWatch={() => toggleWatch(t)}
                />
              ))}
            </div>
          </div>

          <div>
            <p className="text-[9px] font-mono uppercase tracking-widest text-gray-600 mb-3">Equities</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {equities.map(t => (
                <TileCard key={t.symbol} tile={t}
                  candles={histMap[t.symbol]?.candles ?? []}
                  pivots={null}
                  opts={optsMap[t.symbol] ?? null}
                  watched={watchlist.includes(t.symbol)}
                  onToggleWatch={() => toggleWatch(t)}
                />
              ))}
            </div>
          </div>

          {/* ── Custom Tickers ── */}
          {customEntries.length > 0 && (
            <div>
              <p className="text-[9px] font-mono uppercase tracking-widest text-gray-600 mb-3">Custom</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {customEntries.map(({ tile: t, candles, pivotLevels }) => (
                  <div key={t.symbol} className="relative group">
                    <TileCard
                      tile={t}
                      candles={candles}
                      pivots={pivotLevels}
                      opts={null}
                      watched={watchlist.includes(t.symbol)}
                      onToggleWatch={() => toggleWatch(t)}
                    />
                    <button
                      onClick={() => removeCustom(t.symbol)}
                      title="Remove ticker"
                      className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 text-gray-700 hover:text-red-400 z-10">
                      <X size={10} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
