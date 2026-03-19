import { useState, useEffect } from 'react';
import { FileText, Trash2, ChevronDown, ChevronUp, Loader2, Search, X as XIcon } from 'lucide-react';
import Markdown from 'react-markdown';
import { cn } from '../lib/utils';
import { apiFetch } from '../lib/api';
import { getReportColor } from '../lib/reportThemes';
import { BackButton } from './BackButton';
import type { WeeklyReport, ForecastReport } from '../services/geminiService';

type ReportRecord = {
  id: string;
  type: string;
  custom_topic: string | null;
  updated_at: string;
  content: WeeklyReport | ForecastReport;
};

const TYPE_LABELS: Record<string, string> = {
  equities:     'S&P 500',
  nasdaq:       'Nasdaq-100',
  crypto:       'Crypto Pulse',
  conspiracies: 'Conspiracies',
  global:       'Global Pulse',
  forecast:     '7-Day Forecast',
  china:        'China Supply Chain',
  speculation:  'Speculation',
  custom:       'Custom',
};

const ALL_TYPES = ['all', 'global', 'crypto', 'equities', 'nasdaq', 'forecast', 'china', 'conspiracies', 'speculation', 'custom'];

function isForecast(r: ReportRecord) { return r.type === 'forecast'; }

function headlineCount(r: ReportRecord): number {
  const c = r.content as any;
  return c?.headlines?.length ?? c?.events?.length ?? 0;
}

function reportSummary(r: ReportRecord): string {
  const c = r.content as any;
  return c?.analysis?.overallSummary || c?.analysis?.dominantTheme || '';
}

