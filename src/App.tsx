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
  Search, 
  FileText, 
  TrendingUp, 
  ShieldCheck, 
  Globe, 
  ExternalLink, 
  Loader2, 
  RefreshCw,
  AlertCircle,
  Clock,
  ChevronRight,
  ChevronLeft,
  BarChart3,
  Twitter,
  Copy,
  Check,
  User,
  Settings as SettingsIcon,
  Calendar,
  LogOut,
  ChevronDown,
  Trash2,
  Send,
  Instagram,
  Download,
  Image as ImageIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { 
  generateInstagramCaption,
  type Headline, 
  type WeeklyReport 
} from './services/geminiService';
import Markdown from 'react-markdown';
import html2canvas from 'html2canvas';
import MatrixBackground from './components/MatrixBackground';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Helper function to count words
function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(word => word.length > 0).length;
}

// Helper function to truncate text to max words
function truncateToWords(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) return text;
  return words.slice(0, maxWords).join(' ') + '...';
}

// Helper function to ensure text is within word range
function limitWordRange(text: string, minWords: number, maxWords: number): string {
  const words = text.trim().split(/\s+/);
  const wordCount = words.length;
  
  if (wordCount <= maxWords) return text;
  return words.slice(0, maxWords).join(' ') + '...';
}

// --- Types ---
interface UserData {
  id: string;
  username: string;
  displayName: string;
  profileImage: string;
}

interface ScheduledPost {
  id: number;
  content: string;
  scheduled_at: string;
  status: 'pending' | 'posted' | 'failed';
}

const apiFetch = async (url: string, options: RequestInit = {}) => {
  const sid = window.localStorage.getItem('debug_sid');
  const headers = {
    ...options.headers as any,
    'Content-Type': 'application/json',
  };
  if (sid) {
    headers['x-session-id'] = sid;
  }
  return fetch(url, {
    ...options,
    headers,
    credentials: 'include'
  });
};

// --- Components ---

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
        <img src={user.profileImage} alt={user.displayName} className="w-8 h-8 rounded-full border border-[#141414]" />
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
              <Link 
                to="/profile" 
                onClick={() => setIsOpen(false)}
                className="flex items-center gap-3 px-3 py-2 text-xs font-mono uppercase tracking-widest hover:bg-btc-orange hover:text-black transition-colors"
              >
                <User size={14} /> Profile
              </Link>
              <Link 
                to="/compose" 
                onClick={() => setIsOpen(false)}
                className="flex items-center gap-3 px-3 py-2 text-xs font-mono uppercase tracking-widest hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors"
              >
                <Send size={14} /> Compose
              </Link>
              <Link 
                to="/schedule" 
                onClick={() => setIsOpen(false)}
                className="flex items-center gap-3 px-3 py-2 text-xs font-mono uppercase tracking-widest hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors"
              >
                <Calendar size={14} /> Schedule
              </Link>
              <Link 
                to="/settings" 
                onClick={() => setIsOpen(false)}
                className="flex items-center gap-3 px-3 py-2 text-xs font-mono uppercase tracking-widest hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors"
              >
                <SettingsIcon size={14} /> Settings
              </Link>
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

