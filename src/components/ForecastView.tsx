import React, { useState, useRef } from 'react';
import { ChevronRight, Download, Loader2 } from 'lucide-react';
import html2canvas from 'html2canvas';
import JSZip from 'jszip';
import { cn } from '../lib/utils';
import { CPMLogoImg } from './CPMLogo';
import type { ForecastReport } from '../services/geminiService';

const RISK_LEVEL_CONFIG: Record<string, { color: string; bg: string }> = {
  LOW:      { color: 'text-green-400',  bg: 'bg-green-400/10 border-green-400/30' },
  MODERATE: { color: 'text-yellow-400', bg: 'bg-yellow-400/10 border-yellow-400/30' },
  ELEVATED: { color: 'text-orange-400', bg: 'bg-orange-400/10 border-orange-400/30' },
  HIGH:     { color: 'text-red-400',    bg: 'bg-red-400/10 border-red-400/30' },
  CRITICAL: { color: 'text-red-500',    bg: 'bg-red-500/15 border-red-500/40' },
};

const SENTIMENT_FORECAST_CONFIG: Record<string, { color: string; label: string }> = {
  'risk-on':         { color: 'text-green-400',  label: 'Risk-On' },
  'risk-off':        { color: 'text-red-400',    label: 'Risk-Off' },
  'neutral':         { color: 'text-gray-400',   label: 'Neutral' },
  'escalating':      { color: 'text-orange-400', label: 'Escalating' },
  'de-escalating':   { color: 'text-blue-400',   label: 'De-Escalating' },
};

