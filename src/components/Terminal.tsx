import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Loader2, ChevronDown, ChevronUp, AlertTriangle, Activity } from 'lucide-react';
import { cn } from '../lib/utils';
import { apiFetch } from '../lib/api';
import { BackButton } from './BackButton';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TickerItem { symbol: string; price: number; change: number; changePercent: number; }

interface SignalValue { value: number; signal: string; }
interface AnswerSignal { answer: string; signal: string; }
interface WeightEntry { weight: number; label: string; }

interface TerminalData {
  ticker: TickerItem[];
  decision: { shouldTrade: boolean; score: number; label: string };
  volatility: {
    score: number; vixLevel: number; vixTrend: string; vixTrendSignal: string;
    vixIvPercentile: number; vixIvSignal: string; putCallRatio: number; putCallSignal: string;
  };
  trend: {
    score: number; spxVs20d: SignalValue; spxVs50d: SignalValue; spxVs200d: SignalValue;
    qqqTrend: string; regime: string;
  };
  breadth: {
    score: number; pctAbove50d: number; pctAbove50dSignal: string;
    pctAbove200d: number; pctAbove200dSignal: string;
    nyseAd: number; nyseAdSignal: string; newHighsLows: string; newHighsLowsSignal: string;
  };
  momentum: {
    score: number; sectorsPositive: number; sectorsTotal: number; sectorsSignal: string;
    leader: { name: string; change: number }; laggard: { name: string; change: number };
    participation: string;
  };
  macro: {
    score: number; fomc: string; fomcSignal: string; tenYearYield: number; tenYearSignal: string;
    dxy: number; dxySignal: string; fedStance: string; geopolitical: string;
  };
  executionWindow: {
    score: number;
    breakoutsWorking: AnswerSignal; leadersHolding: AnswerSignal;
    pullbacksBought: AnswerSignal; followThrough: AnswerSignal;
  };
  sectors: { name: string; symbol: string; change: number }[];
  scoringWeights: Record<string, WeightEntry>;
  updatedAt: string;
}

type TradeMode = 'long' | 'short';

// ─── Short-mode score inverter ──────────────────────────────────────────────