const Layout = ({ children, user, onLogout, onRefresh }: { children: React.ReactNode; user: UserData | null; onLogout: () => void; onRefresh: () => void }) => {
  const navigate = useNavigate();
  
  const handlePulseClick = () => {
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-gray-300 font-sans selection:bg-btc-orange selection:text-black relative overflow-x-hidden">
      <MatrixBackground />
      
      {/* Header */}
      <header className="sticky top-0 z-40 bg-[#0a0a0a]/80 backdrop-blur-md border-b border-btc-orange/20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <button onClick={handlePulseClick} className="flex items-center gap-2 group cursor-pointer">
            <div className="w-8 h-8 bg-btc-orange flex items-center justify-center rounded-sm group-hover:rotate-12 transition-transform shadow-[0_0_15px_rgba(247,147,26,0.5)]">
              <ShieldCheck className="text-black" size={18} />
            </div>
            <span className="text-sm font-mono font-bold tracking-tighter uppercase text-white bitcoin-glow">Pulse.v1</span>
          </button>

          <div className="flex items-center gap-6">
            {user && (
              <nav className="flex items-center gap-4 sm:gap-6 border-r border-btc-orange/20 pr-4 sm:pr-6">
                <Link to="/" className="text-[10px] font-mono uppercase tracking-widest hover:text-btc-orange transition-colors hidden sm:inline">Briefing</Link>
                <Link to="/compose" className="text-[10px] font-mono uppercase tracking-widest hover:text-btc-orange transition-colors">Compose</Link>
                <Link to="/schedule" className="text-[10px] font-mono uppercase tracking-widest hover:text-btc-orange transition-colors">Schedule</Link>
              </nav>
            )}
            <div className="flex items-center gap-4">
              {user ? (
                <Dropdown user={user} onLogout={onLogout} />
              ) : (
                <div className="flex items-center gap-2">
                  <button 
                    onClick={async () => {
                      try {
                        const res = await apiFetch('/api/auth/x/url');
                        if (!res.ok) throw new Error(`HTTP ${res.status}`);
                        const { url } = await res.json();
                        if (url) {
                          window.open(url, 'x_auth', 'width=600,height=600');
                        } else {
                          alert("Failed to get auth URL from server.");
                        }
                      } catch (err) {
                        console.error("Auth URL fetch error:", err);
                        alert("Failed to connect to authentication service. Check console for details.");
                      }
                    }}
                    className="flex items-center gap-2 px-4 py-2 bg-btc-orange text-black text-xs font-mono font-bold uppercase tracking-widest hover:opacity-90 transition-opacity rounded-sm shadow-[0_0_10px_rgba(247,147,26,0.3)]"
                  >
                    <Twitter size={14} /> Connect X
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 relative z-10">
        {children}
      </main>

      <footer className="border-t border-btc-orange/10 py-12 mt-12 relative z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="flex flex-col gap-2">
            <p className="text-[10px] font-mono uppercase tracking-widest opacity-40">System Status</p>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-btc-orange rounded-full animate-pulse shadow-[0_0_5px_#f7931a]" />
              <span className="text-xs font-mono font-medium text-btc-orange/80">Live Feed Active. System Synchronized.</span>
            </div>
          </div>
          <p className="text-[10px] font-mono uppercase tracking-widest opacity-40">© 2026 Global Pulse. No rights reserved.</p>
        </div>
      </footer>
    </div>
  );
};
;

// --- Pages ---

const Dashboard = ({ user }: { user: UserData | null }) => {
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [activeReportId, setActiveReportId] = useState<string | null>(null);
  const [reportType, setReportType] = useState('global');
  const [posting, setPosting] = useState<string | null>(null);
  const [showInstaModal, setShowInstaModal] = useState(false);
  const [instaCaption, setInstaCaption] = useState('');
  const [generatingInsta, setGeneratingInsta] = useState(false);
  const [downloadingInsta, setDownloadingInsta] = useState(false);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0); // 0 = Cover, 1-20 = Headlines
  const instaAssetRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const navigate = useNavigate();

  const activeReport = reports.find(r => r.id === activeReportId)?.content as WeeklyReport | null;

  // Get the current report type label
  const getReportLabel = (type: string) => {
    return type === 'equities' ? 'S&P 500' : type === 'crypto' ? 'Crypto Industry' : type === 'conspiracies' ? 'Conspiracies' : 'Global';
  };

  const currentReportLabel = getReportLabel(reportType);

  // Handle escape key and outside click for Instagram modal
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showInstaModal) {
        setShowInstaModal(false);
      }
    };

    const handleOutsideClick = (e: MouseEvent) => {
      if (showInstaModal && e.target === e.currentTarget) {
        setShowInstaModal(false);
      }
    };

    if (showInstaModal) {
      document.addEventListener('keydown', handleEscape);
      document.addEventListener('mousedown', handleOutsideClick);
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [showInstaModal]);

  const fetchReports = async () => {
    const res = await apiFetch('/api/reports');
    if (res.ok) {
      const data = await res.json();
      setReports(data);
      if (data.length > 0 && !activeReportId) {
        setActiveReportId(data[0].id);
      }
    }
  };

  const clearArchive = async () => {
    if (!confirm("Are you sure you want to delete all reports in the archive?")) return;
    try {
      const res = await apiFetch('/api/reports', { method: 'DELETE' });
      if (res.ok) {
        setReports([]);
        setActiveReportId(null);
        alert("Archive cleared successfully!");
      } else {
        const error = await res.json();
        alert(`Error clearing archive: ${error.error || 'Unknown error'}`);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error("Archive clear failed:", err);
      alert(`Failed to clear archive: ${errorMsg}`);
    }
  };

  const deleteReport = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Delete this report?")) return;
    const res = await apiFetch(`/api/reports/${id}`, { method: 'DELETE' });
    if (res.ok) {
      if (activeReportId === id) {
        setActiveReportId(null);
      }
      fetchReports();
    }
  };

  const generateReport = async () => {
    setLoading(true);
    setLoadingError(null);
    
    // Create a new abort controller for this request
    abortControllerRef.current = new AbortController();
    
    try {
      console.log(`[DEBUG] Starting report generation for type: ${reportType}`);
      
      // Call backend API endpoint instead of calling generateWeeklyReport directly
      const response = await fetch('/api/generate-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: reportType }),
        signal: abortControllerRef.current.signal
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `API error: ${response.status}`);
      }
      
      const report = await response.json();
      console.log(`[DEBUG] Report generated:`, report);
      
      // Check if request was aborted
      if (abortControllerRef.current?.signal.aborted) {
        setLoading(false);
        setLoadingError("Report generation cancelled.");
        return;
      }
      
      if (!report.headlines || report.headlines.length === 0) {
        throw new Error("No headlines generated. Please try again.");
      }
      
      if (!report.analysis) {
        throw new Error("No analysis generated. Please try again.");
      }
      
      const id = `${reportType}-${Date.now()}`;
      await apiFetch('/api/reports', {
        method: 'POST',
        body: JSON.stringify({ id, type: reportType, content: report }),
      });
      await fetchReports();
      setActiveReportId(id);
      setLoadingError(null);
    } catch (err) {
      console.error("Report generation error:", err);
      
      let errorMessage = "Failed to generate report. Please try again.";
      
      if (err instanceof Error) {
        if (err.message.includes("AbortError")) {
          errorMessage = "Report generation was cancelled.";
        } else if (err.message.includes("RATE_LIMIT") || err.message.includes("rate limit") || err.message.includes("429") || err.message.includes("quota")) {
          errorMessage = `⚠️ Rate limit reached. All AI providers temporarily unavailable. ${err.message}`;
        } else if (err.message.includes("No headlines")) {
          errorMessage = err.message;
        } else if (err.message.includes("No analysis")) {
          errorMessage = err.message;
        } else if (err.message.includes("Invalid response")) {
          errorMessage = "API returned invalid data. This report type may be temporarily unavailable. Please try another report type.";
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

  const handlePost = (text: string) => {
    navigate('/compose', { state: { content: text } });
  };

  const handleSchedule = (content: string) => {
    navigate('/compose', { state: { content, autoSchedule: true } });
  };

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
        if (response.status === 429) {
          throw new Error(`⚠️ Rate limit reached: ${error.error}`);
        }
        throw new Error(error.error || 'Failed to generate caption');
      }

      const data = await response.json();
      setInstaCaption(data.caption);
    } catch (error) {
      console.error("Instagram caption error:", error);
      const message = error instanceof Error ? error.message : 'Failed to generate Instagram caption';
      setInstaCaption(message || "Failed to generate Instagram caption. Please try again.");
    } finally {
      setGeneratingInsta(false);
    }
  };

  const downloadCarousel = async () => {
    if (!activeReport || !instaAssetRef.current) return;
    setDownloadingInsta(true);
    
    try {
      // Ensure we are at the top of the page for clean capture
      window.scrollTo(0, 0);
      
      const totalSlides = activeReport.headlines.length + 1; // Cover + 20 Headlines
      
      for (let i = 0; i < totalSlides; i++) {
        setCurrentSlideIndex(i);
        
        // Wait for React to render
        await new Promise(resolve => setTimeout(resolve, 200));

        const canvas = await html2canvas(instaAssetRef.current, {
          backgroundColor: '#0a0a0a',
          scale: 2,
          useCORS: true,
          allowTaint: true,
          logging: false,
          width: 1080,
          height: 1350,
          onclone: (clonedDoc) => {
            const element = clonedDoc.querySelector('[ref="instaAssetRef"]') || clonedDoc.querySelector('.aspect-\\[4\\/5\\]');
            if (element instanceof HTMLElement) {
              element.style.transform = 'none';
              element.style.margin = '0';
              element.style.position = 'relative';
              element.style.display = 'flex';
            }
          }
        });

        const link = document.createElement('a');
        link.download = `pulse-slide-${i === 0 ? 'summary' : i}-${Date.now()}.png`;
        link.href = canvas.toDataURL('image/png');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      alert("All 21 slides generated successfully.");
    } catch (error) {
      console.error("Failed to generate carousel:", error);
      alert("Failed to generate the carousel. Please try again.");
    } finally {
      setDownloadingInsta(false);
      setCurrentSlideIndex(0); // Reset to cover
    }
  };

  return (
    <div className="space-y-12">
      {/* Hero Section */}
      <section className="relative py-12 border-b border-btc-orange/20">
        <div className="absolute top-0 right-0 opacity-5 pointer-events-none text-btc-orange">
          <Globe size={400} />
        </div>
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
      <div className="flex flex-col md:flex-row items-center justify-between gap-6 p-6 bg-[#0a0a0a] border border-btc-orange/30 shadow-[0_0_20px_rgba(247,147,26,0.1)] relative z-20">
        <div className="flex items-center gap-4">
          <div className="flex bg-btc-orange/5 p-1 rounded-sm border border-btc-orange/10">
            {[
              { id: 'global', label: 'Global' },
              { id: 'crypto', label: 'Crypto Industry' },
              { id: 'equities', label: 'S&P 500' },
              { id: 'conspiracies', label: 'Conspiracies' }
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
          {loading ? (
            <button
              onClick={cancelReport}
              className="flex items-center justify-center gap-3 px-8 py-4 bg-red-600/80 text-white font-mono font-bold uppercase tracking-widest hover:bg-red-600 transition-all"
            >
              ✕ Cancel
            </button>
          ) : (
            <button
              onClick={generateReport}
              className="w-full md:w-auto flex items-center justify-center gap-3 px-8 py-4 bg-btc-orange text-black font-mono font-bold uppercase tracking-widest hover:shadow-[0_0_20px_rgba(247,147,26,0.4)] transition-all"
            >
              <RefreshCw size={18} />
              Generate Report
            </button>
          )}
        </div>
      </div>

      {/* Error Message */}
      {loadingError && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="p-4 bg-red-500/10 border border-red-500/30 text-red-400 font-mono text-sm rounded-sm flex items-center justify-between gap-4"
        >
          <span>⚠️ {loadingError}</span>
          <button
            onClick={() => setLoadingError(null)}
            className="text-red-400 hover:text-red-300 transition-colors"
          >
            ✕
          </button>
        </motion.div>
      )}

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
        {/* Sidebar: History */}
        <div className="lg:col-span-3 space-y-6 relative z-10">
          <div className="flex items-center justify-between border-b border-btc-orange/20 pb-2">
            <h3 className="text-xs font-mono uppercase tracking-widest opacity-40">Archive</h3>
            {reports.length > 0 && (
              <button 
                onClick={clearArchive}
                className="text-[8px] font-mono uppercase tracking-widest text-red-500 hover:underline"
              >
                Clear All
              </button>
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
                  <span className="text-[10px] font-mono uppercase opacity-60">
                    {r.type === 'equities' ? 'S&P 500' : r.type === 'crypto' ? 'Crypto Industry' : r.type === 'conspiracies' ? 'Conspiracies' : 'Global'}
                  </span>
                  <span className="text-xs font-medium truncate">{new Date(r.updated_at).toLocaleDateString()}</span>
                </button>
                <button 
                  onClick={(e) => deleteReport(r.id, e)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-red-500 opacity-0 group-hover/item:opacity-40 hover:!opacity-100 transition-opacity hover:bg-red-500/10 rounded-sm z-10"
                  title="Delete Report"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Main Report View */}
        <div className="lg:col-span-9">
          <AnimatePresence mode="wait">
            {activeReport ? (
              <motion.div
                key={activeReportId || 'empty'}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
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
                        <p className="text-[8px] font-mono uppercase opacity-40">Impact</p>
                        <p className="text-xs font-mono font-bold text-btc-orange">{activeReport.analysis.performanceRanking}</p>
                      </div>
                      <div className="px-2 py-1 border border-btc-orange/20 bg-btc-orange/5 text-center">
                        <p className="text-[8px] font-mono uppercase opacity-40">Verification</p>
                        <p className="text-xs font-mono font-bold text-btc-orange">{activeReport.analysis.verificationScore}</p>
                      </div>
                    </div>
                  </div>

                  <div className="prose prose-invert prose-sm max-w-none font-sans leading-relaxed text-gray-400">
                    <Markdown>{activeReport.analysis.overallSummary}</Markdown>
                  </div>

                  <div className="pt-2 border-t border-btc-orange/10 flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-mono uppercase tracking-widest text-btc-orange/40">{currentReportLabel} Update</p>
                      <div className="flex gap-2">
                        <button 
                          onClick={() => handlePost(activeReport.analysis.globalSocialPost)}
                          disabled={posting === 'master'}
                          className="p-2 hover:bg-btc-orange/10 rounded-full transition-colors disabled:opacity-50 text-btc-orange"
                          title="Post to X"
                        >
                          {posting === 'master' ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                        </button>
                        <button 
                          onClick={() => handleSchedule(activeReport.analysis.globalSocialPost)}
                          className="p-2 hover:bg-btc-orange/10 rounded-full transition-colors text-btc-orange"
                          title="Schedule Post"
                        >
                          <Clock size={16} />
                        </button>
                        <button 
                          onClick={handleGenerateInstagram}
                          className="p-2 hover:bg-btc-orange/10 rounded-full transition-colors text-btc-orange"
                          title="Generate Instagram Asset"
                        >
                          <Instagram size={16} />
                        </button>
                      </div>
                    </div>
                    <div className="p-2 bg-btc-orange/5 border border-btc-orange/10 rounded-sm font-mono text-xs italic text-btc-orange/80">
                      "{activeReport.analysis.globalSocialPost}"
                    </div>
                  </div>
                </div>

                {/* Headlines Grid */}
                <div className="grid grid-cols-2 gap-2">
                  {activeReport.headlines.map((h, i) => (
                    <div key={i} className="group bg-[#0a0a0a] border border-btc-orange/30 p-2 hover:shadow-[0_0_20px_rgba(247,147,26,0.1)] transition-all flex flex-col justify-between relative overflow-hidden">
                      <div className="absolute top-0 right-0 w-12 h-12 opacity-[0.02] pointer-events-none">
                        <TrendingUp size={48} className="text-btc-orange" />
                      </div>
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-[9px] font-mono uppercase tracking-widest px-2 py-1 bg-btc-orange/10 text-btc-orange border border-btc-orange/20 rounded-sm whitespace-nowrap">{h.category}</span>
                          <a href={h.url} target="_blank" rel="noopener noreferrer" className="text-btc-orange opacity-40 hover:opacity-100 transition-opacity p-1.5 hover:bg-btc-orange/5 rounded-sm flex-shrink-0">
                            <ExternalLink size={14} />
                          </a>
                        </div>
                        <h4 className="text-sm font-serif font-medium leading-tight group-hover:italic transition-all text-white">{h.title}</h4>
                        <div className="prose prose-invert prose-sm max-w-none font-sans leading-tight text-gray-300">
                          <p className="text-[11px] leading-snug">{h.summary}</p>
                        </div>
                      </div>

                      <div className="mt-1.5 pt-1.5 border-t border-btc-orange/10 flex items-center justify-between">
                        <div className="flex items-center gap-1">
                          <p className="text-[7px] font-mono uppercase tracking-widest text-btc-orange/40">Social</p>
                          <span className="text-[6px] font-mono uppercase tracking-widest opacity-40">#{i + 1}</span>
                        </div>
                        <div className="flex gap-0.5">
                          <button
                            onClick={() => handlePost(h.socialPost)}
                            disabled={posting === `h-${i}`}
                            className="p-1.5 hover:bg-btc-orange/10 rounded-sm transition-colors disabled:opacity-50 text-btc-orange"
                            title="Post to X"
                          >
                            {posting === `h-${i}` ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                          </button>
                          <button
                            onClick={() => handleSchedule(h.socialPost)}
                            className="p-1.5 hover:bg-btc-orange/10 rounded-sm transition-colors text-btc-orange"
                            title="Schedule Post"
                          >
                            <Clock size={12} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
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
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-md"
            onClick={() => setShowInstaModal(false)}
          >
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-[#0a0a0a] border border-btc-orange/30 w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col shadow-[0_0_50px_rgba(247,147,26,0.2)]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-4 border-b border-btc-orange/20 flex justify-between items-center bg-btc-orange/5">
                <h3 className="font-mono uppercase tracking-widest text-sm text-btc-orange bitcoin-glow">Instagram Market Asset</h3>
                <button 
                  onClick={() => setShowInstaModal(false)} 
                  className="px-3 py-1 text-xs font-mono uppercase hover:text-btc-orange hover:bg-btc-orange/10 transition-all rounded-sm border border-transparent hover:border-btc-orange/30"
                >
                  ✕ Close
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto p-8 grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Visual Asset Preview (The part we capture) */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-mono uppercase opacity-40">Slide {currentSlideIndex + 1} of {activeReport.headlines.length + 1}</p>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => setCurrentSlideIndex(prev => Math.max(0, prev - 1))}
                        disabled={currentSlideIndex === 0}
                        className="p-1 border border-[#141414]/10 hover:bg-black/5 disabled:opacity-20 transition-colors"
                      >
                        <ChevronLeft size={16} />
                      </button>
                      <button 
                        onClick={() => setCurrentSlideIndex(prev => Math.min(activeReport.headlines.length, prev + 1))}
                        disabled={currentSlideIndex === activeReport.headlines.length}
                        className="p-1 border border-[#141414]/10 hover:bg-black/5 disabled:opacity-20 transition-colors"
                      >
                        <ChevronRight size={16} />
                      </button>
                    </div>
                  </div>
                  
                  <div className="overflow-hidden border border-btc-orange/20 bg-[#050505]">
                    <div 
                      ref={instaAssetRef}
                      className="aspect-[4/5] p-16 flex flex-col gap-12 overflow-hidden relative"
                      style={{ 
                        width: '1080px', 
                        height: '1350px', 
                        transform: 'scale(0.35)', 
                        transformOrigin: 'top left', 
                        marginBottom: '-877px', 
                        marginRight: '-702px',
                        backgroundColor: '#0a0a0a',
                        color: '#ffffff'
                      }}
                    >
                      {currentSlideIndex === 0 ? (
                        /* COVER SLIDE - PREMIUM EDITORIAL DESIGN */
                        <>
                          {/* Header Section */}
                          <div className="flex justify-between items-end pb-6 border-b" style={{ borderColor: 'rgba(247, 147, 26, 0.2)' }}>
                            <div className="space-y-2">
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-px" style={{ backgroundColor: '#f7931a' }} />
                                <p className="text-lg font-mono uppercase tracking-[0.3em]" style={{ color: '#f7931a' }}>Market Intelligence</p>
                              </div>
                              <h1 className="text-8xl font-serif italic leading-none tracking-tighter" style={{ color: '#ffffff', marginLeft: '-4px' }}>The Weekly Pulse.</h1>
                            </div>
                            <div className="text-right space-y-1">
                              <p className="text-sm font-mono uppercase tracking-widest opacity-40">Issue No.</p>
                              <p className="text-4xl font-mono font-bold" style={{ color: '#f7931a' }}>03/15</p>
                            </div>
                          </div>

                          {/* Main Content - 20 Headlines Grid */}
                          <div className="flex-1 py-6">
                            <div className="flex items-center gap-4 mb-6">
                              <p className="text-base font-mono uppercase tracking-[0.5em]" style={{ color: 'rgba(247, 147, 26, 0.5)' }}>20 Critical Insight Nodes</p>
                              <div className="flex-1 h-px" style={{ backgroundColor: 'rgba(247, 147, 26, 0.1)' }} />
                            </div>
                            
                            <div className="grid grid-cols-2 gap-x-8 gap-y-4">
                              {activeReport.headlines.map((h, idx) => (
                                <div key={idx} className="relative">
                                  <div className="flex gap-3 items-start">
                                    <span className="text-lg font-mono font-bold pt-0.5" style={{ color: '#f7931a' }}>
                                      {(idx + 1).toString().padStart(2, '0')}
                                    </span>
                                    <div className="flex-1">
                                      <p className="text-[16px] font-sans font-semibold leading-tight block" style={{ color: '#f3f4f6' }}>
                                        {h.title.length > 100 ? h.title.substring(0, 100) + '...' : h.title}
                                      </p>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* Footer Section */}
                          <div className="pt-2 flex justify-between items-center" style={{ borderTop: '1px solid rgba(247, 147, 26, 0.2)' }}>
                            <div className="flex gap-6">
                              <div className="space-y-0.5">
                                <p className="text-[8px] font-mono uppercase tracking-widest opacity-40">Network Node</p>
                                <p className="text-sm font-mono font-bold" style={{ color: '#f7931a' }}>GLOBAL.PULSE.V4</p>
                              </div>
                              <div className="space-y-0.5">
                                <p className="text-[8px] font-mono uppercase tracking-widest opacity-40">Security Clearance</p>
                                <p className="text-sm font-mono font-bold" style={{ color: '#f7931a' }}>UNRESTRICTED</p>
                              </div>
                            </div>
                            
                            <div className="flex flex-col items-end gap-1">
                              <div className="flex items-center gap-2">
                                <span className="text-[8px] font-mono uppercase tracking-widest opacity-40">Swipe to Decrypt</span>
                                <div className="flex gap-0.5">
                                  {[...Array(3)].map((_, i) => (
                                    <div key={i} className="w-0.5 h-0.5 rounded-full" style={{ backgroundColor: '#f7931a', opacity: 0.3 + (i * 0.3) }} />
                                  ))}
                                </div>
                              </div>
                              <p className="text-sm font-mono font-bold tracking-tighter" style={{ color: '#f7931a' }}>FULL ANALYSIS ATTACHED</p>
                            </div>
                          </div>
                        </>
                      ) : (
                        /* HEADLINE SLIDE */
                        <>
                          <div className="flex justify-between items-center">
                            <p className="text-xl font-mono uppercase tracking-[0.2em]" style={{ color: 'rgba(247, 147, 26, 0.4)' }}>
                              Insight Node {currentSlideIndex} / 20
                            </p>
                            <div className="w-10 h-10 border-2 flex items-center justify-center text-lg font-mono font-bold" style={{ borderColor: '#f7931a', color: '#f7931a' }}>
                              {currentSlideIndex}
                            </div>
                          </div>

                          <div className="h-0.5 w-full" style={{ backgroundColor: 'rgba(247, 147, 26, 0.1)' }} />

                          <div className="flex-1 flex flex-col justify-center gap-3">
                            <div className="space-y-6">
                              <span className="px-4 py-2 text-lg font-mono uppercase tracking-widest border inline-block" style={{ backgroundColor: 'rgba(247, 147, 26, 0.1)', color: '#f7931a', borderColor: 'rgba(247, 147, 26, 0.2)' }}>
                                {activeReport.headlines[currentSlideIndex - 1].category}
                              </span>
                              <h2 className="text-4xl font-serif italic leading-tight" style={{ color: '#ffffff' }}>
                                {truncateToWords(activeReport.headlines[currentSlideIndex - 1].title, 25)}
                              </h2>
                            </div>

                            <div className="space-y-4">
                              <p className="text-lg font-mono uppercase tracking-widest" style={{ color: 'rgba(247, 147, 26, 0.4)' }}>Strategic Analysis</p>
                              <div className="space-y-4 max-h-80 overflow-y-auto">
                                <p className="text-lg font-sans leading-relaxed" style={{ color: '#d1d5db' }}>
                                  {activeReport.headlines[currentSlideIndex - 1].summary}
                                </p>
                              </div>
                            </div>

                            <div className="pt-2 border-t" style={{ borderColor: 'rgba(247, 147, 26, 0.1)' }}>
                              <div className="flex justify-between items-center">
                                <div className="flex gap-2 items-center">
                                  <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: '#f7931a' }} />
                                  <p className="text-[10px] font-mono uppercase tracking-widest opacity-60">Real-Time Intelligence</p>
                                </div>
                                <p className="text-[10px] font-mono uppercase tracking-widest" style={{ color: 'rgba(247, 147, 26, 0.6)' }}>
                                  #{currentSlideIndex.toString().padStart(2, '0')}
                                </p>
                              </div>
                            </div>
                          </div>

                          <div className="pt-2 flex justify-between items-center" style={{ borderTop: '1px solid rgba(247, 147, 26, 0.1)' }}>
                            <div className="flex gap-2 items-center">
                              <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: '#f7931a' }} />
                              <p className="text-sm font-mono uppercase tracking-widest opacity-40">Verified Source</p>
                            </div>
                            <p className="text-sm font-mono uppercase tracking-widest" style={{ color: 'rgba(247, 147, 26, 0.4)' }}>@GLOBAL_PULSE</p>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                  <button 
                    onClick={downloadCarousel}
                    disabled={downloadingInsta}
                    className="w-full flex items-center justify-center gap-2 py-4 bg-btc-orange text-black font-mono font-bold uppercase text-xs tracking-widest hover:opacity-90 transition-all disabled:opacity-50 shadow-[0_0_15px_rgba(247,147,26,0.3)]"
                  >
                    {downloadingInsta ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        Generating 21 Slides...
                      </>
                    ) : (
                      <>
                        <Download size={16} /> Download All 21 Slides
                      </>
                    )}
                  </button>
                </div>

                {/* Caption Section */}
                <div className="space-y-4 flex flex-col">
                  <div className="flex justify-between items-center">
                    <p className="text-[10px] font-mono uppercase opacity-40">Generated Caption</p>
                    <p className={cn(
                      "text-[10px] font-mono uppercase",
                      instaCaption.length > 2200 ? "text-red-500 font-bold" : "text-btc-orange/40"
                    )}>
                      {instaCaption.length} / 2200 Characters
                    </p>
                  </div>
                  <div className="flex-1 bg-btc-orange/5 border border-btc-orange/20 p-6 font-sans text-sm overflow-y-auto whitespace-pre-wrap leading-relaxed text-gray-300">
                    {generatingInsta ? (
                      <div className="flex flex-col items-center justify-center h-full gap-4 opacity-40">
                        <Loader2 className="animate-spin text-btc-orange" />
                        <p className="font-mono text-[10px] uppercase tracking-widest text-btc-orange">Synthesizing 20 Headlines...</p>
                      </div>
                    ) : (
                      instaCaption
                    )}
                  </div>
                  <button 
                    onClick={() => {
                      navigator.clipboard.writeText(instaCaption);
                      alert("Caption copied to clipboard!");
                    }}
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
    </div>
  );
};

const Profile = ({ user, onLogout }: { user: UserData | null; onLogout: () => void }) => {
  if (!user) return <div className="text-center py-20 font-mono">Loading profile...</div>;

  return (
    <div className="max-w-2xl mx-auto space-y-12">
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
        <div className="pt-8">
          <button 
            onClick={onLogout}
            className="flex items-center gap-2 mx-auto px-8 py-3 bg-red-600 text-white text-xs font-mono uppercase tracking-widest hover:bg-red-700 transition-colors rounded-sm"
          >
            <LogOut size={14} /> Logout Session
          </button>
        </div>
      </div>

      <div className="bg-white border border-[#141414] p-8 space-y-4">
        <h3 className="text-xs font-mono uppercase tracking-widest font-bold border-b border-[#141414]/10 pb-2">Internal Metadata</h3>
        <div className="grid grid-cols-1 gap-2">
          <div className="flex justify-between text-[10px] font-mono">
            <span className="opacity-40">X ID</span>
            <span>{user.id}</span>
          </div>
          <div className="flex justify-between text-[10px] font-mono">
            <span className="opacity-40">Session ID</span>
            <span className="truncate max-w-[200px]">{window.localStorage.getItem('debug_sid') || 'N/A'}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

const Schedule = () => {
  const [posts, setPosts] = useState<ScheduledPost[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPosts();
  }, []);

  const fetchPosts = async () => {
    try {
      const res = await apiFetch('/api/scheduled-posts');
      if (res.ok) setPosts(await res.json());
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Are you sure you want to cancel this post?")) return;
    await apiFetch(`/api/scheduled-posts/${id}`, { method: 'DELETE' });
    fetchPosts();
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between border-b border-[#141414] pb-6">
        <h1 className="text-4xl font-serif italic">Social Schedule</h1>
        <p className="text-xs font-mono uppercase tracking-widest opacity-40">{posts.length} Pending Broadcasts</p>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {loading ? (
          <div className="py-20 flex justify-center"><Loader2 className="animate-spin opacity-20" /></div>
        ) : posts.length > 0 ? (
          posts.map((post) => (
            <div key={post.id} className="bg-white border border-[#141414] p-6 flex flex-col md:flex-row justify-between gap-6">
              <div className="space-y-3 flex-1">
                <div className="flex items-center gap-3">
                  <span className={cn(
                    "text-[8px] font-mono uppercase tracking-widest px-2 py-0.5 rounded-full border",
                    post.status === 'pending' ? "bg-amber-50 border-amber-200 text-amber-700" :
                    post.status === 'posted' ? "bg-emerald-50 border-emerald-200 text-emerald-700" :
                    "bg-red-50 border-red-200 text-red-700"
                  )}>
                    {post.status}
                  </span>
                  <span className="text-[10px] font-mono opacity-40">{new Date(post.scheduled_at).toLocaleString()}</span>
                </div>
                <p className="text-sm font-mono italic leading-relaxed">"{post.content}"</p>
              </div>
              <button 
                onClick={() => handleDelete(post.id)}
                className="self-end md:self-center p-3 text-red-600 hover:bg-red-50 transition-colors rounded-sm"
              >
                <Trash2 size={18} />
              </button>
            </div>
          ))
        ) : (
          <div className="py-20 text-center border-2 border-dashed border-[#141414]/10">
            <Calendar className="mx-auto opacity-10 mb-4" size={48} />
            <p className="text-xs font-mono uppercase tracking-widest opacity-40">No scheduled broadcasts</p>
          </div>
        )}
      </div>
    </div>
  );
};

const Compose = ({ user }: { user: UserData | null }) => {
  const location = useLocation();
  const [content, setContent] = useState(location.state?.content || '');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (location.state?.autoSchedule) {
      // Small delay to let the user see the content before prompting
      const timer = setTimeout(() => handleSchedule(), 500);
      return () => clearTimeout(timer);
    }
  }, []);

  const handlePost = async () => {
    if (!user) return alert("Please connect your X account first.");
    setLoading(true);
    try {
      const res = await apiFetch('/api/post-to-x', {
        method: 'POST',
        body: JSON.stringify({ text: content }),
      });
      
      const data = await res.json();
      
      if (res.ok && data.success) {
        alert("Posted successfully! Tweet ID: " + data.tweetId);
        setContent('');
        navigate('/');
      } else {
        // Show detailed error from server
        const errorMessage = data.error || "Failed to post. Please try again.";
        const details = data.details ? `\n\nDetails: ${data.details}` : '';
        alert(errorMessage + details);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      alert("Error posting to X: " + errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleSchedule = async () => {
    if (!user) return alert("Please connect your X account first.");
    const dateStr = prompt("Enter scheduled date/time (YYYY-MM-DD HH:mm):", "2026-03-05 12:00");
    if (!dateStr) return;

    setLoading(true);
    try {
      const res = await apiFetch('/api/schedule-post', {
        method: 'POST',
        body: JSON.stringify({ content, scheduledAt: dateStr }),
      });
      if (res.ok) {
        alert("Scheduled successfully!");
        navigate('/schedule');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div className="border-b border-[#141414] pb-6">
        <h1 className="text-4xl font-serif italic">Compose Broadcast</h1>
        <p className="text-xs font-mono uppercase tracking-widest opacity-40">Draft your update</p>
      </div>

      <div className="bg-[#0a0a0a] border border-btc-orange/30 p-8 space-y-6 shadow-[0_0_30px_rgba(247,147,26,0.05)]">
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
              <Clock size={14} /> Schedule
            </button>
            <button
              onClick={handlePost}
              disabled={!content || loading}
              className="flex items-center gap-2 px-6 py-3 bg-btc-orange text-black text-xs font-mono uppercase tracking-widest hover:shadow-[0_0_15px_rgba(247,147,26,0.4)] transition-all disabled:opacity-50"
            >
              {loading ? <Loader2 className="animate-spin" size={14} /> : <Send size={14} />}
              Post Now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const Settings = ({ user, onLogout }: { user: UserData | null; onLogout: () => void }) => {
  return (
    <div className="max-w-2xl mx-auto space-y-12">
      <div className="space-y-6">
        <h1 className="text-4xl font-serif italic border-b border-btc-orange/20 pb-6 text-white bitcoin-glow">System Settings</h1>
        
        <div className="space-y-8">
          {user && (
            <div className="space-y-2">
              <h3 className="text-xs font-mono uppercase tracking-widest font-bold text-btc-orange/60">Account Management</h3>
              <div className="p-6 bg-[#0a0a0a] border border-btc-orange/30 flex items-center justify-between shadow-[0_0_20px_rgba(247,147,26,0.05)]">
                <div className="flex items-center gap-4">
                  <img src={user.profileImage} alt="" className="w-10 h-10 rounded-full border border-btc-orange/20" />
                  <div>
                    <p className="text-xs font-mono font-bold text-white">@{user.username}</p>
                    <p className="text-[10px] font-mono opacity-40">Connected via X</p>
                  </div>
                </div>
                <button 
                  onClick={onLogout}
                  className="px-4 py-2 border border-red-500/30 text-red-500 text-[10px] font-mono uppercase tracking-widest hover:bg-red-500/10 transition-colors"
                >
                  Disconnect
                </button>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <h3 className="text-xs font-mono uppercase tracking-widest font-bold text-btc-orange/60">Data Sources</h3>
            <p className="text-sm text-gray-400">Configure which data nodes are active for report generation.</p>
            <div className="space-y-2 pt-2">
              {['Google Search Grounding', 'Market API Nodes', 'Geopolitical RSS Feeds'].map(s => (
                <div key={s} className="flex items-center justify-between p-4 bg-[#0a0a0a] border border-btc-orange/30">
                  <span className="text-xs font-mono text-gray-300">{s}</span>
                  <div className="w-10 h-5 bg-btc-orange/10 border border-btc-orange/30 rounded-full relative">
                    <div className="absolute right-1 top-1 w-3 h-3 bg-btc-orange rounded-full shadow-[0_0_5px_#f7931a]" />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-mono uppercase tracking-widest font-bold text-btc-orange/60">System Debug</h3>
            <div className="p-6 bg-[#0a0a0a] border border-btc-orange/30 text-gray-300 rounded-sm space-y-4 shadow-[0_0_20px_rgba(247,147,26,0.05)]">
              <div className="flex justify-between items-center border-b border-btc-orange/10 pb-2">
                <span className="text-[10px] font-mono uppercase tracking-widest opacity-40">App URL</span>
                <span className="text-[10px] font-mono truncate max-w-[200px]">{window.location.origin}</span>
              </div>
              <div className="flex justify-between items-center border-b border-btc-orange/10 pb-2">
                <span className="text-[10px] font-mono uppercase tracking-widest opacity-40">Callback Path</span>
                <span className="text-[10px] font-mono">/auth/x/callback</span>
              </div>
              <div className="pt-2">
                <p className="text-[8px] font-mono uppercase opacity-40 mb-1">Full Redirect URI for X Dashboard:</p>
                <code className="text-[9px] font-mono bg-btc-orange/5 p-1 block break-all select-all text-btc-orange/80">
                  {window.location.origin}/auth/x/callback
                </code>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-mono uppercase tracking-widest font-bold text-btc-orange/60">API Configuration</h3>
            <div className="p-6 bg-[#0a0a0a] border border-btc-orange/30 text-gray-300 rounded-sm space-y-4 shadow-[0_0_20px_rgba(247,147,26,0.05)]">
              <div className="flex justify-between items-center border-b border-btc-orange/10 pb-2">
                <span className="text-[10px] font-mono uppercase tracking-widest opacity-40">Gemini Model</span>
                <span className="text-xs font-mono">gemini-3.1-pro-preview</span>
              </div>
              <div className="flex justify-between items-center border-b border-btc-orange/10 pb-2">
                <span className="text-[10px] font-mono uppercase tracking-widest opacity-40">X API Tier</span>
                <span className="text-xs font-mono">Free / Basic</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// --- Main App ---

export default function App() {
  const [user, setUser] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAuth();

    const handleAuthSuccess = (e: MessageEvent) => {
      if (e.data?.type === 'OAUTH_AUTH_SUCCESS') {
        const sid = e.data.sessionId;
        if (sid) {
          console.log("Auth success message received with SID:", sid);
          window.localStorage.setItem('debug_sid', sid);
        }
        console.log("Waiting 3s before checkAuth...");
        setTimeout(() => checkAuth(), 3000);
      }
    };
    window.addEventListener('message', handleAuthSuccess);
    return () => window.removeEventListener('message', handleAuthSuccess);
  }, []);

  const checkAuth = async () => {
    try {
      console.log("Checking health...");
      const healthRes = await apiFetch('/api/health');
      if (healthRes.ok) {
        console.log("Health check OK:", await healthRes.json());
      } else {
        console.warn("Health check failed:", healthRes.status);
      }

      console.log("Checking auth...");
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
      const res = await apiFetch('/api/auth/me', { 
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      
      if (res.ok) {
        const data = await res.json();
        console.log("Auth check success. User:", data.username, "Session:", data.sessionId);
        if (data.sessionId) window.localStorage.setItem('debug_sid', data.sessionId);
        setUser(data);
      } else {
        const data = await res.json().catch(() => ({}));
        console.log("Auth check failed (not logged in). Status:", res.status, "Session:", data.sessionId);
        if (data.sessionId) window.localStorage.setItem('debug_sid', data.sessionId);
        setUser(null);
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        console.error("Auth check timed out after 10s");
      } else {
        console.error("Auth check error:", err);
      }
    } finally {
      console.log("Setting loading to false");
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
      <Layout user={user} onLogout={handleLogout} onRefresh={checkAuth}>
        <Routes>
          <Route path="/" element={<Dashboard user={user} />} />
          <Route path="/profile" element={<Profile user={user} onLogout={handleLogout} />} />
          <Route path="/compose" element={<Compose user={user} />} />
          <Route path="/schedule" element={<Schedule />} />
          <Route path="/settings" element={<Settings user={user} onLogout={handleLogout} />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