export const ForecastView = ({ report, accentHex = '#facc15' }: { report: ForecastReport; accentHex?: string }) => {
  const [expanded, setExpanded] = useState<number | null>(0);
  const [exportingForecast, setExportingForecast] = useState(false);
  const [exportIdx, setExportIdx] = useState(-1);
  const forecastSlideRef = useRef<HTMLDivElement>(null);
  const risk = RISK_LEVEL_CONFIG[report.analysis.overallRiskLevel] ?? RISK_LEVEL_CONFIG['MODERATE'];

  const slugify = (text: string, maxWords = 5) =>
    text.trim().split(/\s+/).slice(0, maxWords).join('-').replace(/[^a-zA-Z0-9-]/g, '').toLowerCase();

  const captureForecastSlide = async (): Promise<string> => {
    const el = forecastSlideRef.current!;
    const prev = { transform: el.style.transform, position: el.style.position, top: el.style.top, left: el.style.left };
    el.style.transform = 'none';
    el.style.position = 'fixed';
    el.style.top = '-99999px';
    el.style.left = '-99999px';
    await new Promise(r => setTimeout(r, 100));
    const canvas = await html2canvas(el, {
      backgroundColor: '#0a0a0a', scale: 2, useCORS: true, allowTaint: true, logging: false,
      width: 1080, height: 1350,
      ignoreElements: (el: Element) => el.tagName === 'CANVAS',
    });
    Object.assign(el.style, prev);
    return canvas.toDataURL('image/png');
  };

  const exportForecastZip = async () => {
    setExportingForecast(true);
    try {
      const zip = new JSZip();
      const date = new Date().toISOString().slice(0, 10);
      const folder = zip.folder('forecast')!;
      for (let i = 0; i < report.events.length; i++) {
        setExportIdx(i);
        await new Promise(r => setTimeout(r, 200));
        const dataUrl = await captureForecastSlide();
        const base64 = dataUrl.split(',')[1];
        folder.file(`${date}-${String(i + 1).padStart(2, '0')}-${slugify(report.events[i].title)}.png`, base64, { base64: true });
        await new Promise(r => setTimeout(r, 150));
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `chokepoint-forecast-${date}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch { alert('Export failed. Please try again.'); }
    finally { setExportingForecast(false); setExportIdx(-1); }
  };

  const currentEvent = exportIdx >= 0 ? report.events[exportIdx] : null;

  return (
    <div className="space-y-3">
      <div className="bg-[#0a0a0a] p-4 border relative overflow-hidden" style={{ borderColor: `${accentHex}4d`, boxShadow: `0 0 30px ${accentHex}0d` }}>
        <div className="absolute top-0 left-0 w-full h-[2px]" style={{ backgroundImage: `linear-gradient(to right, transparent, ${accentHex}99, transparent)` }} />
        <div className="flex flex-col md:flex-row justify-between items-start gap-4">
          <div className="space-y-1">
            <h2 className="text-3xl font-serif italic text-white bitcoin-glow">7-Day Market Forecast</h2>
            <p className="text-[9px] font-mono uppercase tracking-widest text-btc-orange/40">Probability-Weighted Event Outlook</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <div className={cn("px-3 py-1.5 border text-center", risk.bg)}>
              <p className="text-[8px] font-mono uppercase opacity-60">Risk Level</p>
              <p className={cn("text-sm font-mono font-bold", risk.color)}>{report.analysis.overallRiskLevel}</p>
            </div>
            <div className="px-3 py-1.5 border text-center" style={{ borderColor: `${accentHex}33`, backgroundColor: `${accentHex}0d` }}>
              <p className="text-[8px] font-mono uppercase opacity-60">Events</p>
              <p className="text-sm font-mono font-bold" style={{ color: accentHex }}>{report.events.length}</p>
            </div>
          </div>
        </div>
        <div className="mt-4 pt-4 border-t grid md:grid-cols-2 gap-4" style={{ borderColor: `${accentHex}1a` }}>
          <div>
            <p className="text-[9px] font-mono uppercase tracking-widest opacity-40 mb-1">Dominant Theme</p>
            <p className="text-sm text-gray-300 font-sans leading-relaxed">{report.analysis.dominantTheme}</p>
          </div>
          <div>
            <p className="text-[9px] font-mono uppercase tracking-widest opacity-40 mb-1">Watchlist</p>
            <p className="text-sm text-gray-300 font-sans leading-relaxed">{report.analysis.watchlist}</p>
          </div>
        </div>
        <div className="mt-3 pt-3 border-t" style={{ borderColor: `${accentHex}1a` }}>
          <p className="text-[9px] font-mono uppercase tracking-widest opacity-40 mb-1">Highest Impact Event</p>
          <p className="text-sm font-sans leading-relaxed" style={{ color: `${accentHex}cc` }}>{report.analysis.highestImpactEvent}</p>
        </div>
        <div className="mt-3 pt-3 border-t flex justify-end" style={{ borderColor: `${accentHex}1a` }}>
          <button
            onClick={exportForecastZip}
            disabled={exportingForecast}
            className="flex items-center gap-2 px-4 py-2 text-black text-[10px] font-mono font-bold uppercase tracking-widest hover:opacity-90 transition-opacity disabled:opacity-50"
            style={{ backgroundColor: accentHex }}
          >
            {exportingForecast
              ? <><Loader2 size={12} className="animate-spin" /> Exporting {exportIdx + 1}/{report.events.length}...</>
              : <><Download size={12} /> Export All PNGs</>}
          </button>
        </div>
      </div>

      <div style={{ position: 'fixed', top: '-99999px', left: '-99999px', zIndex: -1 }}>
        <div ref={forecastSlideRef} style={{ width: 1080, height: 1350, backgroundColor: '#0a0a0a', fontFamily: 'monospace', overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: 64 }}>
          {currentEvent && (() => {
            const prob = currentEvent.probability;
            const probColor = prob >= 70 ? '#22c55e' : prob >= 40 ? '#eab308' : '#ef4444';
            return (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 40, borderBottom: '1px solid rgba(247,147,26,0.3)', paddingBottom: 32 }}>
                  <div>
                    <p style={{ color: 'rgba(247,147,26,0.5)', fontSize: 14, letterSpacing: '0.3em', textTransform: 'uppercase', marginBottom: 6 }}>ChokePoint Macro</p>
                    <p style={{ color: 'rgba(247,147,26,0.3)', fontSize: 13, letterSpacing: '0.2em', textTransform: 'uppercase' }}>7-Day Market Forecast</p>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <p style={{ color: 'rgba(247,147,26,0.3)', fontSize: 13, letterSpacing: '0.15em', textTransform: 'uppercase' }}>{currentEvent.expectedDate}</p>
                    <p style={{ color: 'rgba(247,147,26,0.5)', fontSize: 13, letterSpacing: '0.15em', textTransform: 'uppercase', marginTop: 4 }}>{currentEvent.category}</p>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 32, marginBottom: 36 }}>
                  <span style={{ fontSize: 96, fontWeight: 900, color: 'rgba(247,147,26,0.15)', lineHeight: 1 }}>
                    {String(currentEvent.rank).padStart(2, '0')}
                  </span>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                      <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14, letterSpacing: '0.2em', textTransform: 'uppercase' }}>Probability</p>
                      <p style={{ color: probColor, fontSize: 28, fontWeight: 700 }}>{prob}%</p>
                    </div>
                    <div style={{ height: 10, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 5, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${prob}%`, backgroundColor: probColor, borderRadius: 5 }} />
                    </div>
                  </div>
                </div>

                <h2 style={{ color: '#ffffff', fontSize: 52, fontWeight: 700, lineHeight: 1.15, marginBottom: 28, fontFamily: 'sans-serif' }}>
                  {currentEvent.title}
                </h2>

                <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: 22, lineHeight: 1.6, marginBottom: 40, fontFamily: 'sans-serif', flex: 1 }}>
                  {currentEvent.summary}
                </p>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 36 }}>
                  <div style={{ padding: 24, border: '1px solid rgba(34,197,94,0.25)', backgroundColor: 'rgba(34,197,94,0.05)' }}>
                    <p style={{ color: 'rgba(34,197,94,0.6)', fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: 10 }}>If It Happens</p>
                    <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 18, lineHeight: 1.5, fontFamily: 'sans-serif' }}>{currentEvent.effectIfHappens}</p>
                  </div>
                  <div style={{ padding: 24, border: '1px solid rgba(239,68,68,0.25)', backgroundColor: 'rgba(239,68,68,0.05)' }}>
                    <p style={{ color: 'rgba(239,68,68,0.6)', fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: 10 }}>If It Doesn't</p>
                    <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 18, lineHeight: 1.5, fontFamily: 'sans-serif' }}>{currentEvent.effectIfDoesntHappen}</p>
                  </div>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 32 }}>
                  {currentEvent.markets.map((m: string) => (
                    <span key={m} style={{ padding: '4px 10px', fontSize: 13, border: '1px solid rgba(247,147,26,0.3)', color: 'rgba(247,147,26,0.8)', backgroundColor: 'rgba(247,147,26,0.08)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>{m}</span>
                  ))}
                  {currentEvent.countries.map((c: string) => (
                    <span key={c} style={{ padding: '4px 10px', fontSize: 13, border: '1px solid rgba(168,85,247,0.3)', color: 'rgba(168,85,247,0.8)', backgroundColor: 'rgba(168,85,247,0.08)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>{c}</span>
                  ))}
                </div>

                <div style={{ borderTop: '1px solid rgba(247,147,26,0.2)', paddingTop: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <CPMLogoImg size={28} />
                  <p style={{ color: 'rgba(247,147,26,0.4)', fontSize: 13, letterSpacing: '0.2em', textTransform: 'uppercase' }}>chokepointmacro.com</p>
                </div>
              </>
            );
          })()}
        </div>
      </div>

      <div className="space-y-2">
        {report.events.map((event, i) => {
          const isOpen = expanded === i;
          const sentConf = SENTIMENT_FORECAST_CONFIG[event.sentiment?.toLowerCase()] ?? { color: 'text-gray-400', label: event.sentiment };
          const probColor = event.probability >= 70 ? 'bg-green-500' : event.probability >= 40 ? 'bg-yellow-500' : 'bg-red-500';

          return (
            <div key={i} className="bg-[#0a0a0a] border overflow-hidden transition-colors" style={{ borderColor: `${accentHex}33` }} onMouseEnter={e => (e.currentTarget.style.borderColor = `${accentHex}66`)} onMouseLeave={e => (e.currentTarget.style.borderColor = `${accentHex}33`)}>
              <button
                className="w-full text-left p-4 flex items-center gap-4"
                onClick={() => setExpanded(isOpen ? null : i)}
              >
                <span className="text-2xl font-mono font-bold w-8 shrink-0" style={{ color: `${accentHex}4d` }}>
                  {String(event.rank).padStart(2, '0')}
                </span>

                <div className="flex flex-col items-center gap-1 shrink-0 w-12">
                  <span className="text-[10px] font-mono text-gray-500">{event.probability}%</span>
                  <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                    <div className={cn("h-full rounded-full", probColor)} style={{ width: `${event.probability}%` }} />
                  </div>
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-mono font-bold text-white leading-tight">{event.title}</p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className="text-[9px] font-mono uppercase tracking-widest" style={{ color: `${accentHex}80` }}>{event.expectedDate}</span>
                    <span className="text-[9px] font-mono uppercase tracking-widest" style={{ color: `${accentHex}33` }}>·</span>
                    <span className={cn("text-[9px] font-mono uppercase tracking-widest", sentConf.color)}>{sentConf.label}</span>
                    <span className="text-[9px] font-mono uppercase tracking-widest" style={{ color: `${accentHex}33` }}>·</span>
                    <span className="text-[9px] font-mono uppercase tracking-widest text-gray-500">{event.category}</span>
                  </div>
                </div>

                <div className="hidden md:flex gap-1 flex-wrap justify-end max-w-[260px]">
                  {event.markets.slice(0, 3).map(m => (
                    <span key={m} className="px-1.5 py-0.5 text-[8px] font-mono uppercase border" style={{ backgroundColor: `${accentHex}1a`, borderColor: `${accentHex}33`, color: `${accentHex}b3` }}>{m}</span>
                  ))}
                </div>

                <ChevronRight size={14} className={cn("shrink-0 transition-transform", isOpen && "rotate-90")} style={{ color: `${accentHex}4d` }} />
              </button>

              {isOpen && (
                <div className="px-4 pb-4 space-y-4 border-t" style={{ borderColor: `${accentHex}1a` }}>
                  <p className="text-sm text-gray-400 leading-relaxed pt-4">{event.summary}</p>

                  <div className="grid md:grid-cols-2 gap-3">
                    <div className="p-3 border border-green-500/20 bg-green-500/5">
                      <p className="text-[9px] font-mono uppercase tracking-widest text-green-400/60 mb-1.5">If It Happens</p>
                      <p className="text-xs text-gray-300 leading-relaxed">{event.effectIfHappens}</p>
                    </div>
                    <div className="p-3 border border-red-500/20 bg-red-500/5">
                      <p className="text-[9px] font-mono uppercase tracking-widest text-red-400/60 mb-1.5">If It Doesn't</p>
                      <p className="text-xs text-gray-300 leading-relaxed">{event.effectIfDoesntHappen}</p>
                    </div>
                  </div>

                  <div className="grid md:grid-cols-3 gap-3">
                    <div>
                      <p className="text-[9px] font-mono uppercase tracking-widest opacity-40 mb-1.5">Markets</p>
                      <div className="flex flex-wrap gap-1">
                        {event.markets.map(m => <span key={m} className="px-1.5 py-0.5 text-[9px] font-mono border" style={{ backgroundColor: `${accentHex}1a`, borderColor: `${accentHex}33`, color: `${accentHex}cc` }}>{m}</span>)}
                      </div>
                    </div>
                    <div>
                      <p className="text-[9px] font-mono uppercase tracking-widest opacity-40 mb-1.5">Industries</p>
                      <div className="flex flex-wrap gap-1">
                        {event.industries.map(ind => <span key={ind} className="px-1.5 py-0.5 text-[9px] font-mono bg-blue-500/10 border border-blue-500/20 text-blue-400/80">{ind}</span>)}
                      </div>
                    </div>
                    <div>
                      <p className="text-[9px] font-mono uppercase tracking-widest opacity-40 mb-1.5">Countries</p>
                      <div className="flex flex-wrap gap-1">
                        {event.countries.map(c => <span key={c} className="px-1.5 py-0.5 text-[9px] font-mono bg-purple-500/10 border border-purple-500/20 text-purple-400/80">{c}</span>)}
                      </div>
                    </div>
                  </div>

                  {event.url && (
                    <div className="flex gap-3 flex-wrap">
                      <a href={event.url} target="_blank" rel="noopener noreferrer" className="text-[9px] font-mono transition-colors underline underline-offset-2" style={{ color: `${accentHex}80` }}>{event.url}</a>
                      {event.alternateUrl && <a href={event.alternateUrl} target="_blank" rel="noopener noreferrer" className="text-[9px] font-mono transition-colors underline underline-offset-2" style={{ color: `${accentHex}4d` }}>{event.alternateUrl}</a>}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
