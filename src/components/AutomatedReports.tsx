import { useState, useEffect } from 'react';
import { Clock, ChevronDown, ChevronUp, Loader2, Trash2 } from 'lucide-react';
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
  auto_generated: number;
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

function isForecast(r: ReportRecord) { return r.type === 'forecast'; }

export const AutomatedReports = () => {
  const [reports, setReports] = useState<ReportRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => { fetchReports(); }, []);

  const fetchReports = async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/reports/automated');
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
    setReports(prev => prev.filter(r => r.id !== id));
  };

  const grouped = reports.reduce((acc: Record<string, ReportRecord[]>, r) => {
    const date = new Date(r.updated_at).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    (acc[date] = acc[date] || []).push(r);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <BackButton />

      <div className="flex items-start justify-between border-b border-btc-orange/20 pb-5">
        <div>
          <h1 className="text-3xl font-serif italic text-white bitcoin-glow">Automated Reports</h1>
          <p className="text-[10px] font-mono uppercase tracking-widest text-btc-orange/40 mt-1">
            <Clock size={10} className="inline mr-1" />
            {reports.length} auto-generated report{reports.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="py-20 flex justify-center">
          <Loader2 className="animate-spin text-btc-orange/30" size={24} />
        </div>
      ) : reports.length === 0 ? (
        <div className="py-20 text-center border-2 border-dashed border-btc-orange/10">
          <Clock className="mx-auto text-btc-orange opacity-10 mb-4" size={48} />
          <p className="text-xs font-mono uppercase tracking-widest text-btc-orange/30">No automated reports yet</p>
          <p className="text-[10px] font-mono text-gray-600 mt-2">Configure a schedule in Settings to auto-generate reports</p>
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
                <AutoReportCard
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

const AutoReportCard = ({
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
  const forecast = isForecast(report);
  const content = report.content as any;
  const summary = content?.analysis?.overallSummary || content?.analysis?.dominantTheme || '';
  const count = content?.headlines?.length ?? content?.events?.length ?? 0;

  return (
    <div className={cn(
      'border transition-colors',
      expanded ? 'border-btc-orange/30 bg-[#0a0a0a]' : 'border-btc-orange/10 bg-[#0a0a0a] hover:border-btc-orange/20'
    )}>
      <button onClick={onToggle} className="w-full flex items-center gap-4 p-4 text-left">
        {/* Color bar */}
        <div className="w-1 self-stretch rounded-full shrink-0 min-h-[2.5rem]" style={{ backgroundColor: hex }} />

        {/* Name block */}
        <div
          className="flex items-center justify-center px-4 py-2 shrink-0 min-w-[120px]"
          style={{ backgroundColor: `${hex}15`, border: `1px solid ${hex}40` }}
        >
          <span className="text-[10px] font-mono font-bold uppercase tracking-widest" style={{ color: hex }}>
            {label}
          </span>
        </div>

        {/* Meta */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[9px] font-mono text-gray-600">
              {new Date(report.updated_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
            </span>
            {count > 0 && (
              <span className="text-[9px] font-mono text-gray-600">
                · {count} {forecast ? 'events' : 'headlines'}
              </span>
            )}
          </div>
          {summary && (
            <p className="text-xs text-gray-400 leading-relaxed line-clamp-1 mt-0.5">{summary}</p>
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

// ─── Weekly Content ───────────────────────────────────────────────────────────

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

// ─── Forecast Content ─────────────────────────────────────────────────────────

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
