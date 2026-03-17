import React, { useState, useEffect } from 'react';
import { Calendar, Loader2, Trash2, Send, Instagram, FileText } from 'lucide-react';
import { cn } from '../lib/utils';
import { apiFetch } from '../lib/api';
import { BackButton } from './BackButton';
import type { ScheduledPost } from '../types';

const WEEKLY_CALENDAR = [
  { day: 'Sunday',    type: 'forecast',     label: '7-Day Forecast', color: 'text-purple-400',  border: 'border-purple-400/30', bg: 'bg-purple-400/5' },
  { day: 'Monday',    type: 'crypto',       label: 'Crypto Pulse',   color: 'text-yellow-400',  border: 'border-yellow-400/30', bg: 'bg-yellow-400/5' },
  { day: 'Tuesday',   type: 'nasdaq',       label: 'Nasdaq-100',     color: 'text-sky-400',     border: 'border-sky-400/30',    bg: 'bg-sky-400/5' },
  { day: 'Wednesday', type: 'conspiracies', label: 'Conspiracies',   color: 'text-red-400',     border: 'border-red-400/30',    bg: 'bg-red-400/5' },
  { day: 'Thursday',  type: 'equities',     label: 'S&P 500',        color: 'text-green-400',   border: 'border-green-400/30',  bg: 'bg-green-400/5' },
  { day: 'Friday',    type: 'global',       label: 'Global Pulse',   color: 'text-btc-orange',  border: 'border-btc-orange/30', bg: 'bg-btc-orange/5' },
  { day: 'Saturday',  type: null,           label: 'Rest',           color: 'text-gray-600',    border: 'border-white/5',       bg: 'bg-white/[0.02]' },
];

