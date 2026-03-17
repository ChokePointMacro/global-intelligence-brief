import React, { useState, useEffect, useRef } from 'react';
import {
  BrowserRouter,
  Routes,
  Route,
  Link,
  useNavigate,
  useLocation
} from 'react-router-dom';
import {
  FileText,
  TrendingUp,
  Globe,
  ExternalLink,
  Loader2,
  RefreshCw,
  Clock,
  ChevronRight,
  ChevronLeft,
  Twitter,
  Copy,
  User,
  Settings as SettingsIcon,
  Calendar,
  LogOut,
  ChevronDown,
  Trash2,
  Send,
  Instagram,
  Download,
  Bell,
  Mail,
  Volume2,
  Plus,
  Link2,
  Linkedin,
  AtSign,
  MessageSquare,
  X as XIcon,
  Check,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { type WeeklyReport, type ForecastReport } from './services/geminiService';
import Markdown from 'react-markdown';
import html2canvas from 'html2canvas';
import JSZip from 'jszip';
import MatrixBackground from './components/MatrixBackground';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function truncateToWords(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) return text;
  return words.slice(0, maxWords).join(' ') + '...';
}

// ─── ChokePoint Macro Brand ───────────────────────────────────────────────────

const CPMLogo = ({ size = 32, className = "" }: { size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
    {/* Matrix dot grid */}
    {[8,16,24,32,40].flatMap(x => [8,16,24,32,40].map(y =>
      <circle key={`${x}-${y}`} cx={x} cy={y} r="0.7" fill="#f7931a" opacity="0.18" />
    ))}
    {/* Outer frame */}
    <rect x="3" y="3" width="42" height="42" stroke="#f7931a" strokeWidth="0.8" opacity="0.25" />
    {/* Corner brackets — circuit board style */}
    <polyline points="3,13 3,3 13,3" stroke="#f7931a" strokeWidth="2" fill="none" />
    <polyline points="35,3 45,3 45,13" stroke="#f7931a" strokeWidth="2" fill="none" />
    <polyline points="45,35 45,45 35,45" stroke="#f7931a" strokeWidth="2" fill="none" />
    <polyline points="13,45 3,45 3,35" stroke="#f7931a" strokeWidth="2" fill="none" />
    {/* Base / floor line */}
    <line x1="8" y1="36" x2="40" y2="36" stroke="#f7931a" strokeWidth="1" opacity="0.35" />
    {/* Price chart line — chokepoint funnel shape rising */}
    <polyline points="8,32 14,28 19,30 24,20 30,23 36,15 40,13"
      stroke="#f7931a" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    {/* Arrow tip */}
    <polyline points="34,10 40,13 37,19" stroke="#f7931a" strokeWidth="2" strokeLinecap="round" fill="none" />
    {/* Chokepoint vertical bars — the "bottleneck" */}
    <line x1="18" y1="13" x2="18" y2="37" stroke="#f7931a" strokeWidth="1" opacity="0.3" />
    <line x1="30" y1="13" x2="30" y2="37" stroke="#f7931a" strokeWidth="1" opacity="0.3" />
  </svg>
);

// img-based version for use inside Instagram slides — html2canvas cannot render inline SVG
const CPMLogoImg = ({ size = 32, style = {} }: { size?: number; style?: React.CSSProperties }) => {
  const svg = `<svg width="${size}" height="${size}" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="3" width="42" height="42" stroke="%23f7931a" stroke-width="0.8" opacity="0.25"/><polyline points="3,13 3,3 13,3" stroke="%23f7931a" stroke-width="2" fill="none"/><polyline points="35,3 45,3 45,13" stroke="%23f7931a" stroke-width="2" fill="none"/><polyline points="45,35 45,45 35,45" stroke="%23f7931a" stroke-width="2" fill="none"/><polyline points="13,45 3,45 3,35" stroke="%23f7931a" stroke-width="2" fill="none"/><line x1="8" y1="36" x2="40" y2="36" stroke="%23f7931a" stroke-width="1" opacity="0.35"/><polyline points="8,32 14,28 19,30 24,20 30,23 36,15 40,13" stroke="%23f7931a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/><polyline points="34,10 40,13 37,19" stroke="%23f7931a" stroke-width="2" stroke-linecap="round" fill="none"/><line x1="18" y1="13" x2="18" y2="37" stroke="%23f7931a" stroke-width="1" opacity="0.3"/><line x1="30" y1="13" x2="30" y2="37" stroke="%23f7931a" stroke-width="1" opacity="0.3"/></svg>`;
  return <img src={`data:image/svg+xml,${svg}`} width={size} height={size} style={{ display: 'block', ...style }} />;
};

// ─── Email Auth Modal ─────────────────────────────────────────────────────────

const AuthModal = ({ onClose, onSuccess }: { onClose: () => void; onSuccess: (user: UserData) => void }) => {
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const endpoint = tab === 'login' ? '/api/auth/login' : '/api/auth/register';
      const body = tab === 'login' ? { email, password } : { email, password, displayName };
      const res = await apiFetch(endpoint, { method: 'POST', body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Authentication failed'); return; }

      // Save session ID so subsequent apiFetch calls include it as x-session-id header
      if (data.sessionId) window.localStorage.setItem('debug_sid', data.sessionId);

      // Re-fetch user profile
      const meRes = await apiFetch('/api/auth/me');
      if (meRes.ok) {
        const me = await meRes.json();
        onSuccess(me);
        onClose();
      }
    } catch {
      setError('Connection error — please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="w-full max-w-md mx-4 bg-[#0a0a0a] border border-btc-orange/30 shadow-[0_0_40px_rgba(247,147,26,0.2)]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-btc-orange/20 bg-btc-orange/5">
          <div className="flex items-center gap-3">
            <CPMLogo size={28} />
            <div>
              <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-btc-orange/60">ChokePoint Macro</p>
              <p className="text-sm font-mono font-bold text-white">Intelligence Access</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors"><XIcon size={18} /></button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-btc-orange/20">
          {(['login', 'register'] as const).map(t => (
            <button key={t} onClick={() => { setTab(t); setError(''); }}
              className={cn("flex-1 py-3 text-[10px] font-mono uppercase tracking-widest transition-colors",
                tab === t ? "text-btc-orange border-b-2 border-btc-orange" : "text-gray-500 hover:text-gray-300"
              )}>
              {t === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          ))}
        </div>

        {/* Form */}
        <form onSubmit={submit} className="p-6 space-y-4">
          {tab === 'register' && (
            <div>
              <label className="block text-[9px] font-mono uppercase tracking-widest text-btc-orange/60 mb-1.5">Display Name</label>
              <input type="text" value={displayName} onChange={e => setDisplayName(e.target.value)}
                placeholder="Your name" required
                className="w-full px-3 py-2.5 bg-black/40 border border-btc-orange/20 text-white font-mono text-sm outline-none focus:border-btc-orange/60 transition-all placeholder-gray-700" />
            </div>
          )}
          <div>
            <label className="block text-[9px] font-mono uppercase tracking-widest text-btc-orange/60 mb-1.5">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="analyst@domain.com" required
              className="w-full px-3 py-2.5 bg-black/40 border border-btc-orange/20 text-white font-mono text-sm outline-none focus:border-btc-orange/60 transition-all placeholder-gray-700" />
          </div>
          <div>
            <label className="block text-[9px] font-mono uppercase tracking-widest text-btc-orange/60 mb-1.5">Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder={tab === 'register' ? 'Min. 8 characters' : '••••••••'} required
              className="w-full px-3 py-2.5 bg-black/40 border border-btc-orange/20 text-white font-mono text-sm outline-none focus:border-btc-orange/60 transition-all placeholder-gray-700" />
          </div>
          {error && <p className="text-red-400 text-xs font-mono">{error}</p>}
          <button type="submit" disabled={loading}
            className="w-full py-3 bg-btc-orange text-black font-mono font-bold uppercase tracking-widest hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2">
            {loading ? <Loader2 size={14} className="animate-spin" /> : null}
            {tab === 'login' ? 'Sign In' : 'Create Account'}
          </button>
          <p className="text-[9px] font-mono text-gray-600 text-center">
            Reports are publicly accessible. An account enables posting and personalization.
          </p>
        </form>
      </motion.div>
    </div>
  );
};

// ─── Sentiment config ─────────────────────────────────────────────────────────

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

// ─── Instagram slide themes ───────────────────────────────────────────────────

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

// ─── Types ────────────────────────────────────────────────────────────────────

interface UserData {
  id: string;
  username: string;
  displayName: string;
  profileImage: string;
  authMethod?: 'x' | 'email';
}

interface ScheduledPost {
  id: number;
  content: string;
  scheduled_at: string;
  status: 'pending' | 'posted' | 'failed';
}

interface ReportSchedule {
  id: number;
  report_type: string;
  custom_topic?: string;
  schedule_time: string;
  days: string;
  enabled: number;
  last_run?: string;
}

interface SocialAccount {
  platform: string;
  handle: string;
}

// ─── apiFetch helper ──────────────────────────────────────────────────────────

const apiFetch = async (url: string, options: RequestInit = {}) => {
  const sid = window.localStorage.getItem('debug_sid');
  const headers: Record<string, string> = {
    ...(options.headers as any),
    'Content-Type': 'application/json',
  };
  if (sid) headers['x-session-id'] = sid;
  return fetch(url, { ...options, headers, credentials: 'include' });
};

// ─── Dropdown ─────────────────────────────────────────────────────────────────

const Dropdown = ({ user, onLogout }: { user: UserData; onLogout: () => void }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 hover:opacity-80 transition-all p-1 rounded-full hover:bg-black/5"
      >
        {user.profileImage
          ? <img src={user.profileImage} alt={user.displayName} className="w-8 h-8 rounded-full border border-btc-orange/40" />
          : <div className="w-8 h-8 rounded-full border border-btc-orange/40 bg-btc-orange/10 flex items-center justify-center text-btc-orange font-mono font-bold text-xs">
              {(user.displayName || user.username || '?')[0].toUpperCase()}
            </div>
        }
        <span className="text-xs font-mono hidden sm:inline font-medium">{user.displayName}</span>
        <ChevronDown size={14} className={cn("transition-transform duration-200", isOpen && "rotate-180")} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            className="absolute right-0 mt-2 w-48 bg-[#0a0a0a] border border-btc-orange/30 shadow-[0_0_20px_rgba(247,147,26,0.2)] z-50 overflow-hidden"
          >
            <div className="p-3 border-b border-btc-orange/20 bg-btc-orange/5">
              <p className="text-[10px] uppercase font-mono tracking-widest opacity-40">Connected as</p>
              <p className="text-xs font-mono font-bold truncate text-btc-orange">@{user.username}</p>
            </div>
            <div className="p-1">
              {[
                { to: '/profile', icon: <User size={14} />, label: 'Profile' },
                { to: '/compose', icon: <Send size={14} />, label: 'Compose' },
                { to: '/schedule', icon: <Calendar size={14} />, label: 'Schedule' },
                { to: '/settings', icon: <SettingsIcon size={14} />, label: 'Settings' },
              ].map(({ to, icon, label }) => (
                <Link
                  key={to}
                  to={to}
                  onClick={() => setIsOpen(false)}
                  className="flex items-center gap-3 px-3 py-2 text-xs font-mono uppercase tracking-widest hover:bg-btc-orange/10 hover:text-btc-orange transition-colors"
                >
                  {icon} {label}
                </Link>
              ))}
              <button
                onClick={() => { setIsOpen(false); onLogout(); }}
                className="w-full flex items-center gap-3 px-3 py-2 text-xs font-mono uppercase tracking-widest hover:bg-red-600 hover:text-white transition-colors"
              >
                <LogOut size={14} /> Logout
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// ─── Layout ───────────────────────────────────────────────────────────────────

const Layout = ({ children, user, onLogout, onLogin }: { children: React.ReactNode; user: UserData | null; onLogout: () => void; onLogin: (u: UserData) => void }) => {
  const navigate = useNavigate();
  const [showAuthModal, setShowAuthModal] = useState(false);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-gray-300 font-sans selection:bg-btc-orange selection:text-black relative overflow-x-hidden">
      <MatrixBackground />

      <header className="sticky top-0 z-40 bg-[#0a0a0a]/95 backdrop-blur-md border-b border-btc-orange/20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          {/* Brand */}
          <button onClick={() => navigate('/')} className="flex items-center gap-2.5 group cursor-pointer">
            <CPMLogo size={34} className="group-hover:opacity-80 transition-opacity" />
            <div className="flex flex-col items-start leading-none">
              <span className="text-[11px] font-mono font-bold tracking-[0.25em] uppercase text-white">ChokePoint</span>
              <span className="text-[11px] font-mono font-bold tracking-[0.25em] uppercase text-btc-orange" style={{ textShadow: '0 0 8px rgba(247,147,26,0.6)' }}>Macro</span>
            </div>
          </button>

          <div className="flex items-center gap-6">
            {/* Nav — always visible */}
            <nav className="flex items-center gap-4 sm:gap-6 border-r border-btc-orange/20 pr-4 sm:pr-6">
              <Link to="/" className="text-[10px] font-mono uppercase tracking-widest hover:text-btc-orange transition-colors hidden sm:inline">Briefing</Link>
              {user && <>
                <Link to="/compose" className="text-[10px] font-mono uppercase tracking-widest hover:text-btc-orange transition-colors">Compose</Link>
                <Link to="/schedule" className="text-[10px] font-mono uppercase tracking-widest hover:text-btc-orange transition-colors hidden sm:inline">Schedule</Link>
              </>}
            </nav>

            {user ? (
              <Dropdown user={user} onLogout={onLogout} />
            ) : (
              <button
                onClick={() => setShowAuthModal(true)}
                className="flex items-center gap-2 px-4 py-2 bg-btc-orange text-black text-xs font-mono font-bold uppercase tracking-widest hover:opacity-90 transition-opacity shadow-[0_0_10px_rgba(247,147,26,0.3)]"
              >
                Sign In
              </button>
            )}
          </div>
        </div>
      </header>

      <AnimatePresence>
        {showAuthModal && (
          <AuthModal onClose={() => setShowAuthModal(false)} onSuccess={(u) => { onLogin(u); setShowAuthModal(false); }} />
        )}
      </AnimatePresence>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 relative z-10">
        {children}
      </main>

      <footer className="border-t border-btc-orange/10 py-12 mt-12 relative z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="flex items-center gap-3">
            <CPMLogo size={28} />
            <div>
              <p className="text-xs font-mono font-bold tracking-[0.2em] uppercase text-white">ChokePoint Macro</p>
              <p className="text-[10px] font-mono uppercase tracking-widest text-btc-orange/50">Intelligence Brief Platform</p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 bg-btc-orange rounded-full animate-pulse shadow-[0_0_5px_#f7931a]" />
              <span className="text-[10px] font-mono text-btc-orange/70">Live Feed Active</span>
            </div>
            <p className="text-[9px] font-mono uppercase tracking-widest opacity-30">© 2026 ChokePoint Macro</p>
          </div>
        </div>
      </footer>
    </div>
  );
};

// ─── Forecast View ────────────────────────────────────────────────────────────

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

const ForecastView = ({ report }: { report: ForecastReport }) => {
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
      {/* Header card */}
      <div className="bg-[#0a0a0a] border border-btc-orange/30 p-4 shadow-[0_0_30px_rgba(247,147,26,0.05)] relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-btc-orange to-transparent" />
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
            <div className="px-3 py-1.5 border border-btc-orange/20 bg-btc-orange/5 text-center">
              <p className="text-[8px] font-mono uppercase opacity-60">Events</p>
              <p className="text-sm font-mono font-bold text-btc-orange">{report.events.length}</p>
            </div>
          </div>
        </div>
        <div className="mt-4 pt-4 border-t border-btc-orange/10 grid md:grid-cols-2 gap-4">
          <div>
            <p className="text-[9px] font-mono uppercase tracking-widest opacity-40 mb-1">Dominant Theme</p>
            <p className="text-sm text-gray-300 font-sans leading-relaxed">{report.analysis.dominantTheme}</p>
          </div>
          <div>
            <p className="text-[9px] font-mono uppercase tracking-widest opacity-40 mb-1">Watchlist</p>
            <p className="text-sm text-gray-300 font-sans leading-relaxed">{report.analysis.watchlist}</p>
          </div>
        </div>
        <div className="mt-3 pt-3 border-t border-btc-orange/10">
          <p className="text-[9px] font-mono uppercase tracking-widest opacity-40 mb-1">Highest Impact Event</p>
          <p className="text-sm text-btc-orange/80 font-sans leading-relaxed">{report.analysis.highestImpactEvent}</p>
        </div>
        <div className="mt-3 pt-3 border-t border-btc-orange/10 flex justify-end">
          <button
            onClick={exportForecastZip}
            disabled={exportingForecast}
            className="flex items-center gap-2 px-4 py-2 bg-btc-orange text-black text-[10px] font-mono font-bold uppercase tracking-widest hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {exportingForecast
              ? <><Loader2 size={12} className="animate-spin" /> Exporting {exportIdx + 1}/{report.events.length}...</>
              : <><Download size={12} /> Export All PNGs</>}
          </button>
        </div>
      </div>

      {/* Hidden forecast slide for capture */}
      <div style={{ position: 'fixed', top: '-99999px', left: '-99999px', zIndex: -1 }}>
        <div ref={forecastSlideRef} style={{ width: 1080, height: 1350, backgroundColor: '#0a0a0a', fontFamily: 'monospace', overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: 64 }}>
          {currentEvent && (() => {
            const prob = currentEvent.probability;
            const probColor = prob >= 70 ? '#22c55e' : prob >= 40 ? '#eab308' : '#ef4444';
            return (
              <>
                {/* Header */}
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

                {/* Rank + probability */}
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

                {/* Title */}
                <h2 style={{ color: '#ffffff', fontSize: 52, fontWeight: 700, lineHeight: 1.15, marginBottom: 28, fontFamily: 'sans-serif' }}>
                  {currentEvent.title}
                </h2>

                {/* Summary */}
                <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: 22, lineHeight: 1.6, marginBottom: 40, fontFamily: 'sans-serif', flex: 1 }}>
                  {currentEvent.summary}
                </p>

                {/* Dual outcome */}
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

                {/* Tags */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 32 }}>
                  {currentEvent.markets.map((m: string) => (
                    <span key={m} style={{ padding: '4px 10px', fontSize: 13, border: '1px solid rgba(247,147,26,0.3)', color: 'rgba(247,147,26,0.8)', backgroundColor: 'rgba(247,147,26,0.08)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>{m}</span>
                  ))}
                  {currentEvent.countries.map((c: string) => (
                    <span key={c} style={{ padding: '4px 10px', fontSize: 13, border: '1px solid rgba(168,85,247,0.3)', color: 'rgba(168,85,247,0.8)', backgroundColor: 'rgba(168,85,247,0.08)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>{c}</span>
                  ))}
                </div>

                {/* Footer */}
                <div style={{ borderTop: '1px solid rgba(247,147,26,0.2)', paddingTop: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <CPMLogoImg size={28} />
                  <p style={{ color: 'rgba(247,147,26,0.4)', fontSize: 13, letterSpacing: '0.2em', textTransform: 'uppercase' }}>chokepointmacro.com</p>
                </div>
              </>
            );
          })()}
        </div>
      </div>

      {/* Event list */}
      <div className="space-y-2">
        {report.events.map((event, i) => {
          const isOpen = expanded === i;
          const sentConf = SENTIMENT_FORECAST_CONFIG[event.sentiment?.toLowerCase()] ?? { color: 'text-gray-400', label: event.sentiment };
          const probColor = event.probability >= 70 ? 'bg-green-500' : event.probability >= 40 ? 'bg-yellow-500' : 'bg-red-500';

          return (
            <div key={i} className="bg-[#0a0a0a] border border-btc-orange/20 overflow-hidden hover:border-btc-orange/40 transition-colors">
              {/* Row header — always visible */}
              <button
                className="w-full text-left p-4 flex items-center gap-4"
                onClick={() => setExpanded(isOpen ? null : i)}
              >
                {/* Rank */}
                <span className="text-2xl font-mono font-bold text-btc-orange/30 w-8 shrink-0">
                  {String(event.rank).padStart(2, '0')}
                </span>

                {/* Probability bar */}
                <div className="flex flex-col items-center gap-1 shrink-0 w-12">
                  <span className="text-[10px] font-mono text-gray-500">{event.probability}%</span>
                  <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                    <div className={cn("h-full rounded-full", probColor)} style={{ width: `${event.probability}%` }} />
                  </div>
                </div>

                {/* Title + meta */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-mono font-bold text-white leading-tight">{event.title}</p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className="text-[9px] font-mono uppercase tracking-widest text-btc-orange/50">{event.expectedDate}</span>
                    <span className="text-[9px] font-mono uppercase tracking-widest text-btc-orange/20">·</span>
                    <span className={cn("text-[9px] font-mono uppercase tracking-widest", sentConf.color)}>{sentConf.label}</span>
                    <span className="text-[9px] font-mono uppercase tracking-widest text-btc-orange/20">·</span>
                    <span className="text-[9px] font-mono uppercase tracking-widest text-gray-500">{event.category}</span>
                  </div>
                </div>

                {/* Tags (desktop) */}
                <div className="hidden md:flex gap-1 flex-wrap justify-end max-w-[260px]">
                  {event.markets.slice(0, 3).map(m => (
                    <span key={m} className="px-1.5 py-0.5 text-[8px] font-mono uppercase bg-btc-orange/10 border border-btc-orange/20 text-btc-orange/70">{m}</span>
                  ))}
                </div>

                <ChevronRight size={14} className={cn("shrink-0 text-btc-orange/30 transition-transform", isOpen && "rotate-90")} />
              </button>

              {/* Expanded detail */}
              {isOpen && (
                <div className="px-4 pb-4 space-y-4 border-t border-btc-orange/10">
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
                        {event.markets.map(m => <span key={m} className="px-1.5 py-0.5 text-[9px] font-mono bg-btc-orange/10 border border-btc-orange/20 text-btc-orange/80">{m}</span>)}
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
                      <a href={event.url} target="_blank" rel="noopener noreferrer" className="text-[9px] font-mono text-btc-orange/50 hover:text-btc-orange transition-colors underline underline-offset-2">{event.url}</a>
                      {event.alternateUrl && <a href={event.alternateUrl} target="_blank" rel="noopener noreferrer" className="text-[9px] font-mono text-btc-orange/30 hover:text-btc-orange/60 transition-colors underline underline-offset-2">{event.alternateUrl}</a>}
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

// ─── Dashboard ────────────────────────────────────────────────────────────────

const Dashboard = () => {
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingError, setLoadingError] = useState<string | null>(null);
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
  const [emailTo, setEmailTo] = useState('');
  const [sendingEmail, setSendingEmail] = useState(false);
  const [substackArticle, setSubstackArticle] = useState('');
  const [generatingSubstack, setGeneratingSubstack] = useState(false);
  const [showSubstackModal, setShowSubstackModal] = useState(false);
  const [showAutoScheduleModal, setShowAutoScheduleModal] = useState(false);
  const [autoSchedulePreview, setAutoSchedulePreview] = useState<any>(null);
  const [autoScheduleLoading, setAutoScheduleLoading] = useState(false);
  const [autoScheduleConfirming, setAutoScheduleConfirming] = useState(false);
  const instaAssetRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const navigate = useNavigate();

  const activeReportRecord = reports.find(r => r.id === activeReportId) ?? null;
  const activeReport = activeReportRecord?.content as (WeeklyReport | ForecastReport) | null;
  const isForecast = activeReportRecord?.type === 'forecast';
  const forecastReport = isForecast ? activeReport as ForecastReport : null;
  const weeklyReport = !isForecast ? activeReport as WeeklyReport : null;

  const watermark = (() => {
    try { return JSON.parse(localStorage.getItem('gib_watermark') || '{}'); } catch { return {}; }
  })();

  const getReportLabel = (r: any) => {
    if (r.type === 'custom') return r.custom_topic ? truncateToWords(r.custom_topic, 4) : 'Custom';
    const labels: Record<string, string> = { equities: 'S&P 500', nasdaq: 'Nasdaq-100', crypto: 'Crypto', conspiracies: 'Conspiracies', global: 'Global', forecast: '7-Day Forecast' };
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

  useEffect(() => { fetchReports(); }, []);

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
    setAudioUrl(null);
    abortControllerRef.current = new AbortController();

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

      // Push notification
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
        } else {
          errorMessage = err.message || errorMessage;
        }
      }
      setLoadingError(errorMessage);
    } finally {
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

  const handleEmailDigest = async () => {
    if (!activeReportId) return;
    const to = emailTo.trim() || prompt("Enter recipient email:");
    if (!to) return;
    if (emailTo !== to) setEmailTo(to);
    setSendingEmail(true);
    try {
      const res = await apiFetch('/api/email-digest', {
        method: 'POST',
        body: JSON.stringify({ reportId: activeReportId, to }),
      });
      const data = await res.json();
      if (res.ok) alert("✓ Email digest sent to " + to);
      else alert("Email failed: " + data.error);
    } catch (err) {
      alert("Email error: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSendingEmail(false);
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

  // Captures the slide element at full 1080×1350 by temporarily removing the
  // CSS scale transform (which was only there for the preview) before capturing.
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
      // Exclude the MatrixBackground canvas and any other canvases from the capture
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

      // Instagram slides
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

      // Instagram caption
      if (instaCaption) {
        instaFolder.file('caption.txt', instaCaption);
      }

      // Full report summary
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

      // Individual tweets
      weeklyReport!.headlines.forEach((h, i) => {
        const tweetContent = [
          h.socialPost,
          '',
          `Source: ${h.url}`,
        ].join('\n');
        tweetsFolder.file(`${date}-${String(i + 1).padStart(2, '0')}-${slugify(h.title)}.txt`, tweetContent);
      });

      // All tweets in one file
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
    <div className="space-y-12">
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
      <div className="flex flex-col gap-4 p-6 bg-[#0a0a0a] border border-btc-orange/30 shadow-[0_0_20px_rgba(247,147,26,0.1)] relative z-20">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex bg-btc-orange/5 p-1 rounded-sm border border-btc-orange/10 flex-wrap gap-0.5">
              {[
                { id: 'global', label: 'Global' },
                { id: 'crypto', label: 'Crypto' },
                { id: 'equities', label: 'S&P 500' },
                { id: 'nasdaq', label: 'Nasdaq-100' },
                { id: 'conspiracies', label: 'Conspiracies' },
                { id: 'forecast', label: '7-Day Forecast' },
                { id: 'custom', label: 'Custom' },
              ].map((t) => (
                <button
                  key={t.id}
                  onClick={() => setReportType(t.id)}
                  disabled={loading}
                  className={cn(
                    "px-4 py-2 text-[10px] font-mono uppercase tracking-widest transition-all",
                    reportType === t.id ? "bg-btc-orange text-black font-bold" : "text-gray-500 hover:text-btc-orange disabled:opacity-50"
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
                className="flex items-center gap-2 px-5 py-4 border border-btc-orange/40 text-btc-orange text-[10px] font-mono font-bold uppercase tracking-widest hover:bg-btc-orange/10 transition-all disabled:opacity-50"
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
                className="flex items-center gap-3 px-8 py-4 bg-btc-orange text-black font-mono font-bold uppercase tracking-widest hover:shadow-[0_0_20px_rgba(247,147,26,0.4)] transition-all"
              >
                <RefreshCw size={18} /> Generate Report
              </button>
            )}
          </div>
        </div>

        {/* Custom topic input */}
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

      {/* Error */}
      {loadingError && (
        <motion.div
          initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
          className="p-4 bg-red-500/10 border border-red-500/30 text-red-400 font-mono text-sm flex items-center justify-between gap-4"
        >
          <span>⚠️ {loadingError}</span>
          <button onClick={() => setLoadingError(null)} className="text-red-400 hover:text-red-300 transition-colors"><XIcon size={14} /></button>
        </motion.div>
      )}

      {/* Loading indicator */}
      {loading && (
        <div className="flex items-center gap-4 p-4 bg-btc-orange/5 border border-btc-orange/20">
          <Loader2 className="animate-spin text-btc-orange" size={18} />
          <p className="text-xs font-mono uppercase tracking-widest text-btc-orange/60">Claude is analyzing intelligence feeds...</p>
        </div>
      )}

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
        {/* Sidebar */}
        <div className="lg:col-span-3 space-y-6 relative z-10">
          <div className="flex items-center justify-between border-b border-btc-orange/20 pb-2">
            <h3 className="text-xs font-mono uppercase tracking-widest opacity-40">Archive</h3>
            {reports.length > 0 && (
              <button onClick={clearArchive} className="text-[8px] font-mono uppercase tracking-widest text-red-500 hover:underline">Clear All</button>
            )}
          </div>
          <div className="space-y-2">
            {reports.map((r) => (
              <div key={r.id} className="relative group/item">
                <button
                  onClick={() => setActiveReportId(r.id)}
                  className={cn(
                    "w-full text-left p-4 border transition-all flex flex-col gap-1 pr-10",
                    activeReportId === r.id
                      ? "bg-btc-orange/10 text-btc-orange border-btc-orange shadow-[0_0_10px_rgba(247,147,26,0.1)]"
                      : "bg-[#0a0a0a] border-btc-orange/10 hover:border-btc-orange/40 text-gray-400"
                  )}
                >
                  <span className="text-[10px] font-mono uppercase opacity-60">{getReportLabel(r)}</span>
                  <span className="text-xs font-medium truncate">{new Date(r.updated_at).toLocaleDateString()}</span>
                </button>
                <button
                  onClick={(e) => deleteReport(r.id, e)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-red-500 opacity-0 group-hover/item:opacity-40 hover:!opacity-100 transition-opacity hover:bg-red-500/10 rounded-sm z-10"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Report View */}
        <div className="lg:col-span-9">
          <AnimatePresence mode="wait">
            {activeReport && isForecast && forecastReport ? (
              <motion.div
                key={activeReportId || 'forecast'}
                initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
              >
                <ForecastView report={forecastReport} />
              </motion.div>
            ) : activeReport && !isForecast && weeklyReport ? (
              <motion.div
                key={activeReportId || 'empty'}
                initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
                className="space-y-3"
              >
                {/* Strategic Summary */}
                <div className="bg-[#0a0a0a] border border-btc-orange/30 p-3 space-y-3 shadow-[0_0_30px_rgba(247,147,26,0.05)] relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-btc-orange to-transparent" />

                  <div className="flex flex-col md:flex-row justify-between items-start gap-6">
                    <div className="space-y-1">
                      <h2 className="text-3xl font-serif italic text-white bitcoin-glow">Market Assessment</h2>
                      <p className="text-[9px] font-mono uppercase tracking-widest text-btc-orange/40">Pulse Check</p>
                    </div>
                    <div className="flex gap-2">
                      <div className="px-2 py-1 border border-btc-orange/20 bg-btc-orange/5 text-center">
                        <p className="text-[8px] font-mono uppercase opacity-40">Verification</p>
                        <p className="text-xs font-mono font-bold text-btc-orange">{weeklyReport!.analysis.verificationScore}</p>
                      </div>
                      <div className="px-2 py-1 border border-btc-orange/20 bg-btc-orange/5 text-center">
                        <p className="text-[8px] font-mono uppercase opacity-40">Integrity</p>
                        <p className="text-xs font-mono font-bold text-btc-orange">{weeklyReport!.analysis.integrityScore}</p>
                      </div>
                    </div>
                  </div>

                  <div className="prose prose-invert prose-sm max-w-none font-sans leading-relaxed text-gray-400">
                    <Markdown>{weeklyReport!.analysis.overallSummary}</Markdown>
                  </div>

                  {/* Audio brief player */}
                  {audioUrl && (
                    <div className="flex items-center gap-3 p-3 bg-btc-orange/5 border border-btc-orange/20 rounded-sm">
                      <Volume2 size={14} className="text-btc-orange flex-shrink-0" />
                      <audio controls src={audioUrl} className="flex-1 h-8" style={{ filter: 'invert(0.8) sepia(1) saturate(5) hue-rotate(10deg)' }} />
                      <a href={audioUrl} download="brief.mp3" className="text-[10px] font-mono text-btc-orange hover:underline uppercase">Save</a>
                    </div>
                  )}

                  <div className="pt-2 border-t border-btc-orange/10 flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-mono uppercase tracking-widest text-btc-orange/40">Actions</p>
                      <div className="flex gap-1 flex-wrap justify-end">
                        <button onClick={() => handlePost(weeklyReport!.analysis.globalSocialPost)} className="p-2 hover:bg-btc-orange/10 rounded-full transition-colors text-btc-orange" title="Post to X">
                          <Send size={16} />
                        </button>
                        <button onClick={() => handleSchedule(weeklyReport!.analysis.globalSocialPost)} className="p-2 hover:bg-btc-orange/10 rounded-full transition-colors text-btc-orange" title="Schedule Post">
                          <Clock size={16} />
                        </button>
                        <button onClick={handleGenerateInstagram} className="p-2 hover:bg-btc-orange/10 rounded-full transition-colors text-btc-orange" title="Generate Instagram Asset">
                          <Instagram size={16} />
                        </button>
                        <button onClick={handleAudioBrief} disabled={audioLoading} className="p-2 hover:bg-btc-orange/10 rounded-full transition-colors text-btc-orange disabled:opacity-50" title="Generate Audio Brief">
                          {audioLoading ? <Loader2 size={16} className="animate-spin" /> : <Volume2 size={16} />}
                        </button>
                        <button onClick={handleEmailDigest} disabled={sendingEmail} className="p-2 hover:bg-btc-orange/10 rounded-full transition-colors text-btc-orange disabled:opacity-50" title="Email Digest">
                          {sendingEmail ? <Loader2 size={16} className="animate-spin" /> : <Mail size={16} />}
                        </button>
                        <button onClick={handleGenerateSubstack} disabled={generatingSubstack} className="p-2 hover:bg-btc-orange/10 rounded-full transition-colors text-btc-orange disabled:opacity-50" title="Generate Substack Article">
                          {generatingSubstack ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}
                        </button>
                      </div>
                    </div>
                    <div className="p-2 bg-btc-orange/5 border border-btc-orange/10 rounded-sm font-mono text-xs italic text-btc-orange/80">
                      "{weeklyReport!.analysis.globalSocialPost}"
                    </div>
                  </div>
                </div>

                {/* Headlines Grid */}
                <div className="grid grid-cols-2 gap-2">
                  {weeklyReport!.headlines.map((h, i) => {
                    const sentimentStyle = h.sentiment ? (SENTIMENT_CONFIG[h.sentiment.toLowerCase()] || { color: 'text-gray-400', bg: 'bg-gray-400/10 border-gray-400/30', label: h.sentiment }) : null;
                    return (
                      <div key={i} className="group bg-[#0a0a0a] border border-btc-orange/30 p-2 hover:shadow-[0_0_20px_rgba(247,147,26,0.1)] transition-all flex flex-col justify-between relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-12 h-12 opacity-[0.02] pointer-events-none">
                          <TrendingUp size={48} className="text-btc-orange" />
                        </div>
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between gap-1 flex-wrap">
                            <span className="text-[9px] font-mono uppercase tracking-widest px-2 py-1 bg-btc-orange/10 text-btc-orange border border-btc-orange/20 rounded-sm whitespace-nowrap">{h.category}</span>
                            <div className="flex items-center gap-1">
                              {sentimentStyle && (
                                <span className={cn("text-[8px] font-mono uppercase tracking-widest px-1.5 py-0.5 border rounded-full", sentimentStyle.bg, sentimentStyle.color)}>
                                  {sentimentStyle.label}
                                </span>
                              )}
                              <a href={h.url} target="_blank" rel="noopener noreferrer" className="text-btc-orange opacity-40 hover:opacity-100 transition-opacity p-1 hover:bg-btc-orange/5 rounded-sm" title="Primary source">
                                <ExternalLink size={12} />
                              </a>
                              {h.alternateUrl && (
                                <a href={h.alternateUrl} target="_blank" rel="noopener noreferrer" className="text-btc-orange/60 opacity-40 hover:opacity-100 transition-opacity p-1 hover:bg-btc-orange/5 rounded-sm" title="Alternate source">
                                  <Link2 size={12} />
                                </a>
                              )}
                            </div>
                          </div>
                          <h4 className="text-sm font-serif font-medium leading-tight group-hover:italic transition-all text-white">{h.title}</h4>
                          <p className="text-[11px] leading-snug text-gray-300">{h.summary}</p>
                        </div>

                        <div className="mt-1.5 pt-1.5 border-t border-btc-orange/10 flex items-center justify-between">
                          <span className="text-[7px] font-mono uppercase tracking-widest text-btc-orange/40">#{i + 1}</span>
                          <div className="flex gap-0.5">
                            <button onClick={() => handlePost(h.summary)} className="p-1.5 hover:bg-btc-orange/10 rounded-sm transition-colors text-btc-orange" title="Post to X">
                              <Send size={12} />
                            </button>
                            <button onClick={() => handleSchedule(h.summary)} className="p-1.5 hover:bg-btc-orange/10 rounded-sm transition-colors text-btc-orange" title="Schedule Post">
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
              <div className="h-96 flex flex-col items-center justify-center border-2 border-dashed border-btc-orange/10 rounded-sm bg-btc-orange/[0.02]">
                <FileText className="text-btc-orange opacity-10 mb-4" size={48} />
                <p className="text-xs font-mono uppercase tracking-widest text-btc-orange/40">No active briefing selected</p>
              </div>
            )}
          </AnimatePresence>
        </div>
      </div>

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
                  {/* Theme Picker */}
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
                {/* Slide Preview */}
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

                  <div className="overflow-hidden border border-btc-orange/20">
                    <div
                      ref={instaAssetRef}
                      className="aspect-[4/5] p-14 flex flex-col gap-8 overflow-hidden relative"
                      style={{
                        width: '1080px', height: '1350px',
                        transform: 'scale(0.35)', transformOrigin: 'top left',
                        marginBottom: '-877px', marginRight: '-702px',
                        backgroundColor: theme.bg, color: theme.text,
                      }}
                    >
                      {currentSlideIndex === 0 ? (
                        /* COVER SLIDE */
                        <>
                          {/* Brand header */}
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

                          {/* Headline index */}
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

                          {/* Footer */}
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
                        /* HEADLINE SLIDE */
                        <>
                          {/* Top bar */}
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

                          {/* Title */}
                          <h2 className="text-7xl font-serif italic leading-[1.1] tracking-tight" style={{ color: theme.text }}>
                            {weeklyReport!.headlines[currentSlideIndex - 1].title}
                          </h2>

                          {/* Summary — fills remaining space */}
                          <div className="flex-1 flex flex-col justify-between">
                            <p className="text-3xl font-sans leading-relaxed" style={{ color: theme.secondary }}>
                              {weeklyReport!.headlines[currentSlideIndex - 1].summary}
                            </p>

                            {/* Sentiment + source row */}
                            <div className="flex items-center gap-4 mt-4">
                              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: theme.accent }} />
                              <p className="text-xl font-mono uppercase tracking-widest" style={{ color: theme.accent, opacity: 0.6 }}>
                                {weeklyReport!.headlines[currentSlideIndex - 1].sentiment || 'Intelligence'}
                              </p>
                            </div>
                          </div>

                          {/* Footer */}
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

                {/* Caption */}
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
              {/* Header */}
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

              {/* Body */}
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
              {/* Header */}
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

              {/* Body */}
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

              {/* Footer */}
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

// ─── Profile ──────────────────────────────────────────────────────────────────

const BackButton = () => {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => navigate(-1)}
      className="flex items-center gap-2 mb-6 text-[10px] font-mono uppercase tracking-widest text-btc-orange/50 hover:text-btc-orange transition-colors group"
    >
      <ChevronLeft size={14} className="group-hover:-translate-x-0.5 transition-transform" />
      Back
    </button>
  );
};

const Profile = ({ user, onLogout }: { user: UserData | null; onLogout: () => void }) => {
  if (!user) return <div className="text-center py-20 font-mono">Loading profile...</div>;

  return (
    <div className="max-w-2xl mx-auto space-y-12">
      <BackButton />
      <div className="bg-white border border-[#141414] p-12 text-center space-y-6 shadow-[12px_12px_0px_0px_rgba(20,20,20,1)]">
        <img src={user.profileImage} alt={user.displayName} className="w-32 h-32 rounded-full mx-auto border-4 border-[#141414]" />
        <div>
          <h1 className="text-4xl font-serif italic">{user.displayName}</h1>
          <p className="text-sm font-mono opacity-60">@{user.username}</p>
        </div>
        <div className="pt-6 border-t border-[#141414]/10 grid grid-cols-2 gap-8">
          <div className="text-center">
            <p className="text-[10px] font-mono uppercase tracking-widest opacity-40">Account Status</p>
            <p className="text-xs font-mono font-bold">Verified Node</p>
          </div>
          <div className="text-center">
            <p className="text-[10px] font-mono uppercase tracking-widest opacity-40">Access Level</p>
            <p className="text-xs font-mono font-bold">Strategic Analyst</p>
          </div>
        </div>
        <button onClick={onLogout} className="flex items-center gap-2 mx-auto px-8 py-3 bg-red-600 text-white text-xs font-mono uppercase tracking-widest hover:bg-red-700 transition-colors rounded-sm">
          <LogOut size={14} /> Logout Session
        </button>
      </div>
    </div>
  );
};

// ─── Schedule ─────────────────────────────────────────────────────────────────

const WEEKLY_CALENDAR = [
  { day: 'Sunday',    type: 'forecast',     label: '7-Day Forecast', color: 'text-purple-400',  border: 'border-purple-400/30', bg: 'bg-purple-400/5' },
  { day: 'Monday',    type: 'crypto',       label: 'Crypto Pulse',   color: 'text-yellow-400',  border: 'border-yellow-400/30', bg: 'bg-yellow-400/5' },
  { day: 'Tuesday',   type: 'nasdaq',       label: 'Nasdaq-100',     color: 'text-sky-400',     border: 'border-sky-400/30',    bg: 'bg-sky-400/5' },
  { day: 'Wednesday', type: 'conspiracies', label: 'Conspiracies',   color: 'text-red-400',     border: 'border-red-400/30',    bg: 'bg-red-400/5' },
  { day: 'Thursday',  type: 'equities',     label: 'S&P 500',        color: 'text-green-400',   border: 'border-green-400/30',  bg: 'bg-green-400/5' },
  { day: 'Friday',    type: 'global',       label: 'Global Pulse',   color: 'text-btc-orange',  border: 'border-btc-orange/30', bg: 'bg-btc-orange/5' },
  { day: 'Saturday',  type: null,           label: 'Rest',           color: 'text-gray-600',    border: 'border-white/5',       bg: 'bg-white/[0.02]' },
];

const Schedule = () => {
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

  // Group posts by date
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

      {/* Header */}
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

      {/* Tabs */}
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
          {/* Filter bar */}
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
        /* Weekly Calendar Tab */
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

// ─── Compose ──────────────────────────────────────────────────────────────────

const Compose = ({ user }: { user: UserData | null }) => {
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

    // Post to X
    if (platforms.includes('x')) {
      if (!user) { results.x = { success: false, error: "X not connected" }; }
      else {
        const res = await apiFetch('/api/post-to-x', { method: 'POST', body: JSON.stringify({ text: content }) });
        const data = await res.json();
        results.x = res.ok && data.success ? { success: true } : { success: false, error: data.error || 'Failed' };
      }
    }

    // Post to other platforms
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

  const PLATFORM_CONFIG = [
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
        {/* Platform selector */}
        <div className="space-y-2">
          <p className="text-[10px] font-mono uppercase tracking-widest text-btc-orange/40">Post To</p>
          <div className="flex flex-wrap gap-2">
            {PLATFORM_CONFIG.map(p => {
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

        {/* Post results */}
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

// ─── Settings ─────────────────────────────────────────────────────────────────

const Settings = ({ user, onLogout }: { user: UserData | null; onLogout: () => void }) => {
  // Watermark
  const [watermark, setWatermark] = useState(() => {
    try { return JSON.parse(localStorage.getItem('gib_watermark') || '{}'); } catch { return {}; }
  });
  const [watermarkSaved, setWatermarkSaved] = useState(false);

  // Notifications
  const [notifPermission, setNotifPermission] = useState<string>(() =>
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
  );

  // Email
  const [emailTo, setEmailTo] = useState(localStorage.getItem('gib_email_to') || '');

  // Report Schedules
  const [schedules, setSchedules] = useState<ReportSchedule[]>([]);
  const [showAddSchedule, setShowAddSchedule] = useState(false);
  const [newSchedule, setNewSchedule] = useState({ type: 'global', customTopic: '', time: '08:00', days: '1,2,3,4,5' });

  // Social Accounts
  const [socialAccounts, setSocialAccounts] = useState<SocialAccount[]>([]);
  const [blueskyForm, setBlueskyForm] = useState({ identifier: '', appPassword: '' });
  const [blueskyLoading, setBlueskyLoading] = useState(false);
  const [blueskyMsg, setBlueskyMsg] = useState('');

  useEffect(() => {
    apiFetch('/api/social/accounts').then(r => r.ok ? r.json() : { accounts: [] }).then(d => setSocialAccounts(d.accounts || []));
    apiFetch('/api/scheduled-reports').then(r => r.ok ? r.json() : []).then(d => setSchedules(Array.isArray(d) ? d : []));
  }, []);

  const saveWatermark = () => {
    localStorage.setItem('gib_watermark', JSON.stringify(watermark));
    setWatermarkSaved(true);
    setTimeout(() => setWatermarkSaved(false), 2000);
  };

  const requestNotifications = async () => {
    if (!('Notification' in window)) return;
    const perm = await Notification.requestPermission();
    setNotifPermission(perm);
    if (perm === 'granted') new Notification('Global Pulse', { body: 'Notifications enabled!' });
  };

  const addSchedule = async () => {
    if (!newSchedule.type || !newSchedule.time) return;
    const res = await apiFetch('/api/scheduled-reports', {
      method: 'POST',
      body: JSON.stringify({ report_type: newSchedule.type, custom_topic: newSchedule.customTopic || null, schedule_time: newSchedule.time, days: newSchedule.days }),
    });
    if (res.ok) {
      const data = await res.json();
      setSchedules(prev => [...prev, { id: data.id, report_type: newSchedule.type, custom_topic: newSchedule.customTopic || undefined, schedule_time: newSchedule.time, days: newSchedule.days, enabled: 1 }]);
      setShowAddSchedule(false);
      setNewSchedule({ type: 'global', customTopic: '', time: '08:00', days: '1,2,3,4,5' });
    }
  };

  const toggleSchedule = async (id: number, enabled: number) => {
    await apiFetch(`/api/scheduled-reports/${id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !enabled }) });
    setSchedules(prev => prev.map(s => s.id === id ? { ...s, enabled: enabled ? 0 : 1 } : s));
  };

  const deleteSchedule = async (id: number) => {
    if (!confirm("Delete this schedule?")) return;
    await apiFetch(`/api/scheduled-reports/${id}`, { method: 'DELETE' });
    setSchedules(prev => prev.filter(s => s.id !== id));
  };

  const connectBluesky = async () => {
    if (!blueskyForm.identifier || !blueskyForm.appPassword) return setBlueskyMsg("Enter handle and app password.");
    setBlueskyLoading(true);
    setBlueskyMsg('');
    const res = await apiFetch('/api/social/bluesky/connect', { method: 'POST', body: JSON.stringify(blueskyForm) });
    const data = await res.json();
    if (res.ok) {
      setBlueskyMsg(`✓ Connected as ${data.handle}`);
      setBlueskyForm({ identifier: '', appPassword: '' });
      setSocialAccounts(prev => [...prev.filter(a => a.platform !== 'bluesky'), { platform: 'bluesky', handle: data.handle }]);
    } else {
      setBlueskyMsg(`✗ ${data.error}`);
    }
    setBlueskyLoading(false);
  };

  const disconnectPlatform = async (platform: string) => {
    if (!confirm(`Disconnect ${platform}?`)) return;
    await apiFetch(`/api/social/${platform}`, { method: 'DELETE' });
    setSocialAccounts(prev => prev.filter(a => a.platform !== platform));
  };

  const connectOAuth = (platform: string, event: string) => {
    apiFetch(`/api/auth/${platform}/url`).then(r => r.json()).then(data => {
      if (data.url) {
        const popup = window.open(data.url, `${platform}_auth`, 'width=600,height=700');
        const handler = (e: MessageEvent) => {
          if (e.data?.type === event) {
            window.removeEventListener('message', handler);
            popup?.close();
            // If event carries a handle, update local state immediately
            if (e.data.handle) {
              const platformKey = platform === 'x/connect' ? 'x' : platform.split('/')[0];
              setSocialAccounts(prev => [
                ...prev.filter(a => a.platform !== platformKey),
                { platform: platformKey, handle: e.data.handle }
              ]);
            }
            apiFetch('/api/social/accounts').then(r => r.json()).then(d => setSocialAccounts(d.accounts || []));
          }
        };
        window.addEventListener('message', handler);
      } else {
        alert(data.error || `Failed to get ${platform} auth URL`);
      }
    });
  };

  const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const SettingsSection = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="space-y-2">
      <h3 className="text-xs font-mono uppercase tracking-widest font-bold text-btc-orange/60">{title}</h3>
      {children}
    </div>
  );

  return (
    <div className="max-w-2xl mx-auto space-y-12">
      <BackButton />
      <h1 className="text-4xl font-serif italic border-b border-btc-orange/20 pb-6 text-white bitcoin-glow">System Settings</h1>

      <div className="space-y-10">
        {/* Account Management */}
        {user && (
          <SettingsSection title="Account Management">
            <div className="p-6 bg-[#0a0a0a] border border-btc-orange/30 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <img src={user.profileImage} alt="" className="w-10 h-10 rounded-full border border-btc-orange/20" />
                <div>
                  <p className="text-xs font-mono font-bold text-white">@{user.username}</p>
                  <p className="text-[10px] font-mono opacity-40">Connected via X</p>
                </div>
              </div>
              <button onClick={onLogout} className="px-4 py-2 border border-red-500/30 text-red-500 text-[10px] font-mono uppercase tracking-widest hover:bg-red-500/10 transition-colors">
                Disconnect
              </button>
            </div>
          </SettingsSection>
        )}

        {/* Branding / Watermark */}
        <SettingsSection title="Instagram Branding">
          <div className="p-6 bg-[#0a0a0a] border border-btc-orange/30 space-y-4">
            <p className="text-xs text-gray-500">Customize the watermark shown on Instagram slides.</p>
            {[
              { key: 'name', label: 'Brand Name', placeholder: 'GLOBAL.PULSE.V4' },
              { key: 'handle', label: 'Handle', placeholder: '@GLOBAL_PULSE' },
              { key: 'tagline', label: 'Tagline', placeholder: 'FULL ANALYSIS ATTACHED' },
            ].map(({ key, label, placeholder }) => (
              <div key={key} className="space-y-1">
                <label className="text-[10px] font-mono uppercase tracking-widest text-btc-orange/40">{label}</label>
                <input
                  type="text"
                  value={watermark[key] || ''}
                  onChange={e => setWatermark((prev: any) => ({ ...prev, [key]: e.target.value }))}
                  placeholder={placeholder}
                  className="w-full px-3 py-2 bg-black/40 border border-btc-orange/20 text-white font-mono text-xs focus:border-btc-orange outline-none transition-all"
                />
              </div>
            ))}
            <button
              onClick={saveWatermark}
              className={cn("flex items-center gap-2 px-4 py-2 text-xs font-mono uppercase tracking-widest transition-all",
                watermarkSaved ? "bg-emerald-600 text-white" : "bg-btc-orange text-black hover:opacity-90"
              )}
            >
              {watermarkSaved ? <><Check size={12} /> Saved</> : 'Save Branding'}
            </button>
          </div>
        </SettingsSection>

        {/* Push Notifications */}
        <SettingsSection title="Push Notifications">
          <div className="p-6 bg-[#0a0a0a] border border-btc-orange/30 flex items-center justify-between">
            <div>
              <p className="text-xs font-mono text-white">Report completion alerts</p>
              <p className="text-[10px] font-mono opacity-40 mt-0.5">
                Status: <span className={cn(
                  notifPermission === 'granted' ? 'text-emerald-400' :
                  notifPermission === 'denied' ? 'text-red-400' : 'text-amber-400'
                )}>{notifPermission}</span>
              </p>
            </div>
            {notifPermission !== 'granted' && notifPermission !== 'unsupported' && (
              <button
                onClick={requestNotifications}
                className="flex items-center gap-2 px-4 py-2 bg-btc-orange text-black text-[10px] font-mono uppercase tracking-widest hover:opacity-90 transition-all"
              >
                <Bell size={12} /> Enable
              </button>
            )}
            {notifPermission === 'granted' && <Check size={18} className="text-emerald-400" />}
            {notifPermission === 'denied' && <p className="text-[10px] font-mono text-red-400">Blocked in browser settings</p>}
          </div>
        </SettingsSection>

        {/* Email Digest */}
        <SettingsSection title="Email Digest">
          <div className="p-6 bg-[#0a0a0a] border border-btc-orange/30 space-y-4">
            <p className="text-xs text-gray-500">Reports are emailed via SMTP configured in your .env file (SMTP_HOST, SMTP_USER, SMTP_PASS).</p>
            <div className="space-y-1">
              <label className="text-[10px] font-mono uppercase tracking-widest text-btc-orange/40">Default Recipient</label>
              <input
                type="email"
                value={emailTo}
                onChange={e => { setEmailTo(e.target.value); localStorage.setItem('gib_email_to', e.target.value); }}
                placeholder="you@example.com"
                className="w-full px-3 py-2 bg-black/40 border border-btc-orange/20 text-white font-mono text-xs focus:border-btc-orange outline-none transition-all"
              />
            </div>
            <p className="text-[10px] font-mono text-gray-600">Use the <Mail size={10} className="inline" /> button on any report to send a digest to this address.</p>
          </div>
        </SettingsSection>

        {/* Report Automation */}
        <SettingsSection title="Report Automation">
          <div className="p-6 bg-[#0a0a0a] border border-btc-orange/30 space-y-4">
            <div className="flex justify-between items-center">
              <p className="text-xs text-gray-400">Auto-generate reports on a schedule. Server must be running.</p>
              <button
                onClick={() => setShowAddSchedule(v => !v)}
                className="flex items-center gap-2 px-3 py-1.5 bg-btc-orange text-black text-[10px] font-mono uppercase tracking-widest hover:opacity-90 transition-all"
              >
                <Plus size={12} /> Add
              </button>
            </div>

            {showAddSchedule && (
              <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="p-4 border border-btc-orange/20 bg-black/40 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[9px] font-mono uppercase tracking-widest opacity-40">Report Type</label>
                    <select value={newSchedule.type} onChange={e => setNewSchedule(s => ({ ...s, type: e.target.value }))}
                      className="w-full px-2 py-1.5 bg-black/60 border border-btc-orange/20 text-white font-mono text-xs outline-none focus:border-btc-orange">
                      {['global', 'crypto', 'equities', 'nasdaq', 'conspiracies', 'custom'].map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] font-mono uppercase tracking-widest opacity-40">Time (24h)</label>
                    <input type="time" value={newSchedule.time} onChange={e => setNewSchedule(s => ({ ...s, time: e.target.value }))}
                      className="w-full px-2 py-1.5 bg-black/60 border border-btc-orange/20 text-white font-mono text-xs outline-none focus:border-btc-orange" />
                  </div>
                </div>
                {newSchedule.type === 'custom' && (
                  <input type="text" value={newSchedule.customTopic} onChange={e => setNewSchedule(s => ({ ...s, customTopic: e.target.value }))}
                    placeholder="Custom topic..." className="w-full px-2 py-1.5 bg-black/60 border border-btc-orange/20 text-white font-mono text-xs outline-none focus:border-btc-orange" />
                )}
                <div className="space-y-1">
                  <label className="text-[9px] font-mono uppercase tracking-widest opacity-40">Days</label>
                  <div className="flex gap-1">
                    {DAY_LABELS.map((day, idx) => {
                      const active = newSchedule.days.split(',').includes(String(idx));
                      return (
                        <button key={day} onClick={() => {
                          const current = newSchedule.days.split(',').filter(Boolean);
                          const next = active ? current.filter(d => d !== String(idx)) : [...current, String(idx)];
                          setNewSchedule(s => ({ ...s, days: next.join(',') }));
                        }}
                          className={cn("px-2 py-1 text-[9px] font-mono border transition-all", active ? "bg-btc-orange text-black border-btc-orange" : "border-btc-orange/20 text-gray-500 hover:border-btc-orange/40")}>
                          {day}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setShowAddSchedule(false)} className="px-3 py-1.5 text-[10px] font-mono uppercase border border-btc-orange/20 text-gray-500 hover:text-white transition-colors">Cancel</button>
                  <button onClick={addSchedule} className="px-3 py-1.5 text-[10px] font-mono uppercase bg-btc-orange text-black hover:opacity-90 transition-all">Save Schedule</button>
                </div>
              </motion.div>
            )}

            {schedules.length > 0 ? (
              <div className="space-y-2">
                {schedules.map(s => (
                  <div key={s.id} className="flex items-center justify-between p-3 bg-black/20 border border-btc-orange/10">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono uppercase text-btc-orange">{s.report_type}</span>
                        {s.custom_topic && <span className="text-[9px] font-mono text-gray-500 truncate max-w-[120px]">{s.custom_topic}</span>}
                      </div>
                      <p className="text-[9px] font-mono text-gray-500">{s.schedule_time} · Days: {s.days}</p>
                      {s.last_run && <p className="text-[8px] font-mono text-gray-600">Last run: {new Date(s.last_run).toLocaleString()}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => toggleSchedule(s.id, s.enabled)} className="text-btc-orange hover:opacity-70 transition-opacity">
                        {s.enabled ? <ToggleRight size={20} /> : <ToggleLeft size={20} className="opacity-30" />}
                      </button>
                      <button onClick={() => deleteSchedule(s.id)} className="text-red-500 hover:text-red-400 transition-colors p-1">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[10px] font-mono text-gray-600 text-center py-4">No schedules configured</p>
            )}
          </div>
        </SettingsSection>

        {/* Social Networks */}
        <SettingsSection title="Social Networks">
          <div className="p-6 bg-[#0a0a0a] border border-btc-orange/30 space-y-6">

            {/* X / Twitter */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <XIcon size={14} className="text-white" />
                <span className="text-xs font-mono font-bold text-white">X (Twitter)</span>
                {socialAccounts.find(a => a.platform === 'x') ? (
                  <span className="text-[9px] font-mono text-emerald-400">● {socialAccounts.find(a => a.platform === 'x')?.handle}</span>
                ) : user?.authMethod === 'x' ? (
                  <span className="text-[9px] font-mono text-emerald-400">● Connected via login</span>
                ) : null}
              </div>
              {socialAccounts.find(a => a.platform === 'x') ? (
                <button onClick={() => disconnectPlatform('x')} className="text-[10px] font-mono uppercase text-red-500 hover:underline">Disconnect</button>
              ) : user?.authMethod === 'x' ? (
                <span className="text-[9px] font-mono text-gray-500 italic">Active (via X login)</span>
              ) : (
                <button
                  onClick={() => connectOAuth('x/connect', 'OAUTH_X_CONNECT_SUCCESS')}
                  className="flex items-center gap-2 px-4 py-2 bg-black border border-white/20 text-white text-[10px] font-mono uppercase tracking-widest hover:bg-white/10 transition-colors"
                >
                  <XIcon size={12} /> Connect X
                </button>
              )}
            </div>

            {/* Instagram */}
            <div className="flex items-center justify-between border-t border-btc-orange/10 pt-4">
              <div className="flex items-center gap-2">
                <Instagram size={14} className="text-pink-400" />
                <span className="text-xs font-mono font-bold text-white">Instagram</span>
                {socialAccounts.find(a => a.platform === 'instagram') && (
                  <span className="text-[9px] font-mono text-emerald-400">● {socialAccounts.find(a => a.platform === 'instagram')?.handle}</span>
                )}
              </div>
              {socialAccounts.find(a => a.platform === 'instagram') ? (
                <button onClick={() => disconnectPlatform('instagram')} className="text-[10px] font-mono uppercase text-red-500 hover:underline">Disconnect</button>
              ) : (
                <button
                  onClick={() => connectOAuth('instagram', 'OAUTH_INSTAGRAM_SUCCESS')}
                  className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-600 via-pink-500 to-orange-400 text-white text-[10px] font-mono uppercase tracking-widest hover:opacity-90 transition-opacity"
                >
                  <Instagram size={12} /> Connect Instagram
                </button>
              )}
            </div>
            {socialAccounts.find(a => a.platform === 'instagram') && !socialAccounts.find(a => a.platform === 'instagram')?.handle?.startsWith('@') && (
              <p className="text-[9px] font-mono text-amber-400/70 -mt-2 ml-5">⚠ No Business/Creator account found. Connect a Business Instagram for posting.</p>
            )}

            {/* Bluesky */}
            <div className="border-t border-btc-orange/10 pt-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AtSign size={14} className="text-sky-400" />
                  <span className="text-xs font-mono font-bold text-white">Bluesky</span>
                  {socialAccounts.find(a => a.platform === 'bluesky') && (
                    <span className="text-[9px] font-mono text-emerald-400">● {socialAccounts.find(a => a.platform === 'bluesky')?.handle}</span>
                  )}
                </div>
                {socialAccounts.find(a => a.platform === 'bluesky') ? (
                  <button onClick={() => disconnectPlatform('bluesky')} className="text-[10px] font-mono uppercase text-red-500 hover:underline">Disconnect</button>
                ) : null}
              </div>
              {!socialAccounts.find(a => a.platform === 'bluesky') && (
                <div className="space-y-2">
                  <input type="text" value={blueskyForm.identifier} onChange={e => setBlueskyForm(f => ({ ...f, identifier: e.target.value }))}
                    placeholder="your.bsky.social handle" className="w-full px-3 py-2 bg-black/40 border border-sky-500/20 text-white font-mono text-xs outline-none focus:border-sky-500/60 transition-all" />
                  <input type="password" value={blueskyForm.appPassword} onChange={e => setBlueskyForm(f => ({ ...f, appPassword: e.target.value }))}
                    placeholder="App Password (from bsky.app/settings)" className="w-full px-3 py-2 bg-black/40 border border-sky-500/20 text-white font-mono text-xs outline-none focus:border-sky-500/60 transition-all" />
                  <button onClick={connectBluesky} disabled={blueskyLoading} className="flex items-center gap-2 px-4 py-2 bg-sky-600 text-white text-[10px] font-mono uppercase tracking-widest hover:bg-sky-500 transition-colors disabled:opacity-50">
                    {blueskyLoading ? <Loader2 size={12} className="animate-spin" /> : <AtSign size={12} />} Connect Bluesky
                  </button>
                  {blueskyMsg && <p className="text-[10px] font-mono text-btc-orange">{blueskyMsg}</p>}
                </div>
              )}
            </div>

            {/* LinkedIn */}
            <div className="flex items-center justify-between border-t border-btc-orange/10 pt-4">
              <div className="flex items-center gap-2">
                <Linkedin size={14} className="text-blue-500" />
                <span className="text-xs font-mono font-bold text-white">LinkedIn</span>
                {socialAccounts.find(a => a.platform === 'linkedin') && (
                  <span className="text-[9px] font-mono text-emerald-400">● {socialAccounts.find(a => a.platform === 'linkedin')?.handle}</span>
                )}
              </div>
              {socialAccounts.find(a => a.platform === 'linkedin') ? (
                <button onClick={() => disconnectPlatform('linkedin')} className="text-[10px] font-mono uppercase text-red-500 hover:underline">Disconnect</button>
              ) : (
                <button onClick={() => connectOAuth('linkedin', 'OAUTH_LINKEDIN_SUCCESS')} className="flex items-center gap-2 px-4 py-2 bg-blue-700 text-white text-[10px] font-mono uppercase tracking-widest hover:bg-blue-600 transition-colors">
                  <Linkedin size={12} /> Connect
                </button>
              )}
            </div>

            {/* Threads */}
            <div className="flex items-center justify-between border-t border-btc-orange/10 pt-4">
              <div className="flex items-center gap-2">
                <MessageSquare size={14} className="text-gray-400" />
                <span className="text-xs font-mono font-bold text-white">Threads</span>
                {socialAccounts.find(a => a.platform === 'threads') && (
                  <span className="text-[9px] font-mono text-emerald-400">● {socialAccounts.find(a => a.platform === 'threads')?.handle}</span>
                )}
              </div>
              {socialAccounts.find(a => a.platform === 'threads') ? (
                <button onClick={() => disconnectPlatform('threads')} className="text-[10px] font-mono uppercase text-red-500 hover:underline">Disconnect</button>
              ) : (
                <button onClick={() => connectOAuth('threads', 'OAUTH_THREADS_SUCCESS')} className="flex items-center gap-2 px-4 py-2 bg-gray-800 text-white text-[10px] font-mono uppercase tracking-widest hover:bg-gray-700 transition-colors border border-gray-600">
                  <MessageSquare size={12} /> Connect
                </button>
              )}
            </div>
          </div>
        </SettingsSection>

        {/* API Configuration */}
        <SettingsSection title="AI Configuration">
          <div className="p-6 bg-[#0a0a0a] border border-btc-orange/30 space-y-3">
            {[
              { label: 'Primary Model', value: 'claude-sonnet-4-6' },
              { label: 'Fallback Chain', value: 'Claude → Gemini → GPT-4o' },
              { label: 'X API Tier', value: 'Free / Basic' },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between items-center border-b border-btc-orange/10 pb-2 last:border-0 last:pb-0">
                <span className="text-[10px] font-mono uppercase tracking-widest opacity-40">{label}</span>
                <span className="text-xs font-mono text-btc-orange/80">{value}</span>
              </div>
            ))}
          </div>
        </SettingsSection>

        {/* Debug */}
        <SettingsSection title="System Debug">
          <div className="p-6 bg-[#0a0a0a] border border-btc-orange/30 space-y-3">
            {[
              { label: 'App URL', value: window.location.origin },
              { label: 'X Callback', value: `${window.location.origin}/auth/x/callback` },
              { label: 'LinkedIn Callback', value: `${window.location.origin}/auth/linkedin/callback` },
              { label: 'Threads Callback', value: `${window.location.origin}/auth/threads/callback` },
            ].map(({ label, value }) => (
              <div key={label} className="border-b border-btc-orange/10 pb-2 last:border-0 last:pb-0">
                <p className="text-[8px] font-mono uppercase opacity-40 mb-0.5">{label}</p>
                <code className="text-[9px] font-mono bg-btc-orange/5 p-1 block break-all select-all text-btc-orange/70">{value}</code>
              </div>
            ))}
          </div>
        </SettingsSection>
      </div>
    </div>
  );
};

// ─── Main App ──────────────────────────────────────────────────────────────────

export default function App() {
  const [user, setUser] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAuth();

    // Request notification permission on load (non-blocking)
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    const handleAuthSuccess = (e: MessageEvent) => {
      if (e.data?.type === 'OAUTH_AUTH_SUCCESS') {
        const sid = e.data.sessionId;
        if (sid) window.localStorage.setItem('debug_sid', sid);
        setTimeout(() => checkAuth(), 3000);
      }
    };
    window.addEventListener('message', handleAuthSuccess);
    return () => window.removeEventListener('message', handleAuthSuccess);
  }, []);

  const checkAuth = async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      const res = await apiFetch('/api/auth/me', { signal: controller.signal });
      clearTimeout(timeoutId);
      if (res.ok) {
        const data = await res.json();
        if (data.sessionId) window.localStorage.setItem('debug_sid', data.sessionId);
        setUser(data);
      } else {
        const data = await res.json().catch(() => ({}));
        if (data.sessionId) window.localStorage.setItem('debug_sid', data.sessionId);
        setUser(null);
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') console.error("Auth check error:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await apiFetch('/api/auth/logout', { method: 'POST' });
    window.localStorage.removeItem('debug_sid');
    setUser(null);
    window.location.href = '/';
  };

  if (loading) return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
      <Loader2 className="animate-spin text-btc-orange" size={48} />
    </div>
  );

  return (
    <BrowserRouter>
      <Layout user={user} onLogout={handleLogout} onLogin={setUser}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/profile" element={<Profile user={user} onLogout={handleLogout} />} />
          <Route path="/compose" element={<Compose user={user} />} />
          <Route path="/schedule" element={<Schedule />} />
          <Route path="/settings" element={<Settings user={user} onLogout={handleLogout} />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
