import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronDown, User, Send, Calendar, Settings as SettingsIcon, LogOut, BarChart2, FileText } from 'lucide-react';
import { cn } from '../lib/utils';
import type { UserData } from '../types';

export const Dropdown = ({ user, onLogout }: { user: UserData; onLogout: () => void }) => {
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
                { to: '/profile',  icon: <User size={14} />,        label: 'Profile'  },
                { to: '/markets',  icon: <BarChart2 size={14} />,   label: 'Markets'  },
                { to: '/reports',  icon: <FileText size={14} />,    label: 'Reports'  },
                { to: '/compose',  icon: <Send size={14} />,        label: 'Compose'  },
                { to: '/schedule', icon: <Calendar size={14} />,    label: 'Schedule' },
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