export const Schedule = () => {
  const [posts, setPosts] = useState<ScheduledPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'timeline' | 'calendar'>('timeline');
  const [filterType, setFilterType] = useState<'all' | 'tweet' | 'instagram' | 'substack'>('all');
  const [schedules, setSchedules] = useState<any[]>([]);

  useEffect(() => { fetchAll(); }, []);

  const fetchAll = async () => {
    try {
      const [postsRes, schedRes] = await Promise.all([
        apiFetch('/api/scheduled-posts'),
        apiFetch('/api/scheduled-reports'),
      ]);
      if (postsRes.ok) setPosts(await postsRes.json());
      if (schedRes.ok) setSchedules(await schedRes.json());
    } finally { setLoading(false); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Cancel this scheduled post?")) return;
    await apiFetch(`/api/scheduled-posts/${id}`, { method: 'DELETE' });
    fetchAll();
  };

  const toggleSchedule = async (id: number, enabled: number) => {
    await apiFetch(`/api/scheduled-reports/${id}`, { method: 'PATCH', body: JSON.stringify({ enabled: enabled ? 0 : 1 }) });
    fetchAll();
  };

  const postTypeFromContent = (content: string) =>
    content.startsWith('[INSTAGRAM]') ? 'instagram' :
    content.startsWith('[SUBSTACK]') ? 'substack' : 'tweet';

  const filtered = posts.filter(p => filterType === 'all' || postTypeFromContent(p.content) === filterType);

  const grouped = filtered.reduce((acc: Record<string, ScheduledPost[]>, post) => {
    const dateKey = new Date(post.scheduled_at).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    (acc[dateKey] = acc[dateKey] || []).push(post);
    return acc;
  }, {});

  const pending = posts.filter(p => p.status === 'pending').length;
  const posted  = posts.filter(p => p.status === 'posted').length;
  const failed  = posts.filter(p => p.status === 'failed').length;

  const typeStyle: Record<string, { color: string; label: string; icon: React.ReactNode }> = {
    tweet:     { color: 'text-sky-400 border-sky-400/30 bg-sky-400/5',     label: 'Tweet',     icon: <Send size={10} /> },
    instagram: { color: 'text-pink-400 border-pink-400/30 bg-pink-400/5',  label: 'Instagram', icon: <Instagram size={10} /> },
    substack:  { color: 'text-amber-400 border-amber-400/30 bg-amber-400/5', label: 'Substack', icon: <FileText size={10} /> },
  };

  return (
    <div className="space-y-6">
      <BackButton />

      <div className="flex items-center justify-between border-b border-btc-orange/20 pb-5">
        <div>
          <h1 className="text-3xl font-serif italic text-white bitcoin-glow">Broadcast Schedule</h1>
          <p className="text-[10px] font-mono uppercase tracking-widest text-btc-orange/40 mt-1">Content distribution pipeline</p>
        </div>
        <div className="flex gap-3">
          <div className="px-3 py-2 border border-amber-400/20 bg-amber-400/5 text-center">
            <p className="text-[8px] font-mono uppercase opacity-50">Pending</p>
            <p className="text-sm font-mono font-bold text-amber-400">{pending}</p>
          </div>
          <div className="px-3 py-2 border border-green-400/20 bg-green-400/5 text-center">
            <p className="text-[8px] font-mono uppercase opacity-50">Posted</p>
            <p className="text-sm font-mono font-bold text-green-400">{posted}</p>
          </div>
          {failed > 0 && (
            <div className="px-3 py-2 border border-red-400/20 bg-red-400/5 text-center">
              <p className="text-[8px] font-mono uppercase opacity-50">Failed</p>
              <p className="text-sm font-mono font-bold text-red-400">{failed}</p>
            </div>
          )}
        </div>
      </div>

      <div className="flex gap-1 border-b border-btc-orange/10">
        {(['timeline', 'calendar'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={cn('px-5 py-2.5 text-[10px] font-mono uppercase tracking-widest transition-colors border-b-2 -mb-px',
              tab === t ? 'text-btc-orange border-btc-orange' : 'text-gray-500 border-transparent hover:text-gray-300'
            )}>
            {t === 'timeline' ? 'Upcoming Posts' : 'Weekly Calendar'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-20 flex justify-center"><Loader2 className="animate-spin text-btc-orange/30" size={24} /></div>
      ) : tab === 'timeline' ? (
        <div className="space-y-6">
          <div className="flex gap-1">
            {(['all', 'tweet', 'instagram', 'substack'] as const).map(f => (
              <button key={f} onClick={() => setFilterType(f)}
                className={cn('px-3 py-1.5 text-[9px] font-mono uppercase tracking-widest border transition-colors',
                  filterType === f ? 'bg-btc-orange border-btc-orange text-black' : 'border-btc-orange/20 text-gray-500 hover:text-btc-orange'
                )}>
                {f}
              </button>
            ))}
          </div>

          {Object.keys(grouped).length === 0 ? (
            <div className="py-20 text-center border-2 border-dashed border-btc-orange/10">
              <Calendar className="mx-auto text-btc-orange opacity-10 mb-4" size={48} />
              <p className="text-xs font-mono uppercase tracking-widest text-btc-orange/30">No scheduled broadcasts</p>
              <p className="text-[10px] font-mono text-gray-600 mt-2">Generate a report and click Auto Schedule to get started</p>
            </div>
          ) : (
            Object.entries(grouped).map(([date, datePosts]) => (
              <div key={date} className="space-y-2">
                <div className="flex items-center gap-3">
                  <p className="text-[10px] font-mono uppercase tracking-widest text-btc-orange/50">{date}</p>
                  <div className="flex-1 h-px bg-btc-orange/10" />
                  <span className="text-[9px] font-mono text-gray-600">{datePosts.length} items</span>
                </div>
                {datePosts.sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime()).map(post => {
                  const pType = postTypeFromContent(post.content);
                  const ts = typeStyle[pType] ?? typeStyle.tweet;
                  const displayContent = post.content.replace(/^\[(INSTAGRAM|SUBSTACK)\]\s*/, '');
                  return (
                    <div key={post.id} className="flex items-start gap-3 p-4 bg-[#0a0a0a] border border-btc-orange/15 hover:border-btc-orange/30 transition-colors">
                      <div className="shrink-0 w-16 text-center pt-0.5">
                        <p className="text-[11px] font-mono font-bold text-white">{new Date(post.scheduled_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</p>
                        <p className="text-[9px] font-mono text-gray-600">EST</p>
                      </div>
                      <div className="flex-1 min-w-0 space-y-1.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={cn('flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-mono uppercase border rounded-sm', ts.color)}>
                            {ts.icon} {ts.label}
                          </span>
                          <span className={cn('text-[8px] font-mono uppercase px-1.5 py-0.5 border rounded-sm',
                            post.status === 'pending' ? 'text-amber-400 border-amber-400/30 bg-amber-400/5' :
                            post.status === 'posted'  ? 'text-green-400 border-green-400/30 bg-green-400/5' :
                            'text-red-400 border-red-400/30 bg-red-400/5'
                          )}>{post.status}</span>
                        </div>
                        <p className="text-xs text-gray-400 leading-relaxed line-clamp-2">{displayContent}</p>
                      </div>
                      {post.status === 'pending' && (
                        <button onClick={() => handleDelete(post.id)} className="shrink-0 p-2 text-red-500/40 hover:text-red-500 hover:bg-red-500/10 transition-colors rounded-sm">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-[10px] font-mono uppercase tracking-widest text-gray-600">Report generation runs daily at 06:00 server time. Toggle to enable/disable each day.</p>
          <div className="grid gap-2">
            {WEEKLY_CALENDAR.map(cal => {
              const sched = schedules.find((s: any) => s.report_type === cal.type);
              const isToday = new Date().toLocaleDateString('en-US', { weekday: 'long' }) === cal.day;
              return (
                <div key={cal.day} className={cn('flex items-center gap-4 p-4 border transition-colors', cal.border, cal.bg, isToday && 'shadow-[0_0_15px_rgba(247,147,26,0.08)]')}>
                  <div className="w-28 shrink-0">
                    <p className={cn('text-[11px] font-mono font-bold uppercase tracking-widest', isToday ? 'text-btc-orange' : cal.color)}>{cal.day}</p>
                    {isToday && <p className="text-[8px] font-mono text-btc-orange/50 uppercase">Today</p>}
                  </div>
                  <div className="flex-1">
                    <p className={cn('text-xs font-mono font-bold', cal.color)}>{cal.label}</p>
                    {sched ? (
                      <p className="text-[9px] font-mono text-gray-600 mt-0.5">
                        {sched.last_run ? `Last run: ${new Date(sched.last_run).toLocaleDateString()}` : 'Not yet run'}
                        {' · '}06:00 server time
                      </p>
                    ) : (
                      <p className="text-[9px] font-mono text-gray-600 mt-0.5">{cal.type ? '06:00 server time' : 'No report scheduled'}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {sched && (
                      <button
                        onClick={() => toggleSchedule(sched.id, sched.enabled)}
                        className={cn('relative w-10 h-5 rounded-full transition-colors', sched.enabled ? 'bg-btc-orange' : 'bg-white/10')}
                      >
                        <span className={cn('absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform', sched.enabled ? 'translate-x-5' : 'translate-x-0.5')} />
                      </button>
                    )}
                    {cal.type && (
                      <span className={cn('text-[9px] font-mono uppercase', sched?.enabled ? 'text-green-400' : 'text-gray-600')}>
                        {sched?.enabled ? 'Active' : cal.type ? 'Disabled' : ''}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
