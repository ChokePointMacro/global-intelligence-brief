import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Loader2, Wifi, WifiOff, Zap, Send, MessageSquare, Activity, CheckCircle2, XCircle, AlertTriangle, Clock, Server } from 'lucide-react';
import { cn } from '../lib/utils';
import { apiFetch } from '../lib/api';
import { BackButton } from './BackButton';

interface Connection {
  id: string;
  name: string;
  category: string;
  tier: string;
  status: 'live' | 'error' | 'unconfigured';
  latencyMs: number;
  error: string | null;
  meta: Record<string, string> | null;
  rateLimits: Record<string, number | string | undefined>;
  knownLimits: Record<string, number>;
  checkedAt: string;
}

const STATUS_CONFIG = {
  live:         { label: 'LIVE',      color: 'text-green-400',  bg: 'bg-green-500/10', border: 'border-green-500/25', dot: 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.7)]', icon: <CheckCircle2 size={11} /> },
  error:        { label: 'ERROR',     color: 'text-red-400',    bg: 'bg-red-500/10',   border: 'border-red-500/25',   dot: 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]',   icon: <XCircle size={11} /> },
  unconfigured: { label: 'NOT SET',   color: 'text-gray-600',   bg: 'bg-white/5',      border: 'border-white/5',      dot: 'bg-gray-700',                                        icon: <WifiOff size={11} /> },
  loading:      { label: 'CHECKING',  color: 'text-btc-orange', bg: 'bg-btc-orange/10', border: 'border-btc-orange/20', dot: 'bg-btc-orange animate-pulse',                       icon: <Loader2 size={11} className="animate-spin" /> },
};

const CAT_ICONS: Record<string, React.ReactNode> = {
  ai: <Zap size={12} className="text-purple-400" />,
  social: <Send size={12} className="text-blue-400" />,
  publishing: <MessageSquare size={12} className="text-amber-400" />,
  infra: <Server size={12} className="text-emerald-400" />,
};

const CAT_LABELS: Record<string, string> = {
  ai: 'AI Providers',
  social: 'Social Platforms',
  publishing: 'Publishing',
  infra: 'Infrastructure',
};

const CAT_COLORS: Record<string, string> = {
  ai: 'text-purple-400',
  social: 'text-blue-400',
  publishing: 'text-amber-400',
  infra: 'text-emerald-400',
};

function UsageBar({ used, total, label }: { used: number; total: number; label: string }) {
  const pct = total > 0 ? Math.min((used / total) * 100, 100) : 0;
  const remaining = total - used;
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-[8px] font-mono uppercase tracking-wider">
        <span className="text-gray-600">{label}</span>
        <span className={pct > 90 ? 'text-red-400' : pct > 70 ? 'text-yellow-400' : 'text-gray-500'}>
          {remaining.toLocaleString()} left
        </span>
      </div>
      <div className="h-1 bg-white/5 rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full transition-all duration-700",
          pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-yellow-500' : 'bg-btc-orange'
        )} style={{ width: `${Math.max(pct, 1)}%` }} />
      </div>
    </div>
  );
}

