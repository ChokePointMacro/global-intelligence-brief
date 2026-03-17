import React, { useState } from 'react';
import { Twitter, Instagram, Linkedin, AtSign, ExternalLink, Loader2, X as XIcon, Check } from 'lucide-react';
import { apiFetch } from '../lib/api';

export const PLATFORM_CONFIG = {
  x: {
    label: 'X / Twitter',
    Icon: Twitter,
    color: 'text-sky-400',
    border: 'border-sky-400/30',
    bg: 'bg-sky-400/5',
    glow: 'rgba(56,189,248,0.12)',
    docsUrl: 'https://developer.twitter.com/en/portal/projects-and-apps',
    docsLabel: 'Twitter Developer Portal',
    instructions: 'Create an app → Settings → User authentication settings → enable OAuth 2.0 → set redirect URI to your APP_URL/auth/x/callback',
    fields: [
      { key: 'client_id',     label: 'OAuth 2.0 Client ID',     placeholder: 'xxxxxxxxxxxxxxxxxxxxxxxxx',  type: 'text'     },
      { key: 'client_secret', label: 'OAuth 2.0 Client Secret', placeholder: 'xxxxxxxxxxxxxxxxxxxxxxxxx', type: 'password' },
    ],
  },
  instagram: {
    label: 'Instagram',
    Icon: Instagram,
    color: 'text-pink-400',
    border: 'border-pink-400/30',
    bg: 'bg-pink-400/5',
    glow: 'rgba(244,114,182,0.12)',
    docsUrl: 'https://developers.facebook.com/apps',
    docsLabel: 'Meta Developer Console',
    instructions: 'Create a Meta App → Add Instagram product → Basic Display or Business Login → copy App ID & Secret. Set redirect URI to APP_URL/auth/instagram/callback',
    fields: [
      { key: 'app_id',     label: 'App ID',     placeholder: '123456789012345',  type: 'text'     },
      { key: 'app_secret', label: 'App Secret', placeholder: 'abcdef1234567890', type: 'password' },
    ],
  },
  linkedin: {
    label: 'LinkedIn',
    Icon: Linkedin,
    color: 'text-blue-400',
    border: 'border-blue-400/30',
    bg: 'bg-blue-400/5',
    glow: 'rgba(96,165,250,0.12)',
    docsUrl: 'https://www.linkedin.com/developers/apps',
    docsLabel: 'LinkedIn Developer Portal',
    instructions: 'Create an app → Auth tab → copy Client ID & Secret. Add redirect URL: APP_URL/auth/linkedin/callback. Enable products: Sign In with LinkedIn + Share on LinkedIn.',
    fields: [
      { key: 'client_id',     label: 'Client ID',     placeholder: '86abcdefghijklmn',  type: 'text'     },
      { key: 'client_secret', label: 'Client Secret', placeholder: 'abcDEFghiJKLmnop', type: 'password' },
    ],
  },
  threads: {
    label: 'Threads',
    Icon: AtSign,
    color: 'text-purple-400',
    border: 'border-purple-400/30',
    bg: 'bg-purple-400/5',
    glow: 'rgba(192,132,252,0.12)',
    docsUrl: 'https://developers.facebook.com/apps',
    docsLabel: 'Meta Developer Console',
    instructions: 'Create a Meta App → Add Threads product → copy App ID & Secret. Set redirect URI to APP_URL/auth/threads/callback.',
    fields: [
      { key: 'app_id',     label: 'App ID',     placeholder: '123456789012345',  type: 'text'     },
      { key: 'app_secret', label: 'App Secret', placeholder: 'abcdef1234567890', type: 'password' },
    ],
  },
} as const;

export type PlatformKey = keyof typeof PLATFORM_CONFIG;

