import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileText, TrendingUp, ExternalLink, Loader2, RefreshCw, Clock,
  ChevronRight, ChevronLeft, Copy, Send, Calendar, Trash2, Instagram,
  Download, Volume2, Plus, Link2, X as XIcon, Check,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Markdown from 'react-markdown';
import html2canvas from 'html2canvas';
import JSZip from 'jszip';
import { cn } from '../lib/utils';
import { truncateToWords } from '../lib/utils';
import { apiFetch } from '../lib/api';
import { getReportColor, makeTheme } from '../lib/reportThemes';
import { CPMLogo, CPMLogoImg } from './CPMLogo';
import { ForecastView } from './ForecastView';
import type { WeeklyReport, ForecastReport } from '../services/geminiService';

const SENTIMENT_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  bullish:         { color: 'text-emerald-400', bg: 'bg-emerald-400/10 border-emerald-400/30', label: '↑ Bullish' },
  bearish:         { color: 'text-red-400',     bg: 'bg-red-400/10 border-red-400/30',         label: '↓ Bearish' },
  neutral:         { color: 'text-amber-400',   bg: 'bg-amber-400/10 border-amber-400/30',     label: '→ Neutral' },
  escalating:      { color: 'text-red-400',     bg: 'bg-red-400/10 border-red-400/30',         label: '↑ Escalating' },
  'de-escalating': { color: 'text-blue-400',    bg: 'bg-blue-400/10 border-blue-400/30',       label: '↓ De-escalating' },
  stable:          { color: 'text-gray-400',    bg: 'bg-gray-400/10 border-gray-400/30',       label: '→ Stable' },
  viral:           { color: 'text-purple-400',  bg: 'bg-purple-400/10 border-purple-400/30',   label: '◎ Viral' },
  fading:          { color: 'text-gray-500',    bg: 'bg-gray-500/10 border-gray-500/30',       label: '↓ Fading' },
  debunked:        { color: 'text-orange-400',  bg: 'bg-orange-400/10 border-orange-400/30',   label: '✗ Debunked' },
};

type SlideThemeName = 'dark' | 'editorial' | 'terminal';

const SLIDE_THEMES: Record<SlideThemeName, {
  label: string; bg: string; text: string; accent: string;
  secondary: string; border: string; headerBg: string; numColor: string;
}> = {
  dark: {
    label: 'Dark',
    bg: '#0a0a0a', text: '#ffffff', accent: '#f7931a',
    secondary: '#d1d5db', border: 'rgba(247,147,26,0.2)', headerBg: 'rgba(247,147,26,0.05)', numColor: '#f7931a',
  },
  editorial: {
    label: 'Editorial',
    bg: '#f5f5f0', text: '#0a0a0a', accent: '#c47000',
    secondary: '#4b5563', border: 'rgba(0,0,0,0.12)', headerBg: 'rgba(0,0,0,0.03)', numColor: '#c47000',
  },
  terminal: {
    label: 'Terminal',
    bg: '#0d1117', text: '#00ff41', accent: '#00ff41',
    secondary: '#00cc33', border: 'rgba(0,255,65,0.25)', headerBg: 'rgba(0,255,65,0.05)', numColor: '#00ff41',
  },
};

