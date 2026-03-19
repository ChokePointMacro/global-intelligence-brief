import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence } from 'motion/react';
import { CPMLogo } from './CPMLogo';
import { Dropdown } from './Dropdown';
import { AuthModal } from './AuthModal';
import MatrixBackground from './MatrixBackground';
import type { UserData } from '../types';

export const Layout = ({ children, user, onLogout, onLogin }: {
  children: React.ReactNode;
  user: UserData | null;
  onLogout: () => void;
  onLogin: (u: UserData) => void;
}) => {
  const navigate = useNavigate();
  const [showAuthModal, setShowAuthModal] = useState(false);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-gray-300 font-sans selection:bg-btc-orange selection:text-black relative overflow-x-hidden">
      <MatrixBackground />

      <header className="sticky top-0 z-40 bg-[#0a0a0a]/95 backdrop-blur-md border-b border-btc-orange/20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <button onClick={() => navigate('/')} className="flex items-center gap-2.5 group cursor-pointer">
            <CPMLogo size={34} className="group-hover:opacity-80 transition-opacity" />
            <div className="flex flex-col items-start leading-none">
              <span className="text-[11px] font-mono font-bold tracking-[0.25em] uppercase text-white">ChokePoint</span>
              <span className="text-[11px] font-mono font-bold tracking-[0.25em] uppercase text-btc-orange" style={{ textShadow: '0 0 8px rgba(247,147,26,0.6)' }}>Macro</span>
            </div>
          </button>

          <div className="flex items-center gap-6">
            <nav className="flex items-center gap-4 sm:gap-6 border-r border-btc-orange/20 pr-4 sm:pr-6">
              <Link to="/" className="text-[10px] font-mono uppercase tracking-widest hover:text-btc-orange transition-colors hidden sm:inline">Briefing</Link>
              <Link to="/markets" className="text-[10px] font-mono uppercase tracking-widest hover:text-btc-orange transition-colors hidden sm:inline">Markets</Link>
              <Link to="/reports" className="text-[10px] font-mono uppercase tracking-widest hover:text-btc-orange transition-colors hidden sm:inline">Reports</Link>
              <Link to="/automated" className="text-[10px] font-mono uppercase tracking-widest hover:text-btc-orange transition-colors hidden sm:inline">Automated</Link>
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