export const CredentialsModal = ({
  platform,
  onClose,
  onSaved,
}: {
  platform: PlatformKey;
  onClose: () => void;
  onSaved: () => void;
}) => {
  const cfg = PLATFORM_CONFIG[platform];
  const [fields, setFields] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    setSaving(true); setMsg(null);
    try {
      const res = await apiFetch(`/api/platform-credentials/${platform}`, {
        method: 'POST',
        body: JSON.stringify({ credentials: fields }),
      });
      const data = await res.json();
      if (!res.ok) { setMsg({ ok: false, text: data.error || 'Save failed' }); return; }
      setSaved(true);
      setTesting(true);
      try {
        const testRes = await apiFetch(`/api/platform-credentials/${platform}/test`);
        const testData = await testRes.json();
        if (testData.ok) {
          setMsg({ ok: true, text: '✓ Credentials saved and verified' });
          setTimeout(() => { onSaved(); onClose(); }, 1200);
        } else {
          setMsg({ ok: false, text: `Saved but verification failed: ${testData.error}` });
        }
      } finally {
        setTesting(false);
      }
    } catch {
      setMsg({ ok: false, text: 'Network error — please try again.' });
    } finally {
      setSaving(false);
    }
  };

  const appUrl = window.location.origin;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
      <div className="relative w-full max-w-md border border-white/10 bg-[#0d0d0d]" style={{ boxShadow: `0 0 60px ${cfg.glow}` }}>

        <div className={`flex items-center justify-between p-5 border-b ${cfg.border} ${cfg.bg}`}>
          <div className="flex items-center gap-3">
            <cfg.Icon size={16} className={cfg.color} />
            <div>
              <p className={`text-sm font-mono font-bold ${cfg.color}`}>{cfg.label}</p>
              <p className="text-[9px] font-mono uppercase tracking-widest text-white/30">Configure OAuth App</p>
            </div>
          </div>
          <button onClick={onClose} className="text-white/20 hover:text-white/60 transition-colors"><XIcon size={16} /></button>
        </div>

        <div className="p-5 space-y-5">
          <div className="border border-white/5 bg-white/[0.02] p-3 space-y-2">
            <p className="text-[10px] font-mono uppercase tracking-widest text-white/30">Setup Instructions</p>
            <p className="text-[11px] text-white/50 leading-relaxed">{cfg.instructions}</p>
            <div className="pt-1 flex items-center gap-1.5">
              <p className="text-[10px] font-mono text-white/30">Redirect URI to whitelist:</p>
              <code className={`text-[10px] font-mono ${cfg.color}`}>{appUrl}/auth/{platform}/callback</code>
            </div>
            <a href={cfg.docsUrl} target="_blank" rel="noopener noreferrer"
              className={`inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider ${cfg.color} opacity-60 hover:opacity-100 transition-opacity`}>
              <ExternalLink size={10} /> {cfg.docsLabel}
            </a>
          </div>

          <div className="space-y-3">
            {cfg.fields.map(f => (
              <div key={f.key}>
                <label className="text-[9px] font-mono uppercase tracking-widest text-white/30 block mb-1">{f.label}</label>
                <input
                  type={f.type}
                  placeholder={f.placeholder}
                  value={fields[f.key] || ''}
                  onChange={e => setFields(prev => ({ ...prev, [f.key]: e.target.value }))}
                  className={`w-full bg-black/60 border border-white/10 text-white text-xs font-mono px-3 py-2.5 outline-none focus:${cfg.border} transition-colors placeholder:text-white/15`}
                />
              </div>
            ))}
          </div>

          {msg && (
            <p className={`text-[11px] font-mono ${msg.ok ? 'text-green-400' : 'text-red-400'}`}>{msg.text}</p>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving || testing || cfg.fields.some(f => !fields[f.key]?.trim())}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 border ${cfg.border} ${cfg.bg} ${cfg.color} text-[10px] font-mono uppercase tracking-widest hover:opacity-80 transition-all disabled:opacity-30`}
            >
              {saving ? <Loader2 size={11} className="animate-spin" /> :
               testing ? <><Loader2 size={11} className="animate-spin" /> Verifying...</> :
               saved ? <><Check size={11} /> Saved</> :
               <><Check size={11} /> Save & Verify</>}
            </button>
            <button onClick={onClose} className="px-4 py-2.5 border border-white/10 text-white/30 text-[10px] font-mono uppercase tracking-widest hover:text-white/50 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
