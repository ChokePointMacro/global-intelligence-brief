import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Menu, X } from 'lucide-react';
import { CPMLogo } from './CPMLogo';
import { Dropdown } from './Dropdown';
import { AuthModal } from './AuthModal';
import MatrixBackground from './MatrixBackground';
import type { UserData } from '../types';

const NAV_ITEMS = [
  { to: '/', label: 'Briefing' },
  { to: '/markets', label: 'Markets' },
  { to: '/reports', label: 'Reports' },
  { to: '/automated', label: 'Automated' },
  { to: '/terminal', label: 'Terminal' },
  { to: '/trade-flow', label: 'Trade Flow' },
];

const AUTH_NAV_ITEMS = [
  { to: '/compose', label: 'Compose' },
  { to: '/schedule', label: 'Schedule' },
];

function NavLink({ to, label, active, onClick }: { to: string; label: string; active: boolean; onClick?: () => void }) {
  return (
    <Link
      to={to}
      onClick={onClick}
      className={`text-[10px] font-mono uppercase tracking-widest transition-colors ${
        active
          ? 'text-btc-orange'
          : 'text-gray-400 hover:text-btc-orange'
      }`}
    >
      {label}
      {active && <span className="block h-[1px] bg-btc-orange mt-0.5 shadow-[0_0_4px_#f7931a]" />}
    </Link>
  );
}

export const Layout = ({ children, user, onLogout, onLogin }: {
  children: React.ReactNode;
  user: UserData | null;
  onLogout: () => void;
  onLogin: (u: UserData) => void;
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  const allNavItems = [...NAV_ITEMS, ...(user ? AUTH_NAV_ITEMS : [])];

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

          <div className="flex items-center gap-4 sm:gap-6">
            {/* Desktop nav */}
            <nav className="hidden md:flex items-center gap-5 border-r border-btc-orange/20 pr-5">
              {allNavItems.map(item => (
                <NavLink key={item.to} to={item.to} label={item.label} active={isActive(item.to)} />
              ))}
            </nav>

            {/* Mobile menu button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden text-gray-400 hover:text-btc-orange transition-colors p-1"
            >
              {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>

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

        {/* Mobile nav dropdown */}
        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.nav
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="md:hidden overflow-hidden border-t border-btc-orange/10 bg-[#0a0a0a]/98 backdrop-blur-md"
            >
              <div className="px-4 py-3 flex flex-wrap gap-x-6 gap-y-2">
                {allNavItems.map(item => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    label={item.label}
                    active={isActive(item.to)}
                    onClick={() => setMobileMenuOpen(false)}
                  />
                ))}
              </div>
            </motion.nav>
          )}
        </AnimatePresence>
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
            <p className="text-[9px] font-mono uppercase tracking-widest opacity-30">&copy; 2026 ChokePoint Macro</p>
          </div>
        </div>
      </footer>
    </div>
  );
};
