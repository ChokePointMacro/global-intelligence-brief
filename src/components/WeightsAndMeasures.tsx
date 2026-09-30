import { useEffect, useMemo, useState } from 'react';
import { Loader2, RotateCcw, Save, Check, SlidersHorizontal, TrendingUp } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { BackButton } from './BackButton';
import {
  DEFAULT_WEIGHTS, WEIGHT_META, normaliseWeights, scorePost,
  type ScoringWeights, type SampleRow,
} from '../services/scoring';

const GROUPS = [
  { id: 'engagement', title: 'Interaction values', blurb: 'What each interaction type is worth relative to the others.' },
  { id: 'dimension', title: 'Performance dimensions', blurb: 'Each is normalised 0–1 before weighting, so these sliders are directly comparable.' },
  { id: 'shape', title: 'Shape', blurb: 'How aggressively recency is favoured, and the noise floor for rate-based measures.' },
] as const;

const DIMENSION_COLORS: Record<string, string> = {
  engagementRate: '#f7931a',
  virality: '#38bdf8',
  conversation: '#a78bfa',
  reference: '#4ade80',
  velocity: '#fbbf24',
  trendHopping: '#f472b6',
  reach: '#94a3b8',
};

export const WeightsAndMeasures = () => {
  const [weights, setWeights] = useState<ScoringWeights>(DEFAULT_WEIGHTS);
  const [saved, setSaved] = useState<ScoringWeights>(DEFAULT_WEIGHTS);
  const [samples, setSamples] = useState<SampleRow[]>([]);
  const [lastSampledAt, setLastSampledAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [wRes, sRes] = await Promise.all([
          apiFetch('/api/scoring-weights'),
          apiFetch('/api/audience-samples?limit=400'),
        ]);
        if (wRes.ok) { const d = await wRes.json(); setWeights(normaliseWeights(d.weights)); setSaved(normaliseWeights(d.weights)); }
        if (sRes.ok) { const d = await sRes.json(); setSamples(d.samples || []); setLastSampledAt(d.lastSampledAt || null); }
      } finally { setLoading(false); }
    })();
  }, []);

  // Freeze "now" for the session so ranks don't drift while the user drags sliders.
  const now = useMemo(() => Date.now(), []);

  const ranked = useMemo(() => {
    return samples
      .map((s) => ({ sample: s, ...scorePost(s, weights, now) }))
      .sort((a, b) => b.score - a.score);
  }, [samples, weights, now]);

  const baseline = useMemo(() => {
    const order = samples
      .map((s) => ({ id: s.tweet_id, ...scorePost(s, saved, now) }))
      .sort((a, b) => b.score - a.score)
      .map((r) => r.id);
    return new Map(order.map((id, i) => [id, i]));
  }, [samples, saved, now]);

  const dirty = JSON.stringify(weights) !== JSON.stringify(saved);
  const top = ranked.slice(0, 12);
  const maxScore = Math.max(...top.map((r) => r.score), 0.0001);

  const save = async () => {
    setSaving(true);
    try {
      const res = await apiFetch('/api/scoring-weights', { method: 'PUT', body: JSON.stringify({ weights }) });
      if (res.ok) { const d = await res.json(); setSaved(normaliseWeights(d.weights)); setJustSaved(true); setTimeout(() => setJustSaved(false), 1800); }
    } finally { setSaving(false); }
  };

  const reset = async () => {
    const res = await apiFetch('/api/scoring-weights/reset', { method: 'POST' });
    if (res.ok) { setWeights({ ...DEFAULT_WEIGHTS }); setSaved({ ...DEFAULT_WEIGHTS }); }
  };

  if (loading) {
    return <div className="min-h-[60vh] flex items-center justify-center"><Loader2 className="animate-spin text-btc-orange" size={28} /></div>;
  }

  return (
    <div className="max-w-[1400px] mx-auto px-6 py-8">
      <BackButton />

      <div className="flex items-start justify-between flex-wrap gap-4 mb-2">
        <div>
          <h1 className="font-serif italic text-4xl text-white">Weights &amp; Measures</h1>
          <p className="text-[10px] font-mono uppercase tracking-widest text-white/30 mt-2">
            Tune how performance is scored — changes preview live against the sampled audience
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={reset}
            className="flex items-center gap-2 px-3 py-2 border border-white/10 text-white/40 text-[10px] font-mono uppercase tracking-widest hover:text-white/70 transition-colors">
            <RotateCcw size={11} /> Defaults
          </button>
          <button onClick={save} disabled={!dirty || saving}
            className="flex items-center gap-2 px-4 py-2 border border-btc-orange/40 bg-btc-orange/10 text-btc-orange text-[10px] font-mono uppercase tracking-widest hover:bg-btc-orange/20 transition-all disabled:opacity-25">
            {saving ? <Loader2 size={11} className="animate-spin" /> : justSaved ? <Check size={11} /> : <Save size={11} />}
            {justSaved ? 'Saved' : dirty ? 'Save weights' : 'Saved'}
          </button>
        </div>
      </div>

      {samples.length === 0 && (
        <div className="border border-btc-orange/20 bg-btc-orange/5 p-4 my-6">
          <p className="text-[11px] font-mono text-btc-orange/80 uppercase tracking-widest mb-1">No audience sample yet</p>
          <p className="text-xs text-white/50 leading-relaxed">
            Sliders save and apply immediately, but there is nothing to rank until the weekly sampler runs.
            Execute <code className="text-btc-orange/70">node x-weekly-sample.js</code> with <code className="text-btc-orange/70">X_BEARER_TOKEN</code> set.
            Until then the preview below stays empty — it is not broken.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] gap-8 mt-8">
        {/* ── Sliders ── */}
        <div className="space-y-8">
          {GROUPS.map((g) => (
            <div key={g.id}>
              <div className="flex items-center gap-2 mb-1">
                <SlidersHorizontal size={12} className="text-btc-orange/60" />
                <h2 className="text-[10px] font-mono uppercase tracking-widest text-btc-orange/80">{g.title}</h2>
              </div>
              <p className="text-[10px] text-white/25 mb-4 leading-relaxed">{g.blurb}</p>

              <div className="space-y-5">
                {WEIGHT_META.filter((m) => m.group === g.id).map((m) => {
                  const val = weights[m.key];
                  const isDefault = val === DEFAULT_WEIGHTS[m.key];
                  const color = DIMENSION_COLORS[m.key] ?? '#f7931a';
                  return (
                    <div key={m.key}>
                      <div className="flex items-baseline justify-between mb-1.5">
                        <label className="text-[11px] font-mono text-white/70 flex items-center gap-1.5">
                          {g.id === 'dimension' && <span className="w-2 h-2 rounded-full" style={{ background: color }} />}
                          {m.label}
                        </label>
                        <span className={`text-[11px] font-mono tabular-nums ${isDefault ? 'text-white/30' : 'text-btc-orange'}`}>
                          {val}{!isDefault && <span className="text-white/20 ml-1">({DEFAULT_WEIGHTS[m.key]})</span>}
                        </span>
                      </div>
                      <input
                        type="range" min={m.min} max={m.max} step={m.step} value={val}
                        onChange={(e) => setWeights((p) => ({ ...p, [m.key]: Number(e.target.value) }))}
                        className="w-full accent-btc-orange h-1 bg-white/10 appearance-none cursor-pointer"
                        style={{ accentColor: color }}
                      />
                      <p className="text-[9px] text-white/25 mt-1 leading-relaxed">{m.help}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* ── Live preview ── */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <TrendingUp size={12} className="text-btc-orange/60" />
              <h2 className="text-[10px] font-mono uppercase tracking-widest text-btc-orange/80">Live ranking</h2>
            </div>
            <span className="text-[9px] font-mono text-white/25">
              {samples.length} sampled{lastSampledAt ? ` · last ${new Date(lastSampledAt).toLocaleDateString()}` : ''}
            </span>
          </div>
          <p className="text-[10px] text-white/25 mb-4 leading-relaxed">
            Bars show each dimension&apos;s contribution to the total. Arrows show rank movement versus your saved weights.
          </p>

          <div className="space-y-2">
            {top.map((r, i) => {
              const prev = baseline.get(r.sample.tweet_id);
              const delta = prev === undefined ? 0 : prev - i;
              const dims = Object.entries(r.contributions).filter(([, v]) => v > 0);
              const total = dims.reduce((a, [, v]) => a + v, 0) || 1;
              return (
                <div key={r.sample.tweet_id} className="border border-white/5 hover:border-white/10 bg-white/[0.015] p-3 transition-colors">
                  <div className="flex items-start gap-3">
                    <span className="text-[11px] font-mono text-white/25 tabular-nums w-5 pt-0.5">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-[11px] font-mono text-sky-400/80">@{r.sample.username ?? '—'}</span>
                        {delta !== 0 && (
                          <span className={`text-[9px] font-mono ${delta > 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {delta > 0 ? `▲${delta}` : `▼${Math.abs(delta)}`}
                          </span>
                        )}
                        <span className="text-[9px] font-mono text-white/20">
                          {r.sample.impressions.toLocaleString()} imp · {r.engagementRate}% · {r.sample.chars ?? r.sample.text.length}c · {r.sample.hashtag_count ?? 0}#
                        </span>
                        <span className="text-[10px] font-mono text-btc-orange ml-auto tabular-nums">{r.score.toFixed(3)}</span>
                      </div>

                      {/* Stacked contribution bar — where this post's score actually comes from */}
                      <div className="flex h-1.5 w-full overflow-hidden mb-1.5" style={{ opacity: 0.9 }}>
                        {dims.map(([k, v]) => (
                          <div key={k} title={`${k}: ${v.toFixed(3)}`}
                            style={{ width: `${(v / total) * 100}%`, background: DIMENSION_COLORS[k] ?? '#666' }} />
                        ))}
                      </div>
                      <div className="h-px w-full bg-white/5 mb-1.5">
                        <div className="h-px bg-btc-orange/40" style={{ width: `${(r.score / maxScore) * 100}%` }} />
                      </div>

                      <p className="text-[11px] text-white/45 leading-snug line-clamp-2">
                        {r.sample.text.replace(/\s+/g, ' ').slice(0, 150)}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-3 mt-4 pt-3 border-t border-white/5">
            {Object.entries(DIMENSION_COLORS).map(([k, c]) => (
              <span key={k} className="flex items-center gap-1.5 text-[9px] font-mono text-white/30">
                <span className="w-2 h-2 rounded-full" style={{ background: c }} />
                {WEIGHT_META.find((m) => m.key === k)?.label ?? k}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