function ConnectionTile({ conn, onRefresh, refreshing }: { conn: Connection; onRefresh: () => void; refreshing: boolean }) {
  const cfg = refreshing ? STATUS_CONFIG.loading : STATUS_CONFIG[conn.status];
  const rl = conn.rateLimits || {};
  const kl = conn.knownLimits || {};

  return (
    <div className={cn("border rounded bg-[#0c0c0c] p-4 flex flex-col gap-3 transition-all relative", cfg.border)}>
      {/* Status dot */}
      <div className={cn("absolute top-3 right-3 w-2 h-2 rounded-full transition-all", cfg.dot)} />

      {/* Name + category */}
      <div className="pr-5">
        <div className="flex items-center gap-1.5 mb-1">
          {CAT_ICONS[conn.category]}
          <span className="text-[9px] font-mono text-gray-600 uppercase tracking-widest">{conn.category}</span>
        </div>
        <h3 className="text-xs font-mono font-bold text-white uppercase tracking-wider">{conn.name}</h3>
      </div>

      {/* Status badge + tier + latency */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className={cn("text-[9px] font-mono font-bold uppercase tracking-widest px-2 py-0.5 rounded-sm flex items-center gap-1", cfg.bg, cfg.color)}>
          {cfg.icon} {cfg.label}
        </span>
        <span className="text-[9px] font-mono text-gray-600 uppercase tracking-wider">{conn.tier}</span>
        {conn.latencyMs > 0 && (
          <span className="text-[9px] font-mono text-gray-700 tabular-nums flex items-center gap-0.5">
            <Clock size={8} /> {conn.latencyMs}ms
          </span>
        )}
      </div>

      {/* Meta info (username, handle, etc) */}
      {conn.meta && Object.keys(conn.meta).length > 0 && (
        <div className="text-[10px] font-mono text-btc-orange/70">
          {Object.values(conn.meta).join(' · ')}
        </div>
      )}

      {/* Error message */}
      {conn.error && (
        <div className="flex items-start gap-1.5 text-[9px] font-mono text-red-400/80 bg-red-500/5 rounded px-2 py-1.5">
          <AlertTriangle size={10} className="mt-0.5 shrink-0" />
          <span className="break-all">{conn.error}</span>
        </div>
      )}

      {/* Rate limit bars (Anthropic live headers) */}
      {rl.limitRequests != null && rl.remainingRequests != null && (
        <div className="space-y-1.5 border-t border-white/5 pt-2">
          <UsageBar used={(rl.limitRequests as number) - (rl.remainingRequests as number)} total={rl.limitRequests as number} label="Requests/min" />
          {rl.limitTokens != null && rl.remainingTokens != null && (
            <UsageBar used={(rl.limitTokens as number) - (rl.remainingTokens as number)} total={rl.limitTokens as number} label="Tokens/min" />
          )}
        </div>
      )}

      {/* Known limits */}
      <div className="border-t border-white/5 pt-2 space-y-1">
        {kl.rpm != null && rl.limitRequests == null && (
          <div className="flex justify-between text-[9px] font-mono"><span className="text-gray-600">RPM</span><span className="text-gray-400 tabular-nums">{kl.rpm.toLocaleString()}</span></div>
        )}
        {kl.tpmInput != null && (
          <div className="flex justify-between text-[9px] font-mono"><span className="text-gray-600">TPM IN</span><span className="text-gray-400 tabular-nums">{kl.tpmInput.toLocaleString()}</span></div>
        )}
        {kl.tpmOutput != null && (
          <div className="flex justify-between text-[9px] font-mono"><span className="text-gray-600">TPM OUT</span><span className="text-gray-400 tabular-nums">{kl.tpmOutput.toLocaleString()}</span></div>
        )}
        {kl.rpd != null && (
          <div className="flex justify-between text-[9px] font-mono"><span className="text-gray-600">RPD</span><span className="text-gray-400 tabular-nums">{kl.rpd.toLocaleString()}</span></div>
        )}
        {kl.postsPerDay != null && (
          <div className="flex justify-between text-[9px] font-mono"><span className="text-gray-600">POSTS/DAY</span><span className="text-gray-400 tabular-nums">{kl.postsPerDay.toLocaleString()}</span></div>
        )}
        {kl.postsPerMonth != null && (
          <div className="flex justify-between text-[9px] font-mono"><span className="text-gray-600">POSTS/MO</span><span className="text-gray-400 tabular-nums">{kl.postsPerMonth.toLocaleString()}</span></div>
        )}
      </div>

      {/* Refresh button */}
      <div className="flex items-center justify-between border-t border-white/5 pt-1.5">
        <span className="text-[8px] font-mono text-gray-700">
          {conn.checkedAt ? new Date(conn.checkedAt).toLocaleTimeString() : '—'}
        </span>
        <button onClick={onRefresh} disabled={refreshing} className="text-gray-700 hover:text-btc-orange transition-colors disabled:opacity-30" title="Re-check">
          {refreshing ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
        </button>
      </div>
    </div>
  );
}

export const Connections = () => {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const res = await apiFetch('/api/connections');
      if (res.ok) {
        const data = await res.json();
        setConnections(data.connections);
        setError(null);
      } else {
        setError(`Server returned ${res.status}`);
      }
    } catch {
      setError('Cannot reach server');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const refreshOne = async (id: string) => {
    setRefreshing(r => ({ ...r, [id]: true }));
    try {
      const res = await apiFetch(`/api/connections/ping/${id}`, { method: 'POST' });
      if (res.ok) {
        const updated = await res.json();
        setConnections(prev => prev.map(c => c.id === id ? updated : c));
      }
    } catch { /* keep stale */ }
    setRefreshing(r => ({ ...r, [id]: false }));
  };

  const refreshAll = async () => {
    setLoading(true);
    await fetchAll();
  };

  const liveCount = connections.filter(c => c.status === 'live').length;
  const errorCount = connections.filter(c => c.status === 'error').length;
  const offCount = connections.filter(c => c.status === 'unconfigured').length;

  // Group
  // Dynamic grouping — auto-discovers categories from the data
  const grouped = connections.reduce<Record<string, Connection[]>>((acc, c) => {
    if (!acc[c.category]) acc[c.category] = [];
    acc[c.category].push(c);
    return acc;
  }, {});

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-3">
        <Loader2 className="animate-spin text-btc-orange" size={28} />
        <span className="text-[10px] font-mono text-gray-600 uppercase tracking-widest">Pinging services...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <BackButton />

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-sm font-mono font-bold uppercase tracking-[0.25em] text-white flex items-center gap-2.5">
            <Activity size={16} className="text-btc-orange" /> Connections
          </h1>
          <p className="text-[10px] font-mono text-gray-600 mt-1 uppercase tracking-wider">
            {connections.length} services — live connectivity & rate limits
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3 text-[10px] font-mono">
            <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_5px_rgba(34,197,94,0.6)]" /><span className="text-green-400 tabular-nums">{liveCount}</span> <span className="text-gray-600">live</span></span>
            {errorCount > 0 && <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-red-500" /><span className="text-red-400 tabular-nums">{errorCount}</span> <span className="text-gray-600">error</span></span>}
            {offCount > 0 && <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-gray-700" /><span className="text-gray-500 tabular-nums">{offCount}</span> <span className="text-gray-600">off</span></span>}
          </div>
          <button onClick={refreshAll} className="flex items-center gap-1.5 px-3 py-1.5 text-[9px] font-mono font-bold uppercase tracking-widest text-btc-orange border border-btc-orange/20 rounded-sm hover:bg-btc-orange/10 transition-colors">
            <RefreshCw size={10} /> Ping All
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-[10px] font-mono text-red-400 bg-red-500/10 border border-red-500/20 rounded px-3 py-2">
          <AlertTriangle size={12} /> {error}
        </div>
      )}

      {/* Dynamic category sections — auto-renders any new category */}
      {Object.entries(grouped).map(([cat, items]) => {
        const icon = CAT_ICONS[cat] || <Wifi size={12} className="text-gray-400" />;
        const label = CAT_LABELS[cat] || cat.charAt(0).toUpperCase() + cat.slice(1);
        const color = CAT_COLORS[cat] || 'text-gray-400';
        return (
          <div key={cat} className="space-y-2.5">
            <h2 className={cn("text-[10px] font-mono font-bold uppercase tracking-[0.2em] flex items-center gap-2", color)}>
              {icon} {label} <span className="text-gray-700 font-normal">({items.length})</span>
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {items.map(c => <ConnectionTile key={c.id} conn={c} onRefresh={() => refreshOne(c.id)} refreshing={!!refreshing[c.id]} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
};
