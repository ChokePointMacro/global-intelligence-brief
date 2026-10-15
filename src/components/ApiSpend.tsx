import { useEffect, useMemo, useState } from 'react';
import { Loader2, DollarSign, AlertTriangle } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { BackButton } from './BackButton';

const PROVIDER_COLORS: Record<string, string> = {
  x: '#38bdf8',
  anthropic: '#f7931a',
  openai: '#4ade80',
  gemini: '#a78bfa',
};

const usd = (n: number) => (n >= 1 ? `$${n.toFixed(2)}` : n > 0 ? `$${n.toFixed(4)}` : '$0');

interface SpendRow {
  provider: string; operation: string; model: string | null;
  calls: number; units: number; input_tokens: number; output_tokens: number;
  cost: number; verified: number;
}
interface DailyRow { day: string; provider: string; cost: number }

export const ApiSpend = () => {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiFetch(`/api/spend?days=${days}`)
      .then(r => (r.ok ? r.json() : null))
      .then(setData)
      .finally(() => setLoading(false));
  }, [days]);

  const byDay = useMemo(() => {
    if (!data?.daily) return [] as { day: string; total: number; parts: Record<string, number> }[];
    const map = new Map<string, Record<string, number>>();
    for (const d of data.daily as DailyRow[]) {
      if (!map.has(d.day)) map.set(d.day, {});
      map.get(d.day)![d.provider] = (map.get(d.day)![d.provider] || 0) + d.cost;
    }
    return [...map.entries()]
      .map(([day, parts]) => ({ day, parts, total: Object.values(parts).reduce((a, b) => a + b, 0) }))
      .sort((a, b) => a.day.localeCompare(b.day));
  }, [data]);

  const maxDay = Math.max(...byDay.map(d => d.total), 0.0001);
  const byProvider = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of (data?.totals ?? []) as SpendRow[]) m.set(r.provider, (m.get(r.provider) || 0) + r.cost);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [data]);

  const hasUnverified = (data?.totals ?? []).some((r: SpendRow) => !r.verified && r.cost > 0);

  if (loading && !data) {
    return <div className="min-h-[60vh] flex items-center justify-center"><Loader2 className="animate-spin text-btc-orange" size={28} /></div>;
  }

  return (
    <div className="max-w-[1400px] mx-auto px-6 py-8">
      <BackButton />

      <div className="flex items-start justify-between flex-wrap gap-4 mb-8">
        <div>
          <h1 className="font-serif italic text-4xl text-white">API Spend</h1>
          <p className="text-[10px] font-mono uppercase tracking-widest text-white/30 mt-2">
            Posting, reads, and AI generation — every billable call
          </p>
        </div>
        <div className="flex gap-1">
          {[7, 30, 90].map(d => (
            <button key={d} onClick={() => setDays(d)}
              className={`px-3 py-2 text-[10px] font-mono uppercase tracking-widest border transition-colors ${
                days === d ? 'border-btc-orange/40 bg-btc-orange/10 text-btc-orange' : 'border-white/10 text-white/35 hover:text-white/60'}`}>
              {d}d
            </button>
          ))}
        </div>
      </div>

      {!data?.totals?.length ? (
        <div className="border border-btc-orange/20 bg-btc-orange/5 p-4">
          <p className="text-[11px] font-mono text-btc-orange/80 uppercase tracking-widest mb-1">No spend recorded yet</p>
          <p className="text-xs text-white/50 leading-relaxed">
            Tracking starts from the moment this was installed — it cannot see spend that happened before.
            Generate a report or publish a post and it will appear here. For billed-to-date totals, check{' '}
            <span className="text-btc-orange/70">console.x.com</span> and your AI provider consoles.
          </p>
        </div>
      ) : (
        <>
          {/* ── Headline numbers ── */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
            <div className="border border-btc-orange/20 bg-btc-orange/5 p-4">
              <div className="flex items-center gap-1.5 mb-1">
                <DollarSign size={11} className="text-btc-orange/60" />
                <span className="text-[9px] font-mono uppercase tracking-widest text-white/30">Last {days} days</span>
              </div>
              <p className="text-3xl font-mono text-btc-orange tabular-nums">{usd(data.total)}</p>
            </div>
            <div className="border border-white/10 bg-white/[0.02] p-4">
              <span className="text-[9px] font-mono uppercase tracking-widest text-white/30 block mb-1">Projected / month</span>
              <p className="text-3xl font-mono text-white/80 tabular-nums">{usd(data.projectedMonthly)}</p>
              <p className="text-[9px] font-mono text-white/20 mt-1">from {data.daysObserved} day{data.daysObserved === 1 ? '' : 's'} of data</p>
            </div>
            <div className="border border-white/10 bg-white/[0.02] p-4">
              <span className="text-[9px] font-mono uppercase tracking-widest text-white/30 block mb-2">By provider</span>
              {byProvider.map(([p, c]) => (
                <div key={p} className="flex items-center justify-between text-[11px] font-mono mb-0.5">
                  <span className="flex items-center gap-1.5 text-white/50">
                    <span className="w-2 h-2 rounded-full" style={{ background: PROVIDER_COLORS[p] ?? '#666' }} />{p}
                  </span>
                  <span className="text-white/70 tabular-nums">{usd(c)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ── Daily stacked bars ── */}
          <div className="mb-8">
            <h2 className="text-[10px] font-mono uppercase tracking-widest text-btc-orange/80 mb-3">Daily spend</h2>
            {/* items-stretch, not items-end: items-end collapses each column to content
                height, so the percentage-height bars inside resolve against zero. */}
            <div className="flex items-stretch gap-[2px] h-32 border-b border-white/10 pb-0">
              {byDay.map(d => (
                <div key={d.day} className="flex-1 flex flex-col justify-end group relative min-w-[3px]"
                  title={`${d.day} — ${usd(d.total)}`}>
                  {Object.entries(d.parts).map(([p, c]) => (
                    <div key={p} style={{ height: `${(c / maxDay) * 100}%`, background: PROVIDER_COLORS[p] ?? '#666', opacity: 0.85 }} />
                  ))}
                </div>
              ))}
            </div>
            <div className="flex justify-between text-[9px] font-mono text-white/20 mt-1">
              <span>{byDay[0]?.day}</span><span>peak {usd(maxDay)}</span><span>{byDay[byDay.length - 1]?.day}</span>
            </div>
          </div>

          {/* ── Breakdown ── */}
          <h2 className="text-[10px] font-mono uppercase tracking-widest text-btc-orange/80 mb-3">Breakdown</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] font-mono">
              <thead>
                <tr className="text-[9px] uppercase tracking-widest text-white/25 border-b border-white/10">
                  <th className="text-left py-2 pr-4">Provider</th>
                  <th className="text-left py-2 pr-4">Operation</th>
                  <th className="text-left py-2 pr-4">Model</th>
                  <th className="text-right py-2 pr-4">Calls</th>
                  <th className="text-right py-2 pr-4">Tokens in/out</th>
                  <th className="text-right py-2">Cost</th>
                </tr>
              </thead>
              <tbody>
                {(data.totals as SpendRow[]).map((r, i) => (
                  <tr key={i} className="border-b border-white/5 hover:bg-white/[0.02]">
                    <td className="py-2 pr-4">
                      <span className="flex items-center gap-1.5 text-white/60">
                        <span className="w-2 h-2 rounded-full" style={{ background: PROVIDER_COLORS[r.provider] ?? '#666' }} />{r.provider}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-white/50">
                      {r.operation}
                      {!r.verified && <span className="ml-1.5 text-[9px] text-yellow-500/60">est.</span>}
                    </td>
                    <td className="py-2 pr-4 text-white/30">{r.model ?? '—'}</td>
                    <td className="py-2 pr-4 text-right text-white/50 tabular-nums">{r.calls}</td>
                    <td className="py-2 pr-4 text-right text-white/30 tabular-nums">
                      {r.input_tokens ? `${(r.input_tokens / 1000).toFixed(1)}k / ${(r.output_tokens / 1000).toFixed(1)}k` : '—'}
                    </td>
                    <td className="py-2 text-right text-btc-orange tabular-nums">{usd(r.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {hasUnverified && (
            <div className="flex items-start gap-2 mt-4 p-3 border border-yellow-500/20 bg-yellow-500/5">
              <AlertTriangle size={12} className="text-yellow-500/70 mt-0.5 shrink-0" />
              <p className="text-[10px] text-white/45 leading-relaxed">
                Rows marked <span className="text-yellow-500/70">est.</span> use placeholder rates that have not been confirmed
                against the provider&apos;s pricing page. Treat those costs as indicative and update the rates in
                <span className="text-white/60"> src/services/spend.ts</span>.
              </p>
            </div>
          )}

          <p className="text-[10px] text-white/25 mt-6 leading-relaxed">
            This ledger counts calls this app makes, starting{' '}
            {data.trackingSince ? new Date(data.trackingSince).toLocaleDateString() : 'now'} — it is not a bill.
            Reconcile against console.x.com and your AI provider consoles before treating it as authoritative.
          </p>
        </>
      )}
    </div>
  );
};
