import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Twitter, Linkedin, AtSign, MessageSquare, Loader2, Send, Clock, Check, X as XIcon } from 'lucide-react';
import { cn } from '../lib/utils';
import { apiFetch } from '../lib/api';
import { BackButton } from './BackButton';
import type { UserData, SocialAccount } from '../types';

export const Compose = ({ user }: { user: UserData | null }) => {
  const location = useLocation();
  const [content, setContent] = useState(location.state?.content || '');
  const [loading, setLoading] = useState(false);
  const [platforms, setPlatforms] = useState<string[]>(['x']);
  const [socialAccounts, setSocialAccounts] = useState<SocialAccount[]>([]);
  const [postResults, setPostResults] = useState<Record<string, { success: boolean; error?: string }> | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    apiFetch('/api/social/accounts').then(r => r.ok ? r.json() : { accounts: [] })
      .then(data => setSocialAccounts(data.accounts || []));
  }, []);

  useEffect(() => {
    if (location.state?.autoSchedule) {
      const timer = setTimeout(() => handleSchedule(), 500);
      return () => clearTimeout(timer);
    }
  }, []);

  const isConnected = (platform: string) => {
    if (platform === 'x') return !!user;
    return socialAccounts.some(a => a.platform === platform);
  };

  const togglePlatform = (platform: string) => {
    setPlatforms(prev => prev.includes(platform) ? prev.filter(p => p !== platform) : [...prev, platform]);
  };

  const handlePost = async () => {
    if (!content.trim()) return alert("Cannot post empty content.");
    setLoading(true);
    setPostResults(null);
    const results: Record<string, { success: boolean; error?: string }> = {};

    if (platforms.includes('x')) {
      if (!user) { results.x = { success: false, error: "X not connected" }; }
      else {
        const res = await apiFetch('/api/post-to-x', { method: 'POST', body: JSON.stringify({ text: content }) });
        const data = await res.json();
        results.x = res.ok && data.success ? { success: true } : { success: false, error: data.error || 'Failed' };
      }
    }

    const otherPlatforms = platforms.filter(p => p !== 'x');
    if (otherPlatforms.length > 0) {
      const res = await apiFetch('/api/social/post', { method: 'POST', body: JSON.stringify({ text: content, platforms: otherPlatforms }) });
      const data = await res.json();
      if (data.results) Object.assign(results, data.results);
    }

    setPostResults(results);
    const allSuccess = Object.values(results).every(r => r.success);
    if (allSuccess) { setTimeout(() => { setContent(''); navigate('/'); }, 1500); }
    setLoading(false);
  };

  const handleSchedule = async () => {
    if (!user) return alert("Please connect your X account first.");
    const dateStr = prompt("Enter scheduled date/time (YYYY-MM-DD HH:mm):", new Date(Date.now() + 3600000).toISOString().substring(0, 16).replace('T', ' '));
    if (!dateStr) return;
    setLoading(true);
    try {
      const res = await apiFetch('/api/schedule-post', { method: 'POST', body: JSON.stringify({ content, scheduledAt: dateStr }) });
      if (res.ok) { alert("Scheduled successfully!"); navigate('/schedule'); }
    } finally { setLoading(false); }
  };

  const PLATFORM_LIST = [
    { id: 'x', label: 'X', icon: <Twitter size={14} />, color: 'bg-black' },
    { id: 'bluesky', label: 'Bluesky', icon: <AtSign size={14} />, color: 'bg-sky-600' },
    { id: 'linkedin', label: 'LinkedIn', icon: <Linkedin size={14} />, color: 'bg-blue-700' },
    { id: 'threads', label: 'Threads', icon: <MessageSquare size={14} />, color: 'bg-black' },
  ];

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <BackButton />
      <div className="border-b border-[#141414] pb-6">
        <h1 className="text-4xl font-serif italic">Compose Broadcast</h1>
        <p className="text-xs font-mono uppercase tracking-widest opacity-40">Draft your update</p>
      </div>

      <div className="bg-[#0a0a0a] border border-btc-orange/30 p-8 space-y-6 shadow-[0_0_30px_rgba(247,147,26,0.05)]">
        <div className="space-y-2">
          <p className="text-[10px] font-mono uppercase tracking-widest text-btc-orange/40">Post To</p>
          <div className="flex flex-wrap gap-2">
            {PLATFORM_LIST.map(p => {
              const connected = isConnected(p.id);
              const selected = platforms.includes(p.id);
              return (
                <button
                  key={p.id}
                  onClick={() => connected ? togglePlatform(p.id) : null}
                  disabled={!connected}
                  className={cn(
                    "flex items-center gap-2 px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest border transition-all",
                    selected && connected ? "bg-btc-orange border-btc-orange text-black" : "border-btc-orange/20 text-gray-500",
                    !connected && "opacity-30 cursor-not-allowed"
                  )}
                  title={!connected ? `${p.label} not connected — go to Settings` : undefined}
                >
                  {p.icon} {p.label}
                  {selected && connected && <Check size={10} />}
                  {!connected && <span className="text-[8px]">(not connected)</span>}
                </button>
              );
            })}
          </div>
        </div>

        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="What's the market update?"
          className="w-full h-48 p-4 font-mono text-sm bg-black/40 border border-btc-orange/20 text-white focus:border-btc-orange outline-none resize-none transition-all"
          maxLength={280}
        />

        <div className="flex justify-between items-center">
          <span className="text-[10px] font-mono uppercase opacity-40 text-btc-orange/60">{content.length} / 280</span>
          <div className="flex gap-4">
            <button
              onClick={handleSchedule}
              disabled={!content || loading}
              className="flex items-center gap-2 px-6 py-3 border border-btc-orange/30 text-btc-orange text-xs font-mono uppercase tracking-widest hover:bg-btc-orange/10 transition-colors disabled:opacity-50"
            >
              <Clock size={14} /> Schedule (X)
            </button>
            <button
              onClick={handlePost}
              disabled={!content || loading || platforms.length === 0}
              className="flex items-center gap-2 px-6 py-3 bg-btc-orange text-black text-xs font-mono uppercase tracking-widest hover:shadow-[0_0_15px_rgba(247,147,26,0.4)] transition-all disabled:opacity-50"
            >
              {loading ? <Loader2 className="animate-spin" size={14} /> : <Send size={14} />}
              Post Now
            </button>
          </div>
        </div>

        {postResults && (
          <div className="space-y-2 pt-2 border-t border-btc-orange/10">
            {Object.entries(postResults).map(([platform, result]) => (
              <div key={platform} className={cn("flex items-center gap-2 text-xs font-mono", result.success ? "text-emerald-400" : "text-red-400")}>
                {result.success ? <Check size={12} /> : <XIcon size={12} />}
                <span className="uppercase">{platform}</span>: {result.success ? 'Posted successfully' : result.error}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