function invertForShort(data: TerminalData): TerminalData {
  const inv = (score: number) => 100 - score;
  const flipSignal = (s: string) => {
    const map: Record<string, string> = {
      strong: 'weak', weak: 'strong', positive: 'negative', negative: 'positive',
      intact: 'broken', good: 'poor', poor: 'good', working: 'failing', failing: 'working',
      holding: 'fading', fading: 'holding', rising: 'falling', falling: 'rising',
      uptrend: 'downtrend', broad: 'narrow', low: 'elevated', elevated: 'low',
      support: 'breakdown', conviction: 'exhaustion', strengthening: 'weakening', weakening: 'strengthening',
    };
    return map[s.toLowerCase()] || s;
  };
  const flipSv = (sv: SignalValue): SignalValue => ({ value: sv.value, signal: flipSignal(sv.signal) });

  const volScore = inv(data.volatility.score);
  const trendScore = inv(data.trend.score);
  const breadthScore = inv(data.breadth.score);
  const momentumScore = inv(data.momentum.score);
  const macroScore = data.macro.score;
  const execScore = inv(data.executionWindow.score);

  const totalScore = Math.round(
    volScore * 0.20 + trendScore * 0.25 + breadthScore * 0.20 + momentumScore * 0.20 + macroScore * 0.15
  );

  return {
    ...data,
    decision: {
      shouldTrade: totalScore >= 60,
      score: totalScore,
      label: totalScore >= 60 ? 'Short Setup' : totalScore >= 40 ? 'Caution' : 'Avoid Shorting',
    },
    volatility: { ...data.volatility, score: volScore, vixTrendSignal: flipSignal(data.volatility.vixTrendSignal), putCallSignal: flipSignal(data.volatility.putCallSignal) },
    trend: { ...data.trend, score: trendScore, spxVs20d: flipSv(data.trend.spxVs20d), spxVs50d: flipSv(data.trend.spxVs50d), spxVs200d: flipSv(data.trend.spxVs200d) },
    breadth: { ...data.breadth, score: breadthScore, pctAbove50dSignal: flipSignal(data.breadth.pctAbove50dSignal), pctAbove200dSignal: flipSignal(data.breadth.pctAbove200dSignal), nyseAdSignal: flipSignal(data.breadth.nyseAdSignal), newHighsLowsSignal: flipSignal(data.breadth.newHighsLowsSignal) },
    momentum: { ...data.momentum, score: momentumScore, sectorsPositive: data.momentum.sectorsTotal - data.momentum.sectorsPositive, sectorsSignal: flipSignal(data.momentum.sectorsSignal), leader: data.momentum.laggard, laggard: data.momentum.leader, participation: flipSignal(data.momentum.participation) },
    macro: { ...data.macro, score: macroScore },
    executionWindow: {
      score: execScore,
      breakoutsWorking: { answer: data.executionWindow.breakoutsWorking.answer === 'Yes' ? 'No' : 'Yes', signal: flipSignal(data.executionWindow.breakoutsWorking.signal) },
      leadersHolding: { answer: data.executionWindow.leadersHolding.answer === 'Yes' ? 'No' : 'Yes', signal: flipSignal(data.executionWindow.leadersHolding.signal) },
      pullbacksBought: { answer: data.executionWindow.pullbacksBought.answer === 'Yes' ? 'No' : 'Yes', signal: flipSignal(data.executionWindow.pullbacksBought.signal) },
      followThrough: { answer: data.executionWindow.followThrough.answer, signal: flipSignal(data.executionWindow.followThrough.signal) },
    },
    scoringWeights: {
      volatility: { weight: Math.round(volScore * 0.20), label: `+${Math.round(volScore * 0.20)}` },
      momentum: { weight: Math.round(momentumScore * 0.20), label: `+${Math.round(momentumScore * 0.20)}` },
      trend: { weight: Math.round(trendScore * 0.25), label: `+${Math.round(trendScore * 0.25)}` },
      breadth: { weight: Math.round(breadthScore * 0.20), label: `+${Math.round(breadthScore * 0.20)}` },
      macro: { weight: Math.round(macroScore * 0.15), label: `+${Math.round(macroScore * 0.15)}` },
    },
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function signalColor(signal: string): string {
  const s = signal.toLowerCase();
  if (['strong', 'positive', 'intact', 'good', 'working', 'holding', 'support', 'conviction', 'low', 'falling', 'uptrend', 'broad'].includes(s))
    return 'text-emerald-400';
  if (['neutral', 'normal', 'moderate', 'stable', 'caution', 'correcting'].includes(s))
    return 'text-amber-400';
  return 'text-red-400';
}

function signalDot(signal: string): string {
  const s = signal.toLowerCase();
  if (['strong', 'positive', 'intact', 'good', 'working', 'holding', 'support', 'conviction', 'low', 'falling', 'uptrend', 'broad'].includes(s))
    return 'bg-emerald-400';
  if (['neutral', 'normal', 'moderate', 'stable', 'caution', 'correcting'].includes(s))
    return 'bg-amber-400';
  return 'bg-red-400';
}

function scoreBorderColor(score: number): string {
  if (score >= 60) return 'border-emerald-500/20';
  if (score >= 40) return 'border-amber-500/20';
  return 'border-red-500/20';
}

function scoreGlowColor(score: number): string {
  if (score >= 60) return 'rgba(16,185,129,0.15)';
  if (score >= 40) return 'rgba(245,158,11,0.15)';
  return 'rgba(239,68,68,0.15)';
}

function scoreStrokeColor(score: number): string {
  if (score >= 60) return '#10b981';
  if (score >= 40) return '#f59e0b';
  return '#ef4444';
}

// ─── SVG Circle Gauge ─────────────────────────────────────────────────────────

const CircleGauge = ({ score, size = 80, strokeWidth = 6, label }: { score: number; size?: number; strokeWidth?: number; label?: string }) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color = scoreStrokeColor(score);

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#1f1f1f" strokeWidth={strokeWidth} />
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none"
          stroke={color} strokeWidth={strokeWidth} strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 1s ease-in-out' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-mono font-bold text-white" style={{ fontSize: size * 0.28 }}>{score}</span>
        {label && <span className="font-mono text-gray-500 uppercase" style={{ fontSize: size * 0.11 }}>{label}</span>}
      </div>
    </div>
  );
};

