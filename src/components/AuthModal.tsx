import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Loader2, X as XIcon } from 'lucide-react';
import { cn } from '../lib/utils';
import { apiFetch } from '../lib/api';
import { CPMLogo } from './CPMLogo';
import type { UserData } from '../types';

export const AuthModal = ({ onClose, onSuccess }: { onClose: () => void; onSuccess: (user: UserData) => void }) => {
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

      if (data.sessionId) window.localStorage.setItem('debug_sid', data.sessionId);

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