export const Dashboard = () => {
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [loadingStage, setLoadingStage] = useState('');
  const [loadingPercent, setLoadingPercent] = useState(0);
  const [reportSources, setReportSources] = useState<any[]>([]);
  const [reportWarnings, setReportWarnings] = useState<string[]>([]);
  const [activeReportId, setActiveReportId] = useState<string | null>(null);
  const [reportType, setReportType] = useState('global');
  const [customTopic, setCustomTopic] = useState('');
  const [showInstaModal, setShowInstaModal] = useState(false);
  const [instaCaption, setInstaCaption] = useState('');
  const [generatingInsta, setGeneratingInsta] = useState(false);
  const [downloadingInsta, setDownloadingInsta] = useState(false);
  const [exportingZip, setExportingZip] = useState(false);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [slideTheme, setSlideTheme] = useState<SlideThemeName>('dark');
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [substackArticle, setSubstackArticle] = useState('');
  const [generatingSubstack, setGeneratingSubstack] = useState(false);
  const [showSubstackModal, setShowSubstackModal] = useState(false);
  const [showAutoScheduleModal, setShowAutoScheduleModal] = useState(false);
  const [autoSchedulePreview, setAutoSchedulePreview] = useState<any>(null);
  const [autoScheduleLoading, setAutoScheduleLoading] = useState(false);
  const [autoScheduleConfirming, setAutoScheduleConfirming] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<'archive' | 'context'>('archive');
  const [contextFiles, setContextFiles] = useState<any[]>([]);
  const [activeContextFile, setActiveContextFile] = useState<string | null>(null);
  const [activeContextContent, setActiveContextContent] = useState<string>('');
  const [editingContext, setEditingContext] = useState(false);
  const [editContextContent, setEditContextContent] = useState('');
  const [contextSaving, setContextSaving] = useState(false);
  const [showNewContextForm, setShowNewContextForm] = useState(false);
  const [newContextName, setNewContextName] = useState('');
  const [newContextContent, setNewContextContent] = useState('');
  const instaAssetRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const navigate = useNavigate();

  const activeReportRecord = reports.find(r => r.id === activeReportId) ?? null;
  const activeReport = activeReportRecord?.content as (WeeklyReport | ForecastReport) | null;
  const isForecast = activeReportRecord?.type === 'forecast';
  const forecastReport = isForecast ? activeReport as ForecastReport : null;
  const weeklyReport = !isForecast ? activeReport as WeeklyReport : null;

  const activeType = reportType;
  const { hex: acHex, rgb: acRgb } = getReportColor(activeType);
  const T = makeTheme(acHex, acRgb);

  const watermark = (() => {
    try { return JSON.parse(localStorage.getItem('gib_watermark') || '{}'); } catch { return {}; }
  })();

  const getReportLabel = (r: any) => {
    if (r.type === 'custom') return r.custom_topic ? truncateToWords(r.custom_topic, 4) : 'Custom';
    const labels: Record<string, string> = { equities: 'S&P 500', nasdaq: 'Nasdaq-100', crypto: 'Crypto', conspiracies: 'Conspiracies', speculation: 'Speculation', global: 'Global', forecast: '7-Day Forecast', china: 'China Supply Chain' };
    return labels[r.type] || 'Global';
  };

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => { if (e.key === 'Escape' && showInstaModal) setShowInstaModal(false); };
    if (showInstaModal) document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [showInstaModal]);

  const fetchReports = async () => {
    const res = await apiFetch('/api/reports');
    if (res.ok) {
      const data = await res.json();
      setReports(data);
      if (data.length > 0 && !activeReportId) setActiveReportId(data[0].id);
    }
  };

  const fetchContextFiles = async () => {
    const res = await apiFetch('/api/context-files');
    if (res.ok) setContextFiles(await res.json());
  };

  const loadContextFile = async (name: string) => {
    const res = await apiFetch(`/api/context-files/${name}`);
    if (res.ok) {
      const data = await res.json();
      setActiveContextFile(name);
      setActiveContextContent(data.content);
      setEditingContext(false);
    }
  };

  const saveContextFile = async () => {
    if (!activeContextFile) return;
    setContextSaving(true);
    await apiFetch(`/api/context-files/${activeContextFile}`, { method: 'PATCH', body: JSON.stringify({ content: editContextContent }) });
    setContextSaving(false);
    setActiveContextContent(editContextContent);
    setEditingContext(false);
    fetchContextFiles();
  };

  const deleteContextFile = async (name: string) => {
    if (!confirm(`Delete "${name}"?`)) return;
    await apiFetch(`/api/context-files/${name}`, { method: 'DELETE' });
    if (activeContextFile === name) { setActiveContextFile(null); setActiveContextContent(''); }
    fetchContextFiles();
  };

  const createContextFile = async () => {
    if (!newContextName.trim() || !newContextContent.trim()) return;
    const res = await apiFetch('/api/context-files', { method: 'POST', body: JSON.stringify({ name: newContextName, content: newContextContent }) });
    if (res.ok) {
      const data = await res.json();
      setShowNewContextForm(false);
      setNewContextName(''); setNewContextContent('');
      await fetchContextFiles();
      loadContextFile(data.name);
    }
  };

  useEffect(() => { fetchReports(); fetchContextFiles(); }, []);

  const clearArchive = async () => {
    if (!confirm("Delete all reports in the archive?")) return;
    const res = await apiFetch('/api/reports', { method: 'DELETE' });
    if (res.ok) { setReports([]); setActiveReportId(null); }
  };

  const deleteReport = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Delete this report?")) return;
    const res = await apiFetch(`/api/reports/${id}`, { method: 'DELETE' });
    if (res.ok) {
      if (activeReportId === id) setActiveReportId(null);
      fetchReports();
    }
  };

  const generateReport = async () => {
    if (reportType === 'custom' && !customTopic.trim()) {
      setLoadingError("Please enter a custom topic before generating.");
      return;
    }
    setLoading(true);
    setLoadingError(null);
    setLoadingStage('Starting...');
    setLoadingPercent(0);
    setReportSources([]);
    setReportWarnings([]);
    setAudioUrl(null);
    abortControllerRef.current = new AbortController();

    // Simulate progress bar stages
    const progressInterval = setInterval(() => {
      setLoadingPercent(prev => {
        if (prev < 15) { setLoadingStage('Fetching news sources...'); return prev + 3; }
        if (prev < 30) { setLoadingStage('Filtering & scoring articles...'); return prev + 2; }
        if (prev < 50) { setLoadingStage('Sending to AI provider...'); return prev + 1; }
        if (prev < 85) { setLoadingStage('AI generating report...'); return prev + 0.5; }
        if (prev < 92) { setLoadingStage('Parsing AI response...'); return prev + 0.3; }
        return prev;
      });
    }, 800);

    try {
      const response = await apiFetch('/api/generate-report', {
        method: 'POST',
        body: JSON.stringify({ type: reportType, customTopic: reportType === 'custom' ? customTopic : undefined }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `API error: ${response.status}`);
      }

      const report = await response.json();
      const isForecastType = reportType === 'forecast';

      // Extract metadata before saving
      const sources = report._sources || [];
      const warnings = report._warnings || [];
      delete report._sources;
      delete report._warnings;
      setReportSources(sources);
      setReportWarnings(warnings);

      if (isForecastType && !report.events?.length) throw new Error("No forecast events generated. Please try again.");
      if (!isForecastType && !report.headlines?.length) throw new Error("No headlines generated. Please try again.");
      if (!report.analysis) throw new Error("No analysis generated. Please try again.");

      const id = `${reportType}-${Date.now()}`;
      await apiFetch('/api/reports', {
        method: 'POST',
        body: JSON.stringify({ id, type: reportType, content: report, customTopic: reportType === 'custom' ? customTopic : undefined }),
      });
      await fetchReports();
      setActiveReportId(id);
      setLoadingError(null);
      clearInterval(progressInterval);
      setLoadingPercent(100);
      setLoadingStage('Complete');

      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('Report Ready — Global Pulse', {
          body: `${getReportLabel({ type: reportType, custom_topic: customTopic })} report: ${isForecastType ? report.events.length + ' events' : report.headlines.length + ' headlines'} generated.`,
        });
      }
    } catch (err) {
      let errorMessage = "Failed to generate report. Please try again.";
      if (err instanceof Error) {
        if (err.name === "AbortError" || err.message.includes("AbortError")) {
          errorMessage = "Report generation was cancelled.";
        } else if (err.message.includes("timed out") || err.message.includes("TIMEOUT")) {
          errorMessage = "Report generation timed out. The AI provider may be overloaded — please try again in a moment.";
        } else if (err.message.includes("Failed to fetch") || err.message.includes("NetworkError") || err.message.includes("network")) {
          errorMessage = "Network error — could not reach the server. Check your connection and try again.";
        } else {
          errorMessage = err.message || errorMessage;
        }
      }
      setLoadingError(errorMessage);
    } finally {
      clearInterval(progressInterval);
      setLoading(false);
    }
  };

  const cancelReport = () => {
    abortControllerRef.current?.abort();
    setLoading(false);
    setLoadingError("Report generation cancelled.");
  };

  const handleAutoSchedulePreview = async () => {
    if (!activeReportId) return;
    setAutoScheduleLoading(true);
    setShowAutoScheduleModal(true);
    try {
      const res = await apiFetch('/api/auto-schedule/preview', { method: 'POST', body: JSON.stringify({ reportId: activeReportId }) });
      if (!res.ok) throw new Error((await res.json()).error);
      const data = await res.json();
      setAutoSchedulePreview({ ...data, items: data.items.map((item: any) => ({ ...item, enabled: true })) });
    } catch (err) {
      alert('Failed to preview schedule: ' + (err instanceof Error ? err.message : String(err)));
      setShowAutoScheduleModal(false);
    } finally {
      setAutoScheduleLoading(false);
    }
  };

  const handleAutoScheduleConfirm = async () => {
    if (!autoSchedulePreview) return;
    setAutoScheduleConfirming(true);
    try {
      const res = await apiFetch('/api/auto-schedule/confirm', { method: 'POST', body: JSON.stringify({ items: autoSchedulePreview.items }) });
      if (!res.ok) throw new Error((await res.json()).error);
      const data = await res.json();
      setShowAutoScheduleModal(false);
      setAutoSchedulePreview(null);
      alert(`✓ ${data.scheduled} items scheduled successfully.`);
    } catch (err) {
      alert('Failed to confirm schedule: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setAutoScheduleConfirming(false);
    }
  };

  const toggleAutoScheduleItem = (idx: number) => {
    setAutoSchedulePreview((prev: any) => ({
      ...prev,
      items: prev.items.map((item: any, i: number) => i === idx ? { ...item, enabled: !item.enabled } : item),
    }));
  };

  const updateAutoScheduleTime = (idx: number, newTime: string) => {
    setAutoSchedulePreview((prev: any) => ({
      ...prev,
      items: prev.items.map((item: any, i: number) => i === idx ? { ...item, time: new Date(newTime).toISOString() } : item),
    }));
  };

  const handlePost = (text: string) => navigate('/compose', { state: { content: text } });
  const handleSchedule = (content: string) => navigate('/compose', { state: { content, autoSchedule: true } });

  const handleGenerateInstagram = async () => {
    if (!activeReport || !activeReportId) return;
    setGeneratingInsta(true);
    setShowInstaModal(true);
    setInstaCaption("Generating caption...");
    try {
      const response = await fetch('/api/instagram-caption', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId: activeReportId }),
      });
      if (!response.ok) {
        const error = await response.json();
        if (response.status === 429) throw new Error(`⚠️ Rate limit reached: ${error.error}`);
        throw new Error(error.error || 'Failed to generate caption');
      }
      const data = await response.json();
      setInstaCaption(data.caption);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to generate Instagram caption';
      setInstaCaption(message);
    } finally {
      setGeneratingInsta(false);
    }
  };

  const handleAudioBrief = async () => {
    if (!activeReportId) return;
    setAudioLoading(true);
    try {
      const res = await apiFetch('/api/audio-brief', {
        method: 'POST',
        body: JSON.stringify({ reportId: activeReportId }),
      });
      if (!res.ok) throw new Error("Failed to generate audio");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);
    } catch (err) {
      alert("Audio brief failed: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setAudioLoading(false);
    }
  };


  const handleGenerateSubstack = async () => {
    if (!activeReportId) return;
    setGeneratingSubstack(true);
    setShowSubstackModal(true);
    setSubstackArticle('');
    try {
      const res = await apiFetch('/api/substack-article', {
        method: 'POST',
        body: JSON.stringify({ reportId: activeReportId }),
      });
      const data = await res.json();
      if (res.ok) setSubstackArticle(data.article);
      else { setSubstackArticle(''); alert('Failed to generate article: ' + data.error); setShowSubstackModal(false); }
    } catch (err) {
      alert('Substack error: ' + (err instanceof Error ? err.message : String(err)));
      setShowSubstackModal(false);
    } finally {
      setGeneratingSubstack(false);
    }
  };

  const captureSlide = async (): Promise<string> => {
    const el = instaAssetRef.current!;
    const prev = { transform: el.style.transform, marginBottom: el.style.marginBottom, marginRight: el.style.marginRight, position: el.style.position, top: el.style.top, left: el.style.left };
    el.style.transform = 'none';
    el.style.marginBottom = '0';
    el.style.marginRight = '0';
    el.style.position = 'fixed';
    el.style.top = '-99999px';
    el.style.left = '-99999px';
    await new Promise(r => setTimeout(r, 80));
    const canvas = await html2canvas(el, {
      backgroundColor: SLIDE_THEMES[slideTheme].bg,
      scale: 2, useCORS: true, allowTaint: true, logging: false,
      width: 1080, height: 1350,
      ignoreElements: (element: Element) => element.tagName === 'CANVAS',
    });
    Object.assign(el.style, prev);
    return canvas.toDataURL('image/png');
  };

  const slugify = (text: string, maxWords = 5) =>
    text.trim().split(/\s+/).slice(0, maxWords).join('-').replace(/[^a-zA-Z0-9-]/g, '').toLowerCase();

  const downloadCarousel = async () => {
    if (!activeReport || !instaAssetRef.current) return;
    setDownloadingInsta(true);
    try {
      const date = new Date().toISOString().slice(0, 10);
      const totalSlides = weeklyReport!.headlines.length + 1;
      for (let i = 0; i < totalSlides; i++) {
        setCurrentSlideIndex(i);
        await new Promise(r => setTimeout(r, 200));
        const dataUrl = await captureSlide();
        const link = document.createElement('a');
        const slideLabel = i === 0 ? 'cover' : `${String(i).padStart(2, '0')}-${slugify(weeklyReport!.headlines[i - 1].title)}`;
        link.download = `${date}-${slideLabel}.png`;
        link.href = dataUrl;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        await new Promise(r => setTimeout(r, 300));
      }
      alert("All 21 slides downloaded.");
    } catch {
      alert("Failed to generate slides. Please try again.");
    } finally {
      setDownloadingInsta(false);
      setCurrentSlideIndex(0);
    }
  };

  const exportZip = async () => {
    if (!activeReport || !instaAssetRef.current) return;
    setExportingZip(true);
    try {
      const zip = new JSZip();
      const date = new Date().toISOString().slice(0, 10);
      const instaFolder = zip.folder('instagram')!;
      const tweetsFolder = zip.folder('tweets')!;

      const totalSlides = weeklyReport!.headlines.length + 1;
      for (let i = 0; i < totalSlides; i++) {
        setCurrentSlideIndex(i);
        await new Promise(r => setTimeout(r, 200));
        const dataUrl = await captureSlide();
        const base64 = dataUrl.split(',')[1];
        const name = i === 0
          ? `${date}-00-cover.png`
          : `${date}-${String(i).padStart(2, '0')}-${slugify(weeklyReport!.headlines[i - 1].title)}.png`;
        instaFolder.file(name, base64, { base64: true });
        await new Promise(r => setTimeout(r, 150));
      }

      if (instaCaption) instaFolder.file('caption.txt', instaCaption);

      const summaryLines = [
        `GLOBAL INTELLIGENCE BRIEF — ${date}`,
        '='.repeat(60),
        '',
        ...weeklyReport!.headlines.map((h, i) =>
          `${String(i + 1).padStart(2, '0')}. ${h.title}\n\n${h.summary}\n\nSource: ${h.url}${h.alternateUrl ? `\nAlt: ${h.alternateUrl}` : ''}\n\n${'─'.repeat(60)}\n`
        ),
        'ANALYSIS',
        '='.repeat(60),
        weeklyReport!.analysis.overallSummary,
      ].join('\n');
      instaFolder.file('report-summary.txt', summaryLines);

      weeklyReport!.headlines.forEach((h, i) => {
        const tweetContent = [h.socialPost, '', `Source: ${h.url}`].join('\n');
        tweetsFolder.file(`${date}-${String(i + 1).padStart(2, '0')}-${slugify(h.title)}.txt`, tweetContent);
      });

      const allTweets = weeklyReport!.headlines
        .map((h, i) => `--- Tweet ${String(i + 1).padStart(2, '0')} [${h.category}] ---\n${h.socialPost}\n${h.url}`)
        .join('\n\n');
      tweetsFolder.file('all-tweets.txt', allTweets);

      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `chokepoint-macro-${date}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setCurrentSlideIndex(0);
    } catch {
      alert("Failed to export ZIP. Please try again.");
    } finally {
      setExportingZip(false);
      setCurrentSlideIndex(0);
    }
  };

  const theme = SLIDE_THEMES[slideTheme];

  return (
    <div className="space-y-12" style={{ '--ac': T.hex, '--ac-rgb': acRgb } as React.CSSProperties}>
      {/* Hero */}
      <section className="relative py-12 border-b border-btc-orange/20">
        <div className="max-w-3xl">
          <div className="flex items-center gap-2 mb-4">
            <p className="text-xs font-mono uppercase tracking-[0.3em] text-btc-orange/60">Market Pulse Center</p>
            <span className="px-2 py-0.5 bg-btc-orange text-black text-[8px] font-mono uppercase tracking-widest rounded-full animate-pulse shadow-[0_0_10px_#f7931a]">Live Real-Time</span>
          </div>
          <h1 className="text-6xl md:text-8xl font-serif italic leading-none mb-8 text-white bitcoin-glow">The Pulse.</h1>
          <p className="text-lg text-gray-400 leading-relaxed max-w-xl">
            Direct market insights and global shifts aggregated for clarity.
            Tracking macro trends, crypto momentum, and equity shifts in real-time.
          </p>
        </div>
      </section>

      {/* Action Bar */}
      <div
        className="flex flex-col gap-4 p-6 bg-[#0a0a0a] border relative z-20"
        style={{ borderColor: T.border, boxShadow: T.glow }}
      >
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex bg-btc-orange/5 p-1 rounded-sm border border-btc-orange/10 flex-wrap gap-0.5">
              {[
                { id: 'global', label: 'Global' },
                { id: 'crypto', label: 'Crypto' },
                { id: 'equities', label: 'S&P 500' },
                { id: 'nasdaq', label: 'Nasdaq-100' },
                { id: 'conspiracies', label: 'Conspiracies' },
                { id: 'speculation', label: 'Speculation' },
                { id: 'forecast', label: '7-Day Forecast' },
                { id: 'china', label: 'China S.C.' },
                { id: 'custom', label: 'Custom' },
              ].map((t) => (
                <button
                  key={t.id}
                  onClick={() => setReportType(t.id)}
                  disabled={loading}
                  style={reportType === t.id ? { backgroundColor: getReportColor(t.id).hex, color: '#000' } : {}}
                  className={cn(
                    "px-4 py-2 text-[10px] font-mono uppercase tracking-widest transition-all",
                    reportType === t.id ? "font-bold" : "text-gray-500 hover:text-white disabled:opacity-50"
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-3">
            {activeReportId && weeklyReport && !loading && (
              <button
                onClick={handleAutoSchedulePreview}
                disabled={autoScheduleLoading}
                style={{ borderColor: T.border, color: T.hex }}
                className="flex items-center gap-2 px-5 py-4 border text-[10px] font-mono font-bold uppercase tracking-widest hover:bg-white/5 transition-all disabled:opacity-50"
                title="Auto-schedule this report's content"
              >
                {autoScheduleLoading ? <Loader2 size={14} className="animate-spin" /> : <Calendar size={14} />}
                Auto Schedule
              </button>
            )}
            {loading ? (
              <button onClick={cancelReport} className="flex items-center gap-3 px-8 py-4 bg-red-600/80 text-white font-mono font-bold uppercase tracking-widest hover:bg-red-600 transition-all">
                <XIcon size={16} /> Cancel
              </button>
            ) : (
              <button
                onClick={generateReport}
                style={{ backgroundColor: T.hex, boxShadow: loading ? 'none' : T.glowMd }}
                className="flex items-center gap-3 px-8 py-4 text-black font-mono font-bold uppercase tracking-widest transition-all"
              >
                <RefreshCw size={18} /> Generate Report
              </button>
            )}
          </div>
        </div>

        {reportType === 'custom' && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
            <input
              type="text"
              value={customTopic}
              onChange={e => setCustomTopic(e.target.value)}
              placeholder="Enter your topic focus, e.g. 'US-China trade war impact on semiconductor supply chains'..."
              className="w-full px-4 py-3 bg-black/40 border border-btc-orange/30 text-white font-mono text-sm focus:border-btc-orange outline-none placeholder:text-gray-600 transition-all"
              disabled={loading}
            />
          </motion.div>
        )}
      </div>

      {loadingError && (
        <motion.div
          initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
          className="p-4 bg-red-500/10 border border-red-500/30 text-red-400 font-mono text-sm flex items-center justify-between gap-4"
        >
          <span>⚠️ {loadingError}</span>
          <button onClick={() => setLoadingError(null)} className="text-red-400 hover:text-red-300 transition-colors"><XIcon size={14} /></button>
        </motion.div>
      )}

      {loading && (
        <div className="p-4 space-y-3" style={{ backgroundColor: T.bg, border: `1px solid ${T.borderLight}` }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Loader2 className="animate-spin" size={16} style={{ color: T.hex }} />
              <p className="text-xs font-mono uppercase tracking-widest" style={{ color: T.textMuted }}>{loadingStage || 'Initializing...'}</p>
            </div>
            <span className="text-xs font-mono font-bold" style={{ color: T.hex }}>{loadingPercent}%</span>
          </div>
          <div className="w-full h-1.5 bg-black/40 rounded-full overflow-hidden">
            <motion.div
              className="h-full rounded-full"
              style={{ backgroundColor: T.hex }}
              initial={{ width: 0 }}
              animate={{ width: `${loadingPercent}%` }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
            />
          </div>
          {reportSources.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {reportSources.map((s: any, i: number) => (
                <span key={i} className="flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-wider px-2 py-1 border border-white/5 bg-black/30">
                  <span className={`w-1.5 h-1.5 rounded-full ${s.status === 'ok' ? 'bg-emerald-400' : s.status === 'timeout' ? 'bg-amber-400' : 'bg-red-400'}`} />
                  {s.name}
                  {s.articles != null && s.status === 'ok' && <span className="opacity-40">({s.articles})</span>}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
        {/* Sidebar */}
        <div className="lg:col-span-3 space-y-4 relative z-10">
          <div className="flex border-b border-white/8">
            {(['archive', 'context'] as const).map(t => (
              <button
                key={t}
                onClick={() => setSidebarTab(t)}
                className={`flex-1 py-2 text-[10px] font-mono uppercase tracking-widest transition-colors ${
                  sidebarTab === t
                    ? 'text-btc-orange border-b-2 border-btc-orange -mb-px'
                    : 'text-white/25 hover:text-white/50'
                }`}
              >{t}</button>
            ))}
          </div>

          {sidebarTab === 'archive' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between pb-1">
                <span className="text-[9px] font-mono uppercase tracking-widest text-white/20">{reports.length} reports</span>
                {reports.length > 0 && (
                  <button onClick={clearArchive} className="text-[8px] font-mono uppercase tracking-widest text-red-500/50 hover:text-red-500 transition-colors">Clear All</button>
                )}
              </div>
              {reports.map((r) => {
                const rC = getReportColor(r.type);
                const isActive = activeReportId === r.id;
                return (
                  <div key={r.id} className="relative group/item">
                    <button
                      onClick={() => { setActiveReportId(r.id); setActiveContextFile(null); }}
                      className="w-full text-left p-4 border transition-all flex flex-col gap-1 pr-10 relative overflow-hidden"
                      style={{
                        backgroundColor: isActive ? `rgba(${rC.rgb},0.08)` : '#0a0a0a',
                        borderColor: isActive ? rC.hex : `rgba(255,255,255,0.06)`,
                        boxShadow: isActive ? `0 0 12px rgba(${rC.rgb},0.12)` : 'none',
                      }}
                    >
                      <div className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ backgroundColor: rC.hex, opacity: isActive ? 1 : 0.4 }} />
                      <span className="text-[10px] font-mono uppercase pl-3" style={{ color: rC.hex, opacity: 0.7 }}>{getReportLabel(r)}</span>
                      <span className="text-xs font-medium truncate pl-3 text-gray-400">{new Date(r.updated_at).toLocaleDateString()}</span>
                    </button>
                    <button
                      onClick={(e) => deleteReport(r.id, e)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-red-500 opacity-0 group-hover/item:opacity-40 hover:!opacity-100 transition-opacity hover:bg-red-500/10 rounded-sm z-10"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {sidebarTab === 'context' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between pb-1">
                <span className="text-[9px] font-mono uppercase tracking-widest text-white/20">{contextFiles.length} files</span>
                <button
                  onClick={() => setShowNewContextForm(f => !f)}
                  className="flex items-center gap-1 text-[8px] font-mono uppercase tracking-widest text-teal-400/50 hover:text-teal-400 transition-colors"
                >
                  <Plus size={10} /> New
                </button>
              </div>

              {showNewContextForm && (
                <div className="border border-teal-400/20 bg-teal-400/5 p-3 space-y-2">
                  <input
                    type="text" placeholder="File name (e.g. us-energy-policy)"
                    value={newContextName}
                    onChange={e => setNewContextName(e.target.value)}
                    className="w-full bg-black/40 border border-white/10 text-white text-[11px] font-mono px-2 py-1.5 outline-none focus:border-teal-400/40 placeholder:text-white/20"
                  />
                  <textarea
                    placeholder="Paste context content here..."
                    value={newContextContent}
                    onChange={e => setNewContextContent(e.target.value)}
                    rows={5}
                    className="w-full bg-black/40 border border-white/10 text-white text-[11px] font-mono px-2 py-1.5 outline-none focus:border-teal-400/40 placeholder:text-white/20 resize-none"
                  />
                  <button onClick={createContextFile} className="flex items-center gap-1.5 px-3 py-1.5 border border-teal-400/30 bg-teal-400/5 text-teal-400 text-[9px] font-mono uppercase tracking-wider hover:bg-teal-400/10 transition-all">
                    <Check size={10} /> Create
                  </button>
                </div>
              )}

              {contextFiles.map(f => (
                <div key={f.name} className="relative group/ctx">
                  <button
                    onClick={() => { loadContextFile(f.name); setActiveReportId(null); }}
                    className={`w-full text-left p-3 border transition-all flex flex-col gap-1 pr-8 relative overflow-hidden ${
                      activeContextFile === f.name
                        ? 'border-teal-400/40 bg-teal-400/8'
                        : 'border-white/5 bg-[#0a0a0a] hover:border-white/10'
                    }`}
                  >
                    <div className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ backgroundColor: '#2dd4bf', opacity: activeContextFile === f.name ? 1 : 0.3 }} />
                    <span className="text-[10px] font-mono pl-3 text-teal-400/80 truncate">{f.title}</span>
                    <span className="text-[9px] font-mono pl-3 text-white/25">
                      {Math.round(f.size / 1024 * 10) / 10}kb · {new Date(f.updatedAt).toLocaleDateString()}
                    </span>
                  </button>
                  <button
                    onClick={() => deleteContextFile(f.name)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-red-500 opacity-0 group-hover/ctx:opacity-40 hover:!opacity-100 transition-opacity"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}

              {contextFiles.length === 0 && !showNewContextForm && (
                <p className="text-[10px] font-mono text-white/20 text-center py-6">No context files yet.<br />Click + New to add one.</p>
              )}
            </div>
          )}
        </div>

        {/* Report View */}
        <div className="lg:col-span-9">
          <AnimatePresence mode="wait">
            {activeContextFile && activeContextContent && !activeReport ? (
              <motion.div key={activeContextFile} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
                <div className="border border-teal-400/20 bg-black/20">
                  <div className="flex items-center justify-between p-4 border-b border-teal-400/10 bg-teal-400/5">
                    <div className="flex items-center gap-3">
                      <FileText size={14} className="text-teal-400/60" />
                      <div>
                        <p className="text-xs font-mono text-teal-400">{activeContextFile}</p>
                        <p className="text-[9px] font-mono text-white/30 uppercase tracking-wider">Intelligence Context File</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {editingContext ? (
                        <>
                          <button onClick={saveContextFile} disabled={contextSaving} className="flex items-center gap-1.5 px-3 py-1.5 border border-teal-400/30 bg-teal-400/5 text-teal-400 text-[9px] font-mono uppercase tracking-wider hover:bg-teal-400/10 transition-all disabled:opacity-40">
                            {contextSaving ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />} Save
                          </button>
                          <button onClick={() => setEditingContext(false)} className="px-3 py-1.5 border border-white/10 text-white/30 text-[9px] font-mono uppercase tracking-wider hover:text-white/50 transition-colors">Cancel</button>
                        </>
                      ) : (
                        <button onClick={() => { setEditingContext(true); setEditContextContent(activeContextContent); }}
                          className="flex items-center gap-1.5 px-3 py-1.5 border border-white/10 text-white/30 text-[9px] font-mono uppercase tracking-wider hover:text-teal-400/70 hover:border-teal-400/20 transition-all">
                          Edit
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="p-6">
                    {editingContext ? (
                      <textarea
                        value={editContextContent}
                        onChange={e => setEditContextContent(e.target.value)}
                        className="w-full bg-black/40 border border-white/10 text-white/80 text-xs font-mono p-4 outline-none focus:border-teal-400/30 transition-colors resize-none"
                        style={{ minHeight: '60vh' }}
                      />
                    ) : (
                      <div className="prose prose-invert prose-sm max-w-none prose-headings:font-mono prose-headings:text-teal-400 prose-code:text-teal-300 prose-strong:text-white prose-p:text-white/70 prose-li:text-white/70 prose-table:text-white/70">
                        <Markdown>{activeContextContent}</Markdown>
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            ) : activeReport && isForecast && forecastReport ? (
              <motion.div
                key={activeReportId || 'forecast'}
                initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
              >
                <ForecastView report={forecastReport} accentHex={T.hex} />
              </motion.div>
            ) : activeReport && !isForecast && weeklyReport ? (
              <motion.div
                key={activeReportId || 'empty'}
                initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
                className="space-y-3"
              >
                {/* Strategic Summary */}
                <div
                  className="bg-[#0a0a0a] p-3 space-y-3 border relative overflow-hidden"
                  style={{ borderColor: T.border, boxShadow: T.glowMd }}
                >
                  <div className="absolute top-0 left-0 w-full h-[2px]" style={{ backgroundImage: T.gradLine }} />

                  <div className="flex flex-col md:flex-row justify-between items-start gap-6">
                    <div className="space-y-1">
                      <h2 className="text-3xl font-serif italic text-white bitcoin-glow">Market Assessment</h2>
                      <p className="text-[9px] font-mono uppercase tracking-widest" style={{ color: T.textFaint }}>Pulse Check</p>
                    </div>
                    <div className="flex gap-2">
                      {[
                        { label: 'Verification', value: weeklyReport!.analysis.verificationScore },
                        { label: 'Integrity',    value: weeklyReport!.analysis.integrityScore },
                      ].map(({ label, value }) => {
                        const num = typeof value === 'number' ? value : parseInt(String(value));
                        const pct = isNaN(num) ? null : Math.min(100, Math.max(0, num));
                        return (
                          <div key={label} className="px-3 py-2 border text-center min-w-[80px]" style={T.pill}>
                            <p className="text-[8px] font-mono uppercase opacity-40 mb-1">{label}</p>
                            {pct !== null ? (
                              <>
                                <p className="text-lg font-mono font-bold leading-none" style={{ color: T.hex }}>{pct}<span className="text-[10px] opacity-60">%</span></p>
                                <div className="mt-1.5 h-0.5 w-full bg-white/10 rounded-full overflow-hidden">
                                  <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: T.hex }} />
                                </div>
                              </>
                            ) : (
                              <p className="text-xs font-mono font-bold">{value}</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="prose prose-invert prose-sm max-w-none font-sans leading-relaxed text-gray-400">
                    <Markdown>{weeklyReport!.analysis.overallSummary}</Markdown>
                  </div>

                  {audioUrl && (
                    <div className="flex items-center gap-3 p-3 bg-btc-orange/5 border border-btc-orange/20 rounded-sm">
                      <Volume2 size={14} className="text-btc-orange flex-shrink-0" />
                      <audio controls src={audioUrl} className="flex-1 h-8" style={{ filter: 'invert(0.8) sepia(1) saturate(5) hue-rotate(10deg)' }} />
                      <a href={audioUrl} download="brief.mp3" className="text-[10px] font-mono text-btc-orange hover:underline uppercase">Save</a>
                    </div>
                  )}

                  <div className="pt-2 border-t flex flex-col gap-2" style={{ borderColor: T.borderLight }}>
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-mono uppercase tracking-widest" style={{ color: T.textFaint }}>Actions</p>
                      <div className="flex gap-1 flex-wrap justify-end">
                        <button onClick={() => handlePost(weeklyReport!.analysis.globalSocialPost)} className="p-2 hover:bg-white/5 rounded-full transition-colors" style={{ color: T.hex }} title="Post to X">
                          <Send size={16} />
                        </button>
                        <button onClick={() => handleSchedule(weeklyReport!.analysis.globalSocialPost)} className="p-2 hover:bg-white/5 rounded-full transition-colors" style={{ color: T.hex }} title="Schedule Post">
                          <Clock size={16} />
                        </button>
                        <button onClick={handleGenerateInstagram} className="p-2 hover:bg-white/5 rounded-full transition-colors" style={{ color: T.hex }} title="Generate Instagram Asset">
                          <Instagram size={16} />
                        </button>
                        <button onClick={handleAudioBrief} disabled={audioLoading} className="p-2 hover:bg-white/5 rounded-full transition-colors disabled:opacity-50" style={{ color: T.hex }} title="Generate Audio Brief">
                          {audioLoading ? <Loader2 size={16} className="animate-spin" /> : <Volume2 size={16} />}
                        </button>

                        <button onClick={handleGenerateSubstack} disabled={generatingSubstack} className="p-2 hover:bg-white/5 rounded-full transition-colors disabled:opacity-50" style={{ color: T.hex }} title="Generate Substack Article">
                          {generatingSubstack ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}
                        </button>
                      </div>
                    </div>
                    <div className="p-2 rounded-sm font-mono text-xs italic" style={{ backgroundColor: T.bg, border: `1px solid ${T.borderLight}`, color: T.textMuted }}>
                      "{weeklyReport!.analysis.globalSocialPost}"
                    </div>
                  </div>
                </div>

                {/* Headlines Grid */}
                <div className="grid grid-cols-2 gap-2">
                  {weeklyReport!.headlines.map((h, i) => {
                    const sentimentStyle = h.sentiment ? (SENTIMENT_CONFIG[h.sentiment.toLowerCase()] || { color: 'text-gray-400', bg: 'bg-gray-400/10 border-gray-400/30', label: h.sentiment }) : null;
                    return (
                      <div
                        key={i}
                        className="group bg-[#0a0a0a] border p-2 transition-all flex flex-col justify-between relative overflow-hidden"
                        style={{ borderColor: T.border }}
                        onMouseEnter={e => (e.currentTarget.style.boxShadow = `0 0 20px rgba(${acRgb},0.10)`)}
                        onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}
                      >
                        <div className="absolute top-0 right-0 w-12 h-12 opacity-[0.02] pointer-events-none">
                          <TrendingUp size={48} style={{ color: T.hex }} />
                        </div>
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between gap-1 flex-wrap">
                            <span className="text-[9px] font-mono uppercase tracking-widest px-2 py-1 border rounded-sm whitespace-nowrap" style={T.pill}>{h.category}</span>
                            <div className="flex items-center gap-1">
                              {sentimentStyle && (
                                <span className={cn("text-[8px] font-mono uppercase tracking-widest px-1.5 py-0.5 border rounded-full", sentimentStyle.bg, sentimentStyle.color)}>
                                  {sentimentStyle.label}
                                </span>
                              )}
                              <a href={h.url} target="_blank" rel="noopener noreferrer" className="opacity-40 hover:opacity-100 transition-opacity p-1 hover:bg-white/5 rounded-sm" style={{ color: T.hex }} title="Primary source">
                                <ExternalLink size={12} />
                              </a>
                              {h.alternateUrl && (
                                <a href={h.alternateUrl} target="_blank" rel="noopener noreferrer" className="opacity-40 hover:opacity-100 transition-opacity p-1 hover:bg-white/5 rounded-sm" style={{ color: T.hex }} title="Alternate source">
                                  <Link2 size={12} />
                                </a>
                              )}
                            </div>
                          </div>
                          <h4 className="text-sm font-serif font-medium leading-tight group-hover:italic transition-all text-white">{h.title}</h4>
                          <p className="text-[11px] leading-snug text-gray-300">{h.summary}</p>
                        </div>

                        <div className="mt-1.5 pt-1.5 border-t flex items-center justify-between" style={{ borderColor: T.borderLight }}>
                          <span className="text-[7px] font-mono uppercase tracking-widest" style={{ color: T.textFaint }}>#{i + 1}</span>
                          <div className="flex gap-0.5">
                            <button onClick={() => handlePost(h.summary)} className="p-1.5 hover:bg-white/5 rounded-sm transition-colors" style={{ color: T.hex }} title="Post to X">
                              <Send size={12} />
                            </button>
                            <button onClick={() => handleSchedule(h.summary)} className="p-1.5 hover:bg-white/5 rounded-sm transition-colors" style={{ color: T.hex }} title="Schedule Post">
                              <Clock size={12} />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            ) : (
              <div className="h-96 flex flex-col items-center justify-center border-2 border-dashed rounded-sm" style={{ borderColor: T.borderLight, backgroundColor: T.bg }}>
                <FileText style={{ color: T.hex, opacity: 0.1 }} className="mb-4" size={48} />
                <p className="text-xs font-mono uppercase tracking-widest" style={{ color: T.textFaint }}>No active briefing selected</p>
              </div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Warnings & Source Status */}
      {(reportWarnings.length > 0 || reportSources.length > 0) && !loading && (
        <div className="space-y-3 mt-4">
          {reportWarnings.length > 0 && (
            <div className="p-4 bg-amber-500/5 border border-amber-500/20 space-y-2">
              <p className="text-[10px] font-mono uppercase tracking-widest text-amber-500/60">Report Warnings</p>
              {reportWarnings.map((w, i) => (
                <p key={i} className="text-xs font-mono text-amber-400/80 flex items-start gap-2">
                  <span className="text-amber-500 mt-0.5">--</span> {w}
                </p>
              ))}
            </div>
          )}
          {reportSources.length > 0 && (
            <div className="p-4 bg-[#0a0a0a] border border-white/5 space-y-3">
              <p className="text-[10px] font-mono uppercase tracking-widest text-white/20">Source Status</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                {reportSources.map((s: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 p-2 border border-white/5 bg-black/30">
                    <span className={cn(
                      "w-2 h-2 rounded-full shrink-0",
                      s.status === 'ok' ? 'bg-emerald-400 shadow-[0_0_4px_rgba(52,211,153,0.5)]' :
                      s.status === 'timeout' ? 'bg-amber-400 shadow-[0_0_4px_rgba(251,191,36,0.5)]' :
                      'bg-red-400 shadow-[0_0_4px_rgba(248,113,113,0.5)]'
                    )} />
                    <div className="min-w-0">
                      <p className="text-[10px] font-mono text-white/60 truncate">{s.name}</p>
                      <p className="text-[8px] font-mono text-white/25">
                        {s.status === 'ok' ? `${s.articles ?? '?'} articles` : s.status === 'timeout' ? 'Timed out' : 'Failed'}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Instagram Modal */}
      <AnimatePresence>
        {showInstaModal && activeReport && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-md"
            onClick={() => setShowInstaModal(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
              className="bg-[#0a0a0a] border border-btc-orange/30 w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col shadow-[0_0_50px_rgba(247,147,26,0.2)]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-4 border-b border-btc-orange/20 flex justify-between items-center bg-btc-orange/5">
                <h3 className="font-mono uppercase tracking-widest text-sm text-btc-orange bitcoin-glow">Instagram Market Asset</h3>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1 border border-btc-orange/20 rounded-sm overflow-hidden">
                    {(Object.keys(SLIDE_THEMES) as SlideThemeName[]).map(t => (
                      <button
                        key={t}
                        onClick={() => setSlideTheme(t)}
                        className={cn(
                          "px-3 py-1 text-[9px] font-mono uppercase tracking-widest transition-all",
                          slideTheme === t ? "bg-btc-orange text-black" : "text-gray-500 hover:text-btc-orange"
                        )}
                      >
                        {SLIDE_THEMES[t].label}
                      </button>
                    ))}
                  </div>
                  <button onClick={() => setShowInstaModal(false)} className="px-3 py-1 text-xs font-mono uppercase hover:text-btc-orange hover:bg-btc-orange/10 transition-all rounded-sm border border-transparent hover:border-btc-orange/30">
                    ✕ Close
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-8 grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-mono uppercase opacity-40">Slide {currentSlideIndex + 1} of {weeklyReport!.headlines.length + 1}</p>
                    <div className="flex gap-2">
                      <button onClick={() => setCurrentSlideIndex(prev => Math.max(0, prev - 1))} disabled={currentSlideIndex === 0} className="p-1 border border-btc-orange/10 hover:bg-btc-orange/10 disabled:opacity-20 transition-colors">
                        <ChevronLeft size={16} />
                      </button>
                      <button onClick={() => setCurrentSlideIndex(prev => Math.min(weeklyReport!.headlines.length, prev + 1))} disabled={currentSlideIndex === weeklyReport!.headlines.length} className="p-1 border border-btc-orange/10 hover:bg-btc-orange/10 disabled:opacity-20 transition-colors">
                        <ChevronRight size={16} />
                      </button>
                    </div>
                  </div>

                  <div style={{ width: '378px', height: '473px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)', flexShrink: 0 }}>
                    <div
                      ref={instaAssetRef}
                      className="p-14 flex flex-col gap-8 relative"
                      style={{
                        width: '1080px', height: '1350px',
                        transform: 'scale(0.35)', transformOrigin: 'top left',
                        backgroundColor: theme.bg, color: theme.text,
                      }}
                    >
                      {currentSlideIndex === 0 ? (
                        <>
                          <div className="flex justify-between items-center pb-6 border-b" style={{ borderColor: theme.border }}>
                            <div className="flex items-center gap-5">
                              <CPMLogoImg size={72} />
                              <div>
                                <p className="text-3xl font-mono font-bold tracking-[0.15em] uppercase leading-none" style={{ color: theme.text }}>CHOKEPOINT</p>
                                <p className="text-3xl font-mono font-bold tracking-[0.15em] uppercase leading-none" style={{ color: theme.accent, textShadow: `0 0 20px ${theme.accent}66` }}>MACRO</p>
                                <p className="text-lg font-mono uppercase tracking-[0.4em] mt-2" style={{ color: theme.secondary, opacity: 0.5 }}>Intelligence Brief</p>
                              </div>
                            </div>
                            <div className="text-right space-y-1">
                              <p className="text-lg font-mono uppercase tracking-widest" style={{ color: theme.secondary, opacity: 0.5 }}>Issue</p>
                              <p className="text-5xl font-mono font-bold" style={{ color: theme.accent }}>{new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit' })}</p>
                              <p className="text-lg font-mono" style={{ color: theme.secondary, opacity: 0.4 }}>{new Date().getFullYear()}</p>
                            </div>
                          </div>

                          <div className="flex-1 py-4">
                            <div className="flex items-center gap-4 mb-5">
                              <p className="text-xl font-mono uppercase tracking-[0.5em]" style={{ color: theme.accent, opacity: 0.5 }}>20 Intelligence Nodes</p>
                              <div className="flex-1 h-px" style={{ backgroundColor: theme.border }} />
                            </div>
                            <div className="grid grid-cols-2 gap-x-8 gap-y-3">
                              {weeklyReport!.headlines.map((h, idx) => (
                                <div key={idx} className="flex gap-3 items-start">
                                  <span className="text-xl font-mono font-bold pt-0.5 shrink-0" style={{ color: theme.numColor }}>
                                    {(idx + 1).toString().padStart(2, '0')}
                                  </span>
                                  <p className="text-[18px] font-sans font-semibold leading-tight" style={{ color: theme.text }}>
                                    {h.title.length > 90 ? h.title.substring(0, 90) + '…' : h.title}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>

                          <div className="pt-4 flex justify-between items-center" style={{ borderTop: `1px solid ${theme.border}` }}>
                            <div className="flex items-center gap-3">
                              <CPMLogoImg size={28} />
                              <div>
                                <p className="text-lg font-mono font-bold tracking-widest uppercase" style={{ color: theme.accent }}>{watermark.handle || '@ChokepointMacro'}</p>
                                <p className="text-base font-mono uppercase tracking-widest" style={{ color: theme.secondary, opacity: 0.4 }}>{watermark.tagline || 'Follow for daily intelligence'}</p>
                              </div>
                            </div>
                            <p className="text-lg font-mono uppercase tracking-widest" style={{ color: theme.secondary, opacity: 0.3 }}>chokepointmacro.com</p>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="flex justify-between items-center pb-4" style={{ borderBottom: `2px solid ${theme.accent}` }}>
                            <div className="flex items-center gap-4">
                              <span className="px-5 py-2 text-2xl font-mono uppercase tracking-widest border" style={{ backgroundColor: theme.headerBg, color: theme.accent, borderColor: theme.accent }}>
                                {weeklyReport!.headlines[currentSlideIndex - 1].category}
                              </span>
                            </div>
                            <div className="text-right">
                              <p className="text-2xl font-mono uppercase tracking-[0.2em]" style={{ color: theme.accent, opacity: 0.5 }}>
                                {String(currentSlideIndex).padStart(2,'0')} / 20
                              </p>
                            </div>
                          </div>

                          <h2 className="text-7xl font-serif italic leading-[1.1] tracking-tight" style={{ color: theme.text }}>
                            {weeklyReport!.headlines[currentSlideIndex - 1].title}
                          </h2>

                          <div className="flex-1 flex flex-col justify-between">
                            <p className="text-3xl font-sans leading-relaxed" style={{ color: theme.secondary }}>
                              {weeklyReport!.headlines[currentSlideIndex - 1].summary}
                            </p>

                            <div className="flex items-center gap-4 mt-4">
                              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: theme.accent }} />
                              <p className="text-xl font-mono uppercase tracking-widest" style={{ color: theme.accent, opacity: 0.6 }}>
                                {weeklyReport!.headlines[currentSlideIndex - 1].sentiment || 'Intelligence'}
                              </p>
                            </div>
                          </div>

                          <div className="pt-4 flex justify-between items-center" style={{ borderTop: `1px solid ${theme.border}` }}>
                            <div className="flex items-center gap-3">
                              <CPMLogoImg size={26} />
                              <p className="text-xl font-mono font-bold tracking-widest" style={{ color: theme.accent }}>{watermark.handle || '@ChokepointMacro'}</p>
                            </div>
                            <p className="text-lg font-mono uppercase tracking-widest" style={{ color: theme.secondary, opacity: 0.4 }}>{watermark.name || 'CHOKEPOINT MACRO'}</p>
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={downloadCarousel}
                      disabled={downloadingInsta || exportingZip}
                      className="flex-1 flex items-center justify-center gap-2 py-4 bg-btc-orange text-black font-mono font-bold uppercase tracking-widest hover:opacity-90 transition-all disabled:opacity-50 text-xs"
                    >
                      {downloadingInsta ? (
                        <><Loader2 className="animate-spin" size={14} /> {currentSlideIndex + 1}/{weeklyReport!.headlines.length + 1}</>
                      ) : (
                        <><Download size={14} /> Download Slides</>
                      )}
                    </button>
                    <button
                      onClick={exportZip}
                      disabled={exportingZip || downloadingInsta}
                      className="flex-1 flex items-center justify-center gap-2 py-4 border border-btc-orange text-btc-orange font-mono font-bold uppercase tracking-widest hover:bg-btc-orange/10 transition-all disabled:opacity-50 text-xs"
                    >
                      {exportingZip ? (
                        <><Loader2 className="animate-spin" size={14} /> Zipping {currentSlideIndex + 1}/{weeklyReport!.headlines.length + 1}...</>
                      ) : (
                        <><Download size={14} /> Export ZIP</>
                      )}
                    </button>
                  </div>
                </div>

                <div className="space-y-4 flex flex-col">
                  <div className="flex justify-between items-center">
                    <p className="text-[10px] font-mono uppercase opacity-40">Generated Caption</p>
                    <p className={cn("text-[10px] font-mono uppercase", instaCaption.length > 2200 ? "text-red-500 font-bold" : "text-btc-orange/40")}>
                      {instaCaption.length} / 2200
                    </p>
                  </div>
                  <div className="flex-1 bg-btc-orange/5 border border-btc-orange/20 p-6 font-sans text-sm overflow-y-auto whitespace-pre-wrap leading-relaxed text-gray-300">
                    {generatingInsta ? (
                      <div className="flex flex-col items-center justify-center h-full gap-4 opacity-40">
                        <Loader2 className="animate-spin text-btc-orange" />
                        <p className="font-mono text-[10px] uppercase tracking-widest text-btc-orange">Synthesizing 20 Headlines...</p>
                      </div>
                    ) : instaCaption}
                  </div>
                  <button
                    onClick={() => { navigator.clipboard.writeText(instaCaption); alert("Caption copied!"); }}
                    className="w-full flex items-center justify-center gap-2 py-4 border border-btc-orange/30 text-btc-orange font-mono uppercase text-xs tracking-widest hover:bg-btc-orange/10 transition-colors"
                  >
                    <Copy size={16} /> Copy Caption
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Substack Article Modal */}
      <AnimatePresence>
        {showSubstackModal && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
            onClick={() => setShowSubstackModal(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 20 }}
              className="w-full max-w-3xl max-h-[90vh] flex flex-col bg-[#0a0a0a] border border-btc-orange/30 shadow-[0_0_40px_rgba(247,147,26,0.2)]"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-btc-orange/20 bg-btc-orange/5 shrink-0">
                <div className="flex items-center gap-3">
                  <CPMLogo size={24} />
                  <div>
                    <p className="text-[9px] font-mono uppercase tracking-[0.3em] text-btc-orange/60">ChokePoint Macro</p>
                    <p className="text-sm font-mono font-bold text-white">Substack Article</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {substackArticle && (
                    <>
                      <span className="text-[9px] font-mono text-btc-orange/50">{substackArticle.trim().split(/\s+/).length} words</span>
                      <button
                        onClick={() => { navigator.clipboard.writeText(substackArticle); alert('Article copied!'); }}
                        className="flex items-center gap-1.5 px-3 py-1.5 border border-btc-orange/30 text-btc-orange font-mono text-[9px] uppercase tracking-widest hover:bg-btc-orange/10 transition-colors"
                      >
                        <Copy size={11} /> Copy
                      </button>
                    </>
                  )}
                  <button onClick={() => setShowSubstackModal(false)} className="text-gray-500 hover:text-white transition-colors ml-1">
                    <XIcon size={16} />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-6">
                {generatingSubstack ? (
                  <div className="flex flex-col items-center justify-center h-64 gap-4 opacity-50">
                    <Loader2 className="animate-spin text-btc-orange" size={32} />
                    <p className="font-mono text-[10px] uppercase tracking-widest text-btc-orange">Synthesising 20 headlines into article...</p>
                  </div>
                ) : (
                  <div className="prose prose-invert prose-sm max-w-none font-sans text-gray-300 leading-relaxed
                    [&_h1]:text-white [&_h1]:font-serif [&_h1]:text-2xl [&_h1]:italic [&_h1]:mb-4
                    [&_h2]:text-btc-orange [&_h2]:font-mono [&_h2]:text-xs [&_h2]:uppercase [&_h2]:tracking-widest [&_h2]:mt-8 [&_h2]:mb-3
                    [&_strong]:text-white [&_p]:mb-4 [&_p]:leading-7">
                    <Markdown>{substackArticle}</Markdown>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Auto-Schedule Preview Modal */}
      <AnimatePresence>
        {showAutoScheduleModal && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-4"
            onClick={() => { if (!autoScheduleConfirming) setShowAutoScheduleModal(false); }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }}
              className="w-full max-w-2xl max-h-[90vh] flex flex-col bg-[#0a0a0a] border border-btc-orange/30 shadow-[0_0_60px_rgba(247,147,26,0.15)]"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-5 border-b border-btc-orange/20 bg-btc-orange/5 shrink-0">
                <div>
                  <p className="text-[9px] font-mono uppercase tracking-[0.3em] text-btc-orange/50 mb-0.5">Auto Schedule Preview</p>
                  <h3 className="text-base font-mono font-bold text-white">
                    {autoSchedulePreview
                      ? `${autoSchedulePreview.items.filter((i: any) => i.enabled).length} items · ${new Date(autoSchedulePreview.nextDate).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}`
                      : 'Loading preview...'}
                  </h3>
                </div>
                <button onClick={() => setShowAutoScheduleModal(false)} className="text-gray-500 hover:text-white transition-colors p-1"><XIcon size={16} /></button>
              </div>

              <div className="flex-1 overflow-y-auto p-5 space-y-2">
                {autoScheduleLoading ? (
                  <div className="flex items-center justify-center py-16 gap-3">
                    <Loader2 className="animate-spin text-btc-orange" size={20} />
                    <p className="text-xs font-mono uppercase tracking-widest text-btc-orange/50">Building schedule...</p>
                  </div>
                ) : autoSchedulePreview?.items.map((item: any, idx: number) => {
                  const typeColors: Record<string, string> = { tweet: 'text-sky-400 border-sky-400/30 bg-sky-400/5', instagram: 'text-pink-400 border-pink-400/30 bg-pink-400/5', substack: 'text-amber-400 border-amber-400/30 bg-amber-400/5' };
                  const typeIcons: Record<string, React.ReactNode> = { tweet: <Send size={11} />, instagram: <Instagram size={11} />, substack: <FileText size={11} /> };
                  const localTime = new Date(item.time).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
                  return (
                    <div key={idx} className={cn('flex items-start gap-3 p-3 border rounded-sm transition-all', item.enabled ? typeColors[item.type] : 'border-white/5 bg-white/[0.02] opacity-40')}>
                      <button onClick={() => toggleAutoScheduleItem(idx)} className="mt-0.5 shrink-0">
                        <div className={cn('w-4 h-4 border flex items-center justify-center transition-all', item.enabled ? 'bg-btc-orange border-btc-orange' : 'border-white/20')} >
                          {item.enabled && <Check size={10} className="text-black" />}
                        </div>
                      </button>
                      <div className="flex-1 min-w-0 space-y-1.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={cn('flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-widest border rounded-sm', typeColors[item.type])}>
                            {typeIcons[item.type]} {item.type}
                          </span>
                          <span className="text-[10px] font-mono text-gray-400">{localTime}</span>
                          {item.trendScore && <span className="text-[9px] font-mono text-btc-orange/40">score: {item.trendScore}</span>}
                        </div>
                        <p className="text-xs text-gray-300 leading-relaxed line-clamp-2">{item.content}</p>
                        {item.title && <p className="text-[10px] font-mono text-gray-500 italic truncate">{item.title}</p>}
                        <input
                          type="datetime-local"
                          value={new Date(item.time).toISOString().slice(0, 16)}
                          onChange={e => updateAutoScheduleTime(idx, e.target.value)}
                          className="text-[10px] font-mono bg-black/40 border border-white/10 text-gray-400 px-2 py-1 outline-none focus:border-btc-orange/40 transition-colors"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              {!autoScheduleLoading && autoSchedulePreview && (
                <div className="p-5 border-t border-btc-orange/20 shrink-0 flex items-center justify-between gap-3">
                  <p className="text-[10px] font-mono text-gray-500">
                    {autoSchedulePreview.items.filter((i: any) => i.enabled).length} of {autoSchedulePreview.items.length} items enabled
                  </p>
                  <div className="flex gap-2">
                    <button onClick={() => setShowAutoScheduleModal(false)} className="px-4 py-2 text-[10px] font-mono uppercase tracking-widest border border-white/10 text-gray-400 hover:border-white/30 transition-colors">Cancel</button>
                    <button
                      onClick={handleAutoScheduleConfirm}
                      disabled={autoScheduleConfirming || autoSchedulePreview.items.every((i: any) => !i.enabled)}
                      className="flex items-center gap-2 px-6 py-2 bg-btc-orange text-black text-[10px] font-mono font-bold uppercase tracking-widest hover:opacity-90 disabled:opacity-50 transition-all"
                    >
                      {autoScheduleConfirming ? <><Loader2 size={12} className="animate-spin" /> Scheduling...</> : <><Calendar size={12} /> Confirm Schedule</>}
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