// ─── Mini Gauge Card ──────────────────────────────────────────────────────────

const GaugeCard = ({ title, score }: { title: string; score: number }) => (
  <div className={cn('border rounded px-3 py-2 bg-[#0d0d0d] flex flex-col items-center gap-1', scoreBorderColor(score))}>
    <span className="font-mono text-[8px] uppercase tracking-widest text-gray-500">{title}</span>
    <CircleGauge score={score} size={52} strokeWidth={4} />
  </div>
);

// ─── Detail Panel ─────────────────────────────────────────────────────────────

const DetailPanel = ({ title, score, children }: { title: string; score: number; children: React.ReactNode }) => (
  <div
    className={cn('border rounded bg-[#0d0d0d] overflow-hidden', scoreBorderColor(score))}
    style={{ boxShadow: `0 0 20px ${scoreGlowColor(score)}` }}
  >
    <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
      <span className="font-mono text-[9px] uppercase tracking-widest text-gray-400">{title}</span>
      <span
        className="font-mono text-[10px] font-bold px-2 py-0.5 rounded"
        style={{ color: scoreStrokeColor(score), backgroundColor: `${scoreStrokeColor(score)}15` }}
      >
        {score}/100
      </span>
    </div>
    <div className="px-3 py-2 space-y-1.5">{children}</div>
  </div>
);

// ─── Line Item ────────────────────────────────────────────────────────────────

const LineItem = ({ label, value, signal }: { label: string; value: string | number; signal?: string }) => (
  <div className="flex items-center justify-between font-mono text-[10px]">
    <span className="text-gray-500 uppercase">{label}</span>
    <div className="flex items-center gap-2">
      <span className="text-gray-300">{value}</span>
      {signal && (
        <div className="flex items-center gap-1">
          <div className={cn('w-1.5 h-1.5 rounded-full', signalDot(signal))} />
          <span className={cn('text-[9px] uppercase', signalColor(signal))}>{signal}</span>
        </div>
      )}
    </div>
  </div>
);

// ─── Sector Bar ───────────────────────────────────────────────────────────────

const SectorBar = ({ name, change, maxAbs }: { name: string; change: number; maxAbs: number }) => {
  const pct = maxAbs > 0 ? Math.abs(change) / maxAbs * 100 : 0;
  const isPos = change >= 0;
  return (
    <div className="flex items-center gap-2 font-mono text-[9px]">
      <span className="w-20 text-gray-500 uppercase text-right shrink-0">{name}</span>
      <div className="flex-1 h-3 bg-[#111] rounded-sm relative overflow-hidden">
        {isPos ? (
          <div className="absolute left-1/2 h-full rounded-sm" style={{ width: `${pct / 2}%`, background: 'linear-gradient(90deg, #10b981, #059669)' }} />
        ) : (
          <div className="absolute h-full rounded-sm" style={{ width: `${pct / 2}%`, right: '50%', background: 'linear-gradient(270deg, #ef4444, #991b1b)' }} />
        )}
        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-gray-700" />
      </div>
      <span className={cn('w-12 text-right', isPos ? 'text-emerald-400' : 'text-red-400')}>
        {isPos ? '+' : ''}{change.toFixed(2)}%
      </span>
    </div>
  );
};

// ─── Weight Bar ───────────────────────────────────────────────────────────────