export const Reports = () => {
  const [reports, setReports] = useState<ReportRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterType, setFilterType] = useState('all');
  const [search, setSearch] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => { fetchReports(); }, []);

  const fetchReports = async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/reports');
      if (res.ok) setReports(await res.json());
    } finally {
      setLoading(false);
    }
  };

  const deleteReport = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Delete this report?')) return;
    setDeleting(id);
    await apiFetch(`/api/reports/${id}`, { method: 'DELETE' });
    setDeleting(null);
    if (expandedId === id) setExpandedId(null);
    fetchReports();
  };

  const clearAll = async () => {
    if (!confirm('Delete ALL reports? This cannot be undone.')) return;
    await apiFetch('/api/reports', { method: 'DELETE' });
    setReports([]);
    setExpandedId(null);
  };

  const filtered = reports.filter(r => {
    const matchType = filterType === 'all' || r.type === filterType;
    const q = search.toLowerCase();
    const matchSearch = !q ||
      r.type.includes(q) ||
      (r.custom_topic || '').toLowerCase().includes(q) ||
      reportSummary(r).toLowerCase().includes(q);
    return matchType && matchSearch;
  });

  const grouped = filtered.reduce((acc: Record<string, ReportRecord[]>, r) => {
    const date = new Date(r.updated_at).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    (acc[date] = acc[date] || []).push(r);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <BackButton />

      {/* Header */}
      <div className="flex items-start justify-between border-b border-btc-orange/20 pb-5">
        <div>
          <h1 className="text-3xl font-serif italic text-white bitcoin-glow">Report Archive</h1>
          <p className="text-[10px] font-mono uppercase tracking-widest text-btc-orange/40 mt-1">
            {reports.length} report{reports.length !== 1 ? 's' : ''} stored
          </p>
        </div>
        {reports.length > 0 && (
          <button
            onClick={clearAll}
            className="flex items-center gap-2 px-3 py-2 border border-red-500/30 text-red-500/60 hover:text-red-400 hover:border-red-500/60 text-[10px] font-mono uppercase tracking-widest transition-colors"
          >
            <Trash2 size={12} /> Clear All
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Search */}
        <div className="relative flex-1 max-w-xs">
          <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search reports..."
            className="w-full pl-8 pr-8 py-2 bg-black/40 border border-btc-orange/15 text-xs font-mono text-white placeholder-gray-600 focus:border-btc-orange/40 outline-none"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-600 hover:text-white">
              <XIcon size={12} />
            </button>
          )}
        </div>

        {/* Type filter */}
        <div className="flex flex-wrap gap-1">
          {ALL_TYPES.map(t => (
            <button
              key={t}
              onClick={() => setFilterType(t)}
              className={cn(
                'px-3 py-1.5 text-[9px] font-mono uppercase tracking-widest border transition-colors',
                filterType === t
                  ? 'bg-btc-orange border-btc-orange text-black'
                  : 'border-btc-orange/20 text-gray-500 hover:text-btc-orange'
              )}
            >
              {t === 'all' ? 'All' : (TYPE_LABELS[t] || t)}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="py-20 flex justify-center">
          <Loader2 className="animate-spin text-btc-orange/30" size={24} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-20 text-center border-2 border-dashed border-btc-orange/10">
          <FileText className="mx-auto text-btc-orange opacity-10 mb-4" size={48} />
          <p className="text-xs font-mono uppercase tracking-widest text-btc-orange/30">No reports found</p>
          <p className="text-[10px] font-mono text-gray-600 mt-2">
            {reports.length === 0 ? 'Generate a report from the Briefing page to get started' : 'Try adjusting your filters'}
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {Object.entries(grouped).map(([date, dayReports]) => (
            <div key={date} className="space-y-2">
              <div className="flex items-center gap-3">
                <p className="text-[10px] font-mono uppercase tracking-widest text-btc-orange/50">{date}</p>
                <div className="flex-1 h-px bg-btc-orange/10" />
                <span className="text-[9px] font-mono text-gray-600">{dayReports.length} report{dayReports.length !== 1 ? 's' : ''}</span>
              </div>
              {dayReports.map(r => (
                <ReportCard
                  key={r.id}
                  report={r}
                  expanded={expandedId === r.id}
                  onToggle={() => setExpandedId(expandedId === r.id ? null : r.id)}
                  onDelete={deleteReport}
                  deleting={deleting === r.id}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Report Card ──────────────────────────────────────────────────────────────

const ReportCard = ({
  report, expanded, onToggle, onDelete, deleting,
}: {
  report: ReportRecord;
  expanded: boolean;
  onToggle: () => void;
  onDelete: (id: string, e: React.MouseEvent) => void;
  deleting: boolean;
}) => {
  const { hex } = getReportColor(report.type);
  const label = report.type === 'custom' && report.custom_topic
    ? report.custom_topic
    : (TYPE_LABELS[report.type] || report.type);
  const count = headlineCount(report);
  const summary = reportSummary(report);
  const forecast = isForecast(report);
  const content = report.content as any;

  return (
    <div className={cn(
      'border transition-colors',
      expanded ? 'border-btc-orange/30 bg-[#0a0a0a]' : 'border-btc-orange/10 bg-[#0a0a0a] hover:border-btc-orange/20'
    )}>
      {/* Card header — always visible */}
      <button
        onClick={onToggle}
        className="w-full flex items-start gap-4 p-4 text-left"
      >
        {/* Color bar */}
        <div className="w-1 self-stretch rounded-full shrink-0" style={{ backgroundColor: hex }} />

        {/* Meta */}
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="text-[9px] font-mono uppercase tracking-widest px-2 py-0.5 border"
              style={{ color: hex, borderColor: `${hex}40`, backgroundColor: `${hex}10` }}
            >
              {label}
            </span>
            <span className="text-[9px] font-mono text-gray-600">
              {new Date(report.updated_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
            </span>
            {count > 0 && (
              <span className="text-[9px] font-mono text-gray-600">
                {count} {forecast ? 'events' : 'headlines'}
              </span>
            )}
          </div>
          {summary && (
            <p className="text-xs text-gray-400 leading-relaxed line-clamp-2">{summary}</p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={e => onDelete(report.id, e)}
            disabled={deleting}
            className="p-1.5 text-red-500/30 hover:text-red-400 hover:bg-red-500/10 transition-colors"
          >
            {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
          </button>
          {expanded ? <ChevronUp size={14} className="text-btc-orange/50" /> : <ChevronDown size={14} className="text-gray-600" />}
        </div>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-btc-orange/10 p-4 space-y-6">
          {forecast ? (
            <ForecastContent report={content as ForecastReport} hex={hex} />
          ) : (
            <WeeklyContent report={content as WeeklyReport} hex={hex} />
          )}
        </div>
      )}
    </div>
  );
};

// ─── Weekly Report Content ────────────────────────────────────────────────────

const WeeklyContent = ({ report, hex }: { report: WeeklyReport; hex: string }) => (
  <div className="space-y-6">
    {report.analysis && (
      <div className="p-4 border" style={{ borderColor: `${hex}30`, backgroundColor: `${hex}08` }}>
        <p className="text-[9px] font-mono uppercase tracking-widest mb-2" style={{ color: `${hex}80` }}>Analysis</p>
        <p className="text-xs text-gray-300 leading-relaxed">{report.analysis.overallSummary}</p>
        {report.analysis.performanceRanking && (
          <p className="text-[10px] font-mono text-gray-500 mt-2">{report.analysis.performanceRanking}</p>
        )}
      </div>
    )}
    <div className="space-y-3">
      {report.headlines?.map((h, i) => (
        <div key={i} className="flex gap-3 p-3 bg-black/40 border border-white/5">
          <span className="text-[10px] font-mono text-btc-orange/40 w-5 shrink-0 pt-0.5">{String(i + 1).padStart(2, '0')}</span>
          <div className="space-y-1 min-w-0">
            <p className="text-xs font-mono font-bold text-white">{h.title}</p>
            <p className="text-[11px] text-gray-400 leading-relaxed">{h.summary}</p>
            {h.sentiment && (
              <span className="text-[8px] font-mono uppercase px-1.5 py-0.5 border border-btc-orange/20 text-btc-orange/60">{h.sentiment}</span>
            )}
          </div>
        </div>
      ))}
    </div>
    {report.analysis?.globalSocialPost && (
      <div className="p-3 bg-black/40 border border-btc-orange/10">
        <p className="text-[9px] font-mono uppercase tracking-widest text-btc-orange/40 mb-1.5">Social Post</p>
        <p className="text-xs font-mono text-gray-300">{report.analysis.globalSocialPost}</p>
      </div>
    )}
  </div>
);

// ─── Forecast Report Content ──────────────────────────────────────────────────

const ForecastContent = ({ report, hex }: { report: ForecastReport; hex: string }) => (
  <div className="space-y-6">
    {report.analysis && (
      <div className="p-4 border" style={{ borderColor: `${hex}30`, backgroundColor: `${hex}08` }}>
        <p className="text-[9px] font-mono uppercase tracking-widest mb-2" style={{ color: `${hex}80` }}>Analysis</p>
        <p className="text-xs font-mono font-bold text-white">{report.analysis.dominantTheme}</p>
        <p className="text-[10px] text-gray-400 mt-1">Highest impact: {report.analysis.highestImpactEvent}</p>
        <p className="text-[10px] text-gray-400">Risk level: {report.analysis.overallRiskLevel}</p>
      </div>
    )}
    <div className="space-y-3">
      {report.events?.map((ev, i) => (
        <div key={i} className="p-3 bg-black/40 border border-white/5 space-y-1.5">
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-mono font-bold text-white">{ev.title}</p>
            <span className="shrink-0 text-[9px] font-mono text-btc-orange/50 border border-btc-orange/20 px-1.5 py-0.5">
              {ev.probability}%
            </span>
          </div>
          <p className="text-[10px] text-gray-500 font-mono">{ev.expectedDate}</p>
          <p className="text-[11px] text-gray-400 leading-relaxed">{ev.summary}</p>
        </div>
      ))}
    </div>
  </div>
);