const WeightBar = ({ label, value, max }: { label: string; value: number; max: number }) => {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="flex items-center gap-2 font-mono text-[9px]">
      <span className="w-16 text-gray-500 uppercase shrink-0">{label}</span>
      <div className="flex-1 h-3 bg-[#111] rounded-sm overflow-hidden">
        <div
          className="h-full rounded-sm"
          style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #f7931a, #f59e0b)' }}
        />
      </div>
      <span className="w-8 text-right text-btc-orange">+{value}</span>
    </div>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────

export const Terminal = () => {
  const [rawData, setRawData] = useState<TerminalData | null>(null);
  const [mode, setMode] = useState<TradeMode>('long');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Derive displayed data from mode
  const data = rawData ? (mode === 'short' ? invertForShort(rawData) : rawData) : null;

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/terminal');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setRawData(json);
      setLastRefresh(new Date());
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const fetchAnalysis = useCallback(async () => {
    if (analysis) return;
    setAnalysisLoading(true);
    try {
      const res = await apiFetch('/api/terminal/analysis');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setAnalysis(json.text);
    } catch {
      setAnalysis('Failed to load analysis.');
    } finally {
      setAnalysisLoading(false);
    }
  }, [analysis]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(() => fetchData(true), 60000);
    return () => clearInterval(interval);
  }, [fetchData]);

  useEffect(() => {
    if (analysisOpen && !analysis && !analysisLoading) fetchAnalysis();
  }, [analysisOpen, analysis, analysisLoading, fetchAnalysis]);

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="animate-spin text-btc-orange" size={28} />
          <span className="font-mono text-[10px] uppercase tracking-widest text-gray-500">Loading Terminal Data...</span>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-center">
          <AlertTriangle className="text-red-400" size={28} />
          <span className="font-mono text-[10px] uppercase tracking-widest text-red-400">Terminal Error</span>
          <span className="font-mono text-[9px] text-gray-500 max-w-xs">{error || 'No data available'}</span>
          <button onClick={() => fetchData()} className="mt-2 px-4 py-1.5 border border-btc-orange/30 text-btc-orange font-mono text-[9px] uppercase tracking-widest hover:bg-btc-orange/10 transition-colors">
            Retry
          </button>
        </div>
      </div>
    );
  }

  const d = data;
  const maxSectorAbs = Math.max(...d.sectors.map(s => Math.abs(s.change)), 0.01);
  const totalWeightMax = Object.values(d.scoringWeights).reduce((a, w) => a + w.weight, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <BackButton />
        <div className="flex items-center gap-3">
          {lastRefresh && (
            <span className="font-mono text-[8px] text-gray-600 uppercase">
              Updated {lastRefresh.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={() => fetchData(true)}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-btc-orange/20 text-btc-orange/70 font-mono text-[9px] uppercase tracking-widest hover:bg-btc-orange/10 transition-colors disabled:opacity-30"
          >
            <RefreshCw size={10} className={refreshing ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* Title + Mode Toggle */}
      <div className="flex items-center gap-3 mb-2">
        <Activity size={16} className="text-btc-orange" />
        <h1 className="font-mono text-sm font-bold uppercase tracking-[0.2em] text-white">Market Quality Terminal</h1>

        {/* Long / Short toggle */}
        <div className="flex border border-white/10 rounded overflow-hidden ml-2">
          <button
            onClick={() => setMode('long')}
            className={cn(
              'px-4 py-1.5 font-mono text-[9px] font-bold uppercase tracking-widest transition-colors',
              mode === 'long'
                ? 'bg-emerald-500/20 text-emerald-400 border-r border-white/10'
                : 'text-gray-600 hover:text-gray-400 border-r border-white/10'
            )}
          >Long</button>
          <button
            onClick={() => setMode('short')}
            className={cn(
              'px-4 py-1.5 font-mono text-[9px] font-bold uppercase tracking-widest transition-colors',
              mode === 'short'
                ? 'bg-red-500/20 text-red-400'
                : 'text-gray-600 hover:text-gray-400'
            )}
          >Short</button>
        </div>

        <div className="flex-1 border-t border-btc-orange/10" />
        <span className="font-mono text-[8px] text-gray-600 uppercase">
          {mode === 'long' ? 'Should I Go Long?' : 'Should I Go Short?'}
        </span>
      </div>

      {/* A. Ticker Bar */}
      <div className="flex gap-4 overflow-x-auto py-2 px-3 bg-[#0d0d0d] border border-white/5 rounded scrollbar-none">
        {d.ticker.map(t => (
          <div key={t.symbol} className="flex items-center gap-2 shrink-0 font-mono text-[10px]">
            <span className="text-gray-500 font-bold">{t.symbol}</span>
            <span className="text-white">{t.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            <span className={t.changePercent >= 0 ? 'text-emerald-400' : 'text-red-400'}>
              {t.changePercent >= 0 ? '+' : ''}{(t.changePercent * 100).toFixed(2)}%
            </span>
            <div className="w-px h-3 bg-white/10" />
          </div>
        ))}
      </div>

      {/* B. Decision + Gauges */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-4">
        {/* Decision Box */}
        <div
          className={cn('border rounded p-6 bg-[#0d0d0d] flex items-center gap-6', scoreBorderColor(d.decision.score))}
          style={{ boxShadow: `0 0 30px ${scoreGlowColor(d.decision.score)}` }}
        >
          <CircleGauge score={d.decision.score} size={110} strokeWidth={8} label="SCORE" />
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[8px] uppercase tracking-[0.3em] text-gray-500">
              {mode === 'long' ? 'Should I Go Long?' : 'Should I Go Short?'}
            </span>
            <span
              className="font-mono text-3xl font-black uppercase tracking-wider"
              style={{ color: scoreStrokeColor(d.decision.score), textShadow: `0 0 20px ${scoreStrokeColor(d.decision.score)}40` }}
            >
              {d.decision.score >= 60 ? 'YES' : d.decision.score >= 40 ? 'CAUTION' : 'NO'}
            </span>
            <span className="font-mono text-[10px] text-gray-500">{d.decision.label}</span>
          </div>
          <div className="ml-auto flex flex-col items-end gap-1">
            <span className="font-mono text-[8px] uppercase tracking-widest text-gray-600">Position Size</span>
            <span className="font-mono text-lg font-bold text-white">
              {d.decision.score >= 60 ? '100%' : d.decision.score >= 50 ? '50%' : d.decision.score >= 40 ? '25%' : '0%'}
            </span>
            <span className="font-mono text-[8px] text-gray-600 uppercase">of normal</span>
          </div>
        </div>

        {/* Gauge Row */}
        <div className="flex gap-2 flex-wrap lg:flex-nowrap">
          <GaugeCard title="Volatility" score={d.volatility.score} />
          <GaugeCard title="Trend" score={d.trend.score} />
          <GaugeCard title="Breadth" score={d.breadth.score} />
          <GaugeCard title="Momentum" score={d.momentum.score} />
          <GaugeCard title="Macro" score={d.macro.score} />
        </div>
      </div>

      {/* C. Alert Banner */}
      {(d.macro.fomcSignal === 'event-risk' || d.macro.fomcSignal === 'caution') && (
        <div className={cn(
          'flex items-center gap-3 px-4 py-2.5 rounded font-mono text-[10px] uppercase tracking-widest border',
          d.macro.fomcSignal === 'event-risk'
            ? 'bg-red-500/10 border-red-500/30 text-red-400'
            : 'bg-amber-500/10 border-amber-500/30 text-amber-400'
        )}>
          <AlertTriangle size={14} />
          <span className="font-bold">FOMC: {d.macro.fomc}</span>
          <span className="text-gray-500">|</span>
          <span>Expect elevated volatility — reduce position sizes</span>
        </div>
      )}

      {/* D. Detail Panels (2x3 grid) */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {/* Volatility */}
        <DetailPanel title="Volatility" score={d.volatility.score}>
          <LineItem label="VIX Level" value={d.volatility.vixLevel} signal={d.volatility.vixLevel > 25 ? 'elevated' : d.volatility.vixLevel > 20 ? 'normal' : 'low'} />
          <LineItem label="VIX Trend" value={d.volatility.vixTrend} signal={d.volatility.vixTrendSignal} />
          <LineItem label="IV Percentile" value={`${d.volatility.vixIvPercentile}%`} signal={d.volatility.vixIvSignal} />
          <LineItem label="Put/Call Ratio" value={d.volatility.putCallRatio} signal={d.volatility.putCallSignal} />
        </DetailPanel>

        {/* Trend */}
        <DetailPanel title="Trend" score={d.trend.score}>
          <LineItem label="SPX vs 20d MA" value={`${d.trend.spxVs20d.value > 0 ? '+' : ''}${d.trend.spxVs20d.value}%`} signal={d.trend.spxVs20d.signal} />
          <LineItem label="SPX vs 50d MA" value={`${d.trend.spxVs50d.value > 0 ? '+' : ''}${d.trend.spxVs50d.value}%`} signal={d.trend.spxVs50d.signal} />
          <LineItem label="SPX vs 200d MA" value={`${d.trend.spxVs200d.value > 0 ? '+' : ''}${d.trend.spxVs200d.value}%`} signal={d.trend.spxVs200d.signal} />
          <LineItem label="QQQ Trend" value={d.trend.qqqTrend} signal={d.trend.qqqTrend} />
          <LineItem label="Regime" value={d.trend.regime} signal={d.trend.regime} />
        </DetailPanel>

        {/* Breadth */}
        <DetailPanel title="Breadth" score={d.breadth.score}>
          <LineItem label="% Above 50d MA" value={`${d.breadth.pctAbove50d}%`} signal={d.breadth.pctAbove50dSignal} />
          <LineItem label="% Above 200d MA" value={`${d.breadth.pctAbove200d}%`} signal={d.breadth.pctAbove200dSignal} />
          <LineItem label="NYSE A/D" value={d.breadth.nyseAd > 0 ? `+${d.breadth.nyseAd}` : d.breadth.nyseAd} signal={d.breadth.nyseAdSignal} />
          <LineItem label="New Highs/Lows" value={d.breadth.newHighsLows} signal={d.breadth.newHighsLowsSignal} />
        </DetailPanel>

        {/* Momentum */}
        <DetailPanel title="Momentum" score={d.momentum.score}>
          <LineItem label="Sectors Positive" value={`${d.momentum.sectorsPositive}/${d.momentum.sectorsTotal}`} signal={d.momentum.sectorsSignal} />
          <LineItem label="Leader" value={`${d.momentum.leader.name} (${d.momentum.leader.change > 0 ? '+' : ''}${d.momentum.leader.change}%)`} signal="positive" />
          <LineItem label="Laggard" value={`${d.momentum.laggard.name} (${d.momentum.laggard.change > 0 ? '+' : ''}${d.momentum.laggard.change}%)`} signal="negative" />
          <LineItem label="Participation" value={d.momentum.participation} signal={d.momentum.participation === 'broad' ? 'strong' : d.momentum.participation === 'moderate' ? 'neutral' : 'weak'} />
        </DetailPanel>

        {/* Macro */}
        <DetailPanel title="Macro" score={d.macro.score}>
          <LineItem label="FOMC" value={d.macro.fomc} signal={d.macro.fomcSignal} />
          <LineItem label="10Y Yield" value={`${d.macro.tenYearYield}%`} signal={d.macro.tenYearSignal} />
          <LineItem label="DXY" value={d.macro.dxy} signal={d.macro.dxySignal} />
          <LineItem label="Fed Stance" value={d.macro.fedStance} />
          <LineItem label="Geopolitical" value={d.macro.geopolitical} signal="caution" />
        </DetailPanel>

        {/* Execution Window */}
        <DetailPanel title="Execution Window" score={d.executionWindow.score}>
          <LineItem label="Breakouts Working?" value={d.executionWindow.breakoutsWorking.answer} signal={d.executionWindow.breakoutsWorking.signal} />
          <LineItem label="Leaders Holding?" value={d.executionWindow.leadersHolding.answer} signal={d.executionWindow.leadersHolding.signal} />
          <LineItem label="Pullbacks Bought?" value={d.executionWindow.pullbacksBought.answer} signal={d.executionWindow.pullbacksBought.signal} />
          <LineItem label="Follow Through" value={d.executionWindow.followThrough.answer} signal={d.executionWindow.followThrough.signal} />
        </DetailPanel>
      </div>

      {/* E. Bottom Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Execution Summary */}
        <div className="border border-white/5 rounded bg-[#0d0d0d] p-3">
          <div className="font-mono text-[9px] uppercase tracking-widest text-gray-500 mb-3">Execution Summary</div>
          <div className="space-y-2">
            {[
              { label: 'Breakouts', ...d.executionWindow.breakoutsWorking },
              { label: 'Leaders', ...d.executionWindow.leadersHolding },
              { label: 'Pullbacks', ...d.executionWindow.pullbacksBought },
              { label: 'Follow-Through', ...d.executionWindow.followThrough },
            ].map(item => (
              <div key={item.label} className="flex items-center justify-between font-mono text-[10px]">
                <span className="text-gray-500 uppercase">{item.label}</span>
                <div className="flex items-center gap-2">
                  <span className={cn(
                    'px-2 py-0.5 rounded text-[8px] font-bold uppercase',
                    item.answer === 'Yes' || item.answer === 'Strong'
                      ? 'bg-emerald-500/10 text-emerald-400'
                      : item.answer === 'Weak'
                        ? 'bg-amber-500/10 text-amber-400'
                        : 'bg-red-500/10 text-red-400'
                  )}>
                    {item.answer}
                  </span>
                  <span className={cn('text-[8px] uppercase', signalColor(item.signal))}>{item.signal}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Sector Performance */}
        <div className="border border-white/5 rounded bg-[#0d0d0d] p-3">
          <div className="font-mono text-[9px] uppercase tracking-widest text-gray-500 mb-3">Sector Performance (5d)</div>
          <div className="space-y-1">
            {d.sectors.map(s => (
              <SectorBar key={s.symbol} name={s.name} change={s.change} maxAbs={maxSectorAbs} />
            ))}
          </div>
        </div>

        {/* Scoring Weights */}
        <div className="border border-white/5 rounded bg-[#0d0d0d] p-3">
          <div className="font-mono text-[9px] uppercase tracking-widest text-gray-500 mb-3">Scoring Breakdown</div>
          <div className="space-y-2">
            {Object.entries(d.scoringWeights).map(([key, w]) => (
              <WeightBar key={key} label={key} value={w.weight} max={25} />
            ))}
          </div>
          <div className="mt-3 pt-2 border-t border-white/5 flex items-center justify-between font-mono">
            <span className="text-[9px] uppercase tracking-widest text-gray-500">Total Score</span>
            <span className="text-lg font-bold" style={{ color: scoreStrokeColor(d.decision.score) }}>
              {d.decision.score}<span className="text-[10px] text-gray-600">/100</span>
            </span>
          </div>
        </div>
      </div>

      {/* F. Terminal Analysis */}
      <div className="border border-white/5 rounded bg-[#0d0d0d] overflow-hidden">
        <button
          onClick={() => setAnalysisOpen(!analysisOpen)}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.02] transition-colors"
        >
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-btc-orange animate-pulse" />
            <span className="font-mono text-[9px] uppercase tracking-widest text-gray-400">AI Terminal Analysis</span>
          </div>
          {analysisOpen ? <ChevronUp size={14} className="text-gray-500" /> : <ChevronDown size={14} className="text-gray-500" />}
        </button>
        {analysisOpen && (
          <div className="px-4 pb-4 border-t border-white/5">
            {analysisLoading ? (
              <div className="flex items-center gap-2 py-4">
                <Loader2 className="animate-spin text-btc-orange" size={14} />
                <span className="font-mono text-[10px] text-gray-500 uppercase">Generating analysis...</span>
              </div>
            ) : analysis ? (
              <div className="font-mono text-[11px] text-gray-400 leading-relaxed whitespace-pre-wrap pt-3">
                {analysis}
              </div>
            ) : (
              <span className="font-mono text-[10px] text-gray-600">No analysis available.</span>
            )}
          </div>
        )}
      </div>

      {/* Footer timestamp */}
      <div className="text-center font-mono text-[8px] text-gray-600 uppercase tracking-widest pb-4">
        Data as of {new Date(d.updatedAt).toLocaleString()} — Refreshes every 60s — Cached 5 min server-side
      </div>
    </div>
  );
};
