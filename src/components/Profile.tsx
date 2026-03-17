import React, { useState, useEffect } from 'react';
import {
  Twitter, Instagram, Linkedin, AtSign, MessageSquare, FileText, Send,
  Activity, Link2, Award, Shield, Clock, Lock, Loader2, Check, X as XIcon,
  LogOut, ChevronRight, Mail, Pencil,
} from 'lucide-react';
import { Settings as SettingsIcon } from 'lucide-react';
import { cn } from '../lib/utils';
import { apiFetch } from '../lib/api';
import { BackButton } from './BackButton';
import { CredentialsModal, PLATFORM_CONFIG, type PlatformKey } from './CredentialsModal';
import type { UserData, SocialAccount } from '../types';

const CLEARANCE_LEVELS = [
  { min: 0,  label: 'Recruit',              color: 'text-gray-400',   border: 'border-gray-400/30',   bg: 'bg-gray-400/10'   },
  { min: 1,  label: 'Analyst',              color: 'text-sky-400',    border: 'border-sky-400/30',    bg: 'bg-sky-400/10'    },
  { min: 5,  label: 'Senior Analyst',       color: 'text-blue-400',   border: 'border-blue-400/30',   bg: 'bg-blue-400/10'   },
  { min: 15, label: 'Field Operative',      color: 'text-purple-400', border: 'border-purple-400/30', bg: 'bg-purple-400/10' },
  { min: 30, label: 'Intelligence Officer', color: 'text-btc-orange', border: 'border-btc-orange/30', bg: 'bg-btc-orange/10' },
  { min: 50, label: 'Strategic Director',   color: 'text-yellow-300', border: 'border-yellow-300/30', bg: 'bg-yellow-300/10' },
];

const getClearance = (count: number) => {
  let level = CLEARANCE_LEVELS[0];
  for (const l of CLEARANCE_LEVELS) { if (count >= l.min) level = l; }
  return level;
};

const PROFILE_TYPE_META: Record<string, { label: string; color: string; bar: string }> = {
  global:       { label: 'Global Pulse',   color: 'text-blue-400',   bar: 'bg-blue-400'   },
  crypto:       { label: 'Crypto',         color: 'text-btc-orange', bar: 'bg-btc-orange' },
  equities:     { label: 'S&P 500',        color: 'text-green-400',  bar: 'bg-green-400'  },
  nasdaq:       { label: 'Nasdaq-100',     color: 'text-purple-400', bar: 'bg-purple-400' },
  conspiracies: { label: 'Conspiracies',   color: 'text-red-400',    bar: 'bg-red-400'    },
  forecast:     { label: '7-Day Forecast', color: 'text-yellow-400', bar: 'bg-yellow-400' },
  custom:       { label: 'Custom',         color: 'text-teal-400',   bar: 'bg-teal-400'   },
  china:        { label: 'China S.C.',     color: 'text-red-400',    bar: 'bg-red-400'    },
};

export const Profile = ({ user, onLogout }: { user: UserData | null; onLogout: () => void }) => {
  const [reports, setReports] = useState<any[]>([]);
  const [socialAccounts, setSocialAccounts] = useState<SocialAccount[]>([]);
  const [postStats, setPostStats] = useState({ posted: 0, pending: 0 });
  const [loading, setLoading] = useState(true);

  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState('');
  const [nameSaving, setNameSaving] = useState(false);
  const [nameSuccess, setNameSuccess] = useState(false);

  const [showPwForm, setShowPwForm] = useState(false);
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [blueskyForm, setBlueskyForm] = useState({ identifier: '', appPassword: '' });
  const [blueskyLoading, setBlueskyLoading] = useState(false);
  const [blueskyMsg, setBlueskyMsg] = useState('');
  const [connectingPlatform, setConnectingPlatform] = useState<string | null>(null);
  const [credModal, setCredModal] = useState<PlatformKey | null>(null);
  const [configuredPlatforms, setConfiguredPlatforms] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!user) return;
    setNameVal(user.displayName || '');
    Promise.all([
      apiFetch('/api/reports').then(r => r.ok ? r.json() : []),
      apiFetch('/api/social/accounts').then(r => r.ok ? r.json() : { accounts: [] }),
      apiFetch('/api/scheduled-posts').then(r => r.ok ? r.json() : []),
      apiFetch('/api/platform-credentials').then(r => r.ok ? r.json() : {}),
    ]).then(([reps, social, posts, creds]) => {
      const configured: Record<string, boolean> = {};
      for (const [p, v] of Object.entries(creds as any)) configured[p] = (v as any).configured;
      setConfiguredPlatforms(configured);
      setReports(Array.isArray(reps) ? reps : []);
      setSocialAccounts(social.accounts || []);
      setPostStats({
        posted: posts.filter((p: any) => p.status === 'posted').length,
        pending: posts.filter((p: any) => p.status === 'pending').length,
      });
    }).finally(() => setLoading(false));
  }, [user]);

  const connectOAuth = (platform: string, event: string) => {
    setConnectingPlatform(platform);
    apiFetch(`/api/auth/${platform}/url`).then(r => r.json()).then(data => {
      if (data.needsConfig) {
        setConnectingPlatform(null);
        const key = (platform === 'x/connect' ? 'x' : platform) as PlatformKey;
        if (key in PLATFORM_CONFIG) setCredModal(key);
        return;
      }
      if (!data.url) { alert(data.error || `Failed to get ${platform} auth URL`); setConnectingPlatform(null); return; }
      const popup = window.open(data.url, `${platform}_auth`, 'width=600,height=700');
      const handler = (e: MessageEvent) => {
        if (e.data?.type === event) {
          window.removeEventListener('message', handler);
          popup?.close();
          const platformKey = platform === 'x/connect' ? 'x' : platform.split('/')[0];
          if (e.data.handle) setSocialAccounts(prev => [...prev.filter(a => a.platform !== platformKey), { platform: platformKey, handle: e.data.handle }]);
          apiFetch('/api/social/accounts').then(r => r.json()).then(d => setSocialAccounts(d.accounts || []));
          setConnectingPlatform(null);
        }
      };
      window.addEventListener('message', handler);
    }).catch(() => setConnectingPlatform(null));
  };

  const disconnectPlatform = async (platform: string) => {
    if (!confirm(`Disconnect ${platform}?`)) return;
    await apiFetch(`/api/social/${platform}`, { method: 'DELETE' });
    setSocialAccounts(prev => prev.filter(a => a.platform !== platform));
  };

  const connectBluesky = async () => {
    if (!blueskyForm.identifier || !blueskyForm.appPassword) return setBlueskyMsg("Enter handle and app password.");
    setBlueskyLoading(true); setBlueskyMsg('');
    const res = await apiFetch('/api/social/bluesky/connect', { method: 'POST', body: JSON.stringify(blueskyForm) });
    const data = await res.json();
    if (res.ok) {
      setBlueskyMsg(`✓ Connected as ${data.handle}`);
      setBlueskyForm({ identifier: '', appPassword: '' });
      setSocialAccounts(prev => [...prev.filter(a => a.platform !== 'bluesky'), { platform: 'bluesky', handle: data.handle }]);
    } else { setBlueskyMsg(`✗ ${data.error}`); }
    setBlueskyLoading(false);
  };

  const saveName = async () => {
    if (!nameVal.trim()) return;
    setNameSaving(true);
    const r = await apiFetch('/api/auth/profile', { method: 'PATCH', body: JSON.stringify({ displayName: nameVal.trim() }) });
    setNameSaving(false);
    if (r.ok) { setEditingName(false); setNameSuccess(true); setTimeout(() => setNameSuccess(false), 2000); }
  };

  const savePassword = async () => {
    if (!pwCurrent || !pwNew || !pwConfirm) { setPwMsg({ ok: false, text: 'All fields required' }); return; }
    if (pwNew !== pwConfirm) { setPwMsg({ ok: false, text: 'New passwords do not match' }); return; }
    if (pwNew.length < 8) { setPwMsg({ ok: false, text: 'New password must be at least 8 characters' }); return; }
    setPwSaving(true);
    const r = await apiFetch('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: pwCurrent, newPassword: pwNew }) });
    const data = await r.json();
    setPwSaving(false);
    if (r.ok) { setPwMsg({ ok: true, text: 'Password updated successfully' }); setPwCurrent(''); setPwNew(''); setPwConfirm(''); setTimeout(() => setShowPwForm(false), 1500); }
    else setPwMsg({ ok: false, text: data.error || 'Failed to update password' });
  };

  if (!user) return <div className="text-center py-20 font-mono text-white/40">Loading profile...</div>;

  const refreshCredentials = () => {
    apiFetch('/api/platform-credentials').then(r => r.ok ? r.json() : {}).then(creds => {
      const configured: Record<string, boolean> = {};
      for (const [p, v] of Object.entries(creds as any)) configured[p] = (v as any).configured;
      setConfiguredPlatforms(configured);
    });
  };

  const byType = reports.reduce((acc: Record<string, number>, r: any) => { acc[r.type] = (acc[r.type] || 0) + 1; return acc; }, {});
  const maxTypeCount = Math.max(1, ...Object.values(byType) as number[]);
  const clearance = getClearance(reports.length);
  const connectedCount = socialAccounts.length;
  const initials = (user.displayName || user.username || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-12">
      {credModal && (
        <CredentialsModal
          platform={credModal}
          onClose={() => setCredModal(null)}
          onSaved={() => { refreshCredentials(); setCredModal(null); }}
        />
      )}
      <BackButton />

      <div className="relative border border-btc-orange/20 bg-gradient-to-b from-btc-orange/[0.04] to-transparent overflow-hidden">
        <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'repeating-linear-gradient(0deg, #f7931a 0, #f7931a 1px, transparent 1px, transparent 40px), repeating-linear-gradient(90deg, #f7931a 0, #f7931a 1px, transparent 1px, transparent 40px)' }} />

        <div className="relative p-8 flex flex-col sm:flex-row items-center sm:items-start gap-6">
          <div className="relative flex-shrink-0">
            <div className="w-24 h-24 rounded-full border-2 border-btc-orange/40 overflow-hidden bg-btc-orange/10 flex items-center justify-center"
              style={{ boxShadow: '0 0 30px rgba(247,147,26,0.18)' }}>
              {user.profileImage
                ? <img src={user.profileImage} alt={user.displayName} className="w-full h-full object-cover" />
                : <span className="text-3xl font-mono font-bold text-btc-orange">{initials}</span>
              }
            </div>
            <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-[#0a0a0a] border border-white/10 flex items-center justify-center">
              {user.authMethod === 'x' ? <Twitter size={12} className="text-sky-400" /> : <Mail size={12} className="text-btc-orange" />}
            </div>
          </div>

          <div className="flex-1 text-center sm:text-left">
            <div className="flex items-center justify-center sm:justify-start gap-2 mb-1">
              {editingName ? (
                <div className="flex items-center gap-2">
                  <input
                    value={nameVal}
                    onChange={e => setNameVal(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') setEditingName(false); }}
                    className="bg-black/60 border border-btc-orange/40 text-white text-xl font-serif italic px-2 py-0.5 outline-none focus:border-btc-orange/80"
                    autoFocus
                    maxLength={50}
                  />
                  <button onClick={saveName} disabled={nameSaving} className="text-green-400 hover:text-green-300">
                    {nameSaving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  </button>
                  <button onClick={() => setEditingName(false)} className="text-white/30 hover:text-white/60"><XIcon size={14} /></button>
                </div>
              ) : (
                <>
                  <h1 className="text-2xl font-serif italic text-white">{nameSuccess ? '✓ Saved' : (user.displayName || user.username)}</h1>
                  <button onClick={() => setEditingName(true)} className="text-white/20 hover:text-btc-orange/60 transition-colors">
                    <Pencil size={12} />
                  </button>
                </>
              )}
            </div>
            <p className="text-[11px] font-mono text-white/40">@{user.username}</p>

            <div className={`inline-flex items-center gap-1.5 mt-3 px-2.5 py-1 border text-[10px] font-mono uppercase tracking-widest ${clearance.color} ${clearance.border} ${clearance.bg}`}>
              <Shield size={10} />
              {clearance.label}
            </div>
          </div>

          <button onClick={onLogout}
            className="flex items-center gap-2 px-4 py-2 border border-red-500/20 bg-red-500/5 text-red-400 text-[10px] font-mono uppercase tracking-widest hover:bg-red-500/10 hover:border-red-500/40 transition-all">
            <LogOut size={11} /> Logout
          </button>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-3 gap-3">
          {[0,1,2].map(i => <div key={i} className="border border-white/5 bg-white/[0.02] h-20 animate-pulse" />)}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Reports Generated', value: reports.length,  icon: <FileText size={14} />,   color: 'text-btc-orange', border: 'border-btc-orange/20', bg: 'bg-btc-orange/5' },
            { label: 'Posts Published',   value: postStats.posted, icon: <Send size={14} />,       color: 'text-green-400',  border: 'border-green-400/20',  bg: 'bg-green-400/5'  },
            { label: 'Networks Live',     value: connectedCount,   icon: <Activity size={14} />,   color: 'text-purple-400', border: 'border-purple-400/20', bg: 'bg-purple-400/5' },
          ].map(s => (
            <div key={s.label} className={`border ${s.border} ${s.bg} p-4 text-center`}>
              <div className={`flex justify-center mb-1 ${s.color} opacity-60`}>{s.icon}</div>
              <p className={`text-2xl font-mono font-bold ${s.color}`}>{s.value}</p>
              <p className="text-[9px] font-mono uppercase tracking-widest text-white/30 mt-1">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="border border-white/8 bg-black/20 p-5 space-y-3">
          <div className="flex items-center gap-2 mb-4">
            <Award size={12} className="text-btc-orange/60" />
            <p className="text-[10px] font-mono uppercase tracking-widest text-white/40">Intelligence Breakdown</p>
          </div>
          {Object.keys(PROFILE_TYPE_META).map(type => {
            const count = byType[type] || 0;
            const meta = PROFILE_TYPE_META[type];
            const pct = (count / maxTypeCount) * 100;
            return (
              <div key={type} className="space-y-1">
                <div className="flex justify-between items-center">
                  <span className={`text-[9px] font-mono uppercase tracking-wider ${meta.color}`}>{meta.label}</span>
                  <span className="text-[9px] font-mono text-white/30">{count}</span>
                </div>
                <div className="h-1 bg-white/5 overflow-hidden">
                  <div className={`h-full ${meta.bar} transition-all duration-700`} style={{ width: `${pct}%`, opacity: count > 0 ? 1 : 0.15 }} />
                </div>
              </div>
            );
          })}
          {reports.length === 0 && <p className="text-[10px] font-mono text-white/20 text-center py-2">No reports generated yet</p>}
        </div>

        <div className="border border-white/8 bg-black/20 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Link2 size={12} className="text-btc-orange/60" />
            <p className="text-[10px] font-mono uppercase tracking-widest text-white/40">Connected Networks</p>
          </div>
          <div className="space-y-2">
            {/* X */}
            {(() => {
              const acct = socialAccounts.find(a => a.platform === 'x');
              const isXLogin = user.authMethod === 'x';
              return (
                <div className={`border p-3 transition-all ${acct || isXLogin ? 'border-sky-400/20 bg-sky-400/5' : 'border-white/5'}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Twitter size={13} className={acct || isXLogin ? 'text-sky-400' : 'text-white/20'} />
                      <span className={`text-[10px] font-mono ${acct || isXLogin ? 'text-white/70' : 'text-white/25'}`}>X / Twitter</span>
                      {(acct || isXLogin) && <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />}
                    </div>
                    <div className="flex items-center gap-3">
                      {isXLogin
                        ? <span className="text-[9px] font-mono text-sky-400/70">Active via X login</span>
                        : acct
                          ? <>
                              <span className="text-[9px] font-mono text-sky-400">{acct.handle}</span>
                              <button onClick={() => disconnectPlatform('x')} className="text-[9px] font-mono text-red-400/60 hover:text-red-400 uppercase tracking-wider transition-colors">Disconnect</button>
                            </>
                          : <div className="flex items-center gap-1.5">
                            {!configuredPlatforms['x'] && (
                              <button onClick={() => setCredModal('x')} className="flex items-center gap-1 px-2 py-1.5 border border-white/10 text-white/30 text-[9px] font-mono uppercase tracking-wider hover:text-btc-orange/60 hover:border-btc-orange/20 transition-all" title="Configure OAuth App">
                                <SettingsIcon size={9} /> Configure
                              </button>
                            )}
                            <button
                              onClick={() => connectOAuth('x/connect', 'OAUTH_X_CONNECT_SUCCESS')}
                              disabled={connectingPlatform === 'x/connect'}
                              className="flex items-center gap-1.5 px-2.5 py-1.5 border border-sky-400/30 bg-sky-400/5 text-sky-400 text-[9px] font-mono uppercase tracking-wider hover:bg-sky-400/10 transition-all disabled:opacity-40"
                            >
                              {connectingPlatform === 'x/connect' ? <Loader2 size={10} className="animate-spin" /> : <Twitter size={10} />} Connect
                            </button>
                          </div>
                      }
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Instagram */}
            {(() => {
              const acct = socialAccounts.find(a => a.platform === 'instagram');
              return (
                <div className={`border p-3 transition-all ${acct ? 'border-pink-400/20 bg-pink-400/5' : 'border-white/5'}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Instagram size={13} className={acct ? 'text-pink-400' : 'text-white/20'} />
                      <span className={`text-[10px] font-mono ${acct ? 'text-white/70' : 'text-white/25'}`}>Instagram</span>
                      {acct && <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />}
                    </div>
                    <div className="flex items-center gap-3">
                      {acct
                        ? <>
                            <span className="text-[9px] font-mono text-pink-400">{acct.handle}</span>
                            <button onClick={() => disconnectPlatform('instagram')} className="text-[9px] font-mono text-red-400/60 hover:text-red-400 uppercase tracking-wider transition-colors">Disconnect</button>
                          </>
                        : <div className="flex items-center gap-1.5">
                            {!configuredPlatforms['instagram'] && (
                              <button onClick={() => setCredModal('instagram')} className="flex items-center gap-1 px-2 py-1.5 border border-white/10 text-white/30 text-[9px] font-mono uppercase tracking-wider hover:text-btc-orange/60 hover:border-btc-orange/20 transition-all" title="Configure OAuth App">
                                <SettingsIcon size={9} /> Configure
                              </button>
                            )}
                            <button
                              onClick={() => connectOAuth('instagram', 'OAUTH_INSTAGRAM_SUCCESS')}
                              disabled={connectingPlatform === 'instagram'}
                              className="flex items-center gap-1.5 px-2.5 py-1.5 border border-pink-400/30 bg-pink-400/5 text-pink-400 text-[9px] font-mono uppercase tracking-wider hover:bg-pink-400/10 transition-all disabled:opacity-40"
                            >
                              {connectingPlatform === 'instagram' ? <Loader2 size={10} className="animate-spin" /> : <Instagram size={10} />} Connect
                            </button>
                          </div>
                      }
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* LinkedIn */}
            {(() => {
              const acct = socialAccounts.find(a => a.platform === 'linkedin');
              return (
                <div className={`border p-3 transition-all ${acct ? 'border-blue-400/20 bg-blue-400/5' : 'border-white/5'}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Linkedin size={13} className={acct ? 'text-blue-400' : 'text-white/20'} />
                      <span className={`text-[10px] font-mono ${acct ? 'text-white/70' : 'text-white/25'}`}>LinkedIn</span>
                      {acct && <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />}
                    </div>
                    <div className="flex items-center gap-3">
                      {acct
                        ? <>
                            <span className="text-[9px] font-mono text-blue-400">{acct.handle}</span>
                            <button onClick={() => disconnectPlatform('linkedin')} className="text-[9px] font-mono text-red-400/60 hover:text-red-400 uppercase tracking-wider transition-colors">Disconnect</button>
                          </>
                        : <div className="flex items-center gap-1.5">
                            {!configuredPlatforms['linkedin'] && (
                              <button onClick={() => setCredModal('linkedin')} className="flex items-center gap-1 px-2 py-1.5 border border-white/10 text-white/30 text-[9px] font-mono uppercase tracking-wider hover:text-btc-orange/60 hover:border-btc-orange/20 transition-all" title="Configure OAuth App">
                                <SettingsIcon size={9} /> Configure
                              </button>
                            )}
                            <button
                              onClick={() => connectOAuth('linkedin', 'OAUTH_LINKEDIN_SUCCESS')}
                              disabled={connectingPlatform === 'linkedin'}
                              className="flex items-center gap-1.5 px-2.5 py-1.5 border border-blue-400/30 bg-blue-400/5 text-blue-400 text-[9px] font-mono uppercase tracking-wider hover:bg-blue-400/10 transition-all disabled:opacity-40"
                            >
                              {connectingPlatform === 'linkedin' ? <Loader2 size={10} className="animate-spin" /> : <Linkedin size={10} />} Connect
                            </button>
                          </div>
                      }
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Threads */}
            {(() => {
              const acct = socialAccounts.find(a => a.platform === 'threads');
              return (
                <div className={`border p-3 transition-all ${acct ? 'border-purple-400/20 bg-purple-400/5' : 'border-white/5'}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <AtSign size={13} className={acct ? 'text-purple-400' : 'text-white/20'} />
                      <span className={`text-[10px] font-mono ${acct ? 'text-white/70' : 'text-white/25'}`}>Threads</span>
                      {acct && <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />}
                    </div>
                    <div className="flex items-center gap-3">
                      {acct
                        ? <>
                            <span className="text-[9px] font-mono text-purple-400">{acct.handle}</span>
                            <button onClick={() => disconnectPlatform('threads')} className="text-[9px] font-mono text-red-400/60 hover:text-red-400 uppercase tracking-wider transition-colors">Disconnect</button>
                          </>
                        : <div className="flex items-center gap-1.5">
                            {!configuredPlatforms['threads'] && (
                              <button onClick={() => setCredModal('threads')} className="flex items-center gap-1 px-2 py-1.5 border border-white/10 text-white/30 text-[9px] font-mono uppercase tracking-wider hover:text-btc-orange/60 hover:border-btc-orange/20 transition-all" title="Configure OAuth App">
                                <SettingsIcon size={9} /> Configure
                              </button>
                            )}
                            <button
                              onClick={() => connectOAuth('threads', 'OAUTH_THREADS_SUCCESS')}
                              disabled={connectingPlatform === 'threads'}
                              className="flex items-center gap-1.5 px-2.5 py-1.5 border border-purple-400/30 bg-purple-400/5 text-purple-400 text-[9px] font-mono uppercase tracking-wider hover:bg-purple-400/10 transition-all disabled:opacity-40"
                            >
                              {connectingPlatform === 'threads' ? <Loader2 size={10} className="animate-spin" /> : <AtSign size={10} />} Connect
                            </button>
                          </div>
                      }
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Bluesky */}
            {(() => {
              const acct = socialAccounts.find(a => a.platform === 'bluesky');
              return (
                <div className={`border p-3 transition-all ${acct ? 'border-cyan-400/20 bg-cyan-400/5' : 'border-white/5'}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <MessageSquare size={13} className={acct ? 'text-cyan-400' : 'text-white/20'} />
                      <span className={`text-[10px] font-mono ${acct ? 'text-white/70' : 'text-white/25'}`}>Bluesky</span>
                      {acct && <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />}
                    </div>
                    <div className="flex items-center gap-3">
                      {acct
                        ? <>
                            <span className="text-[9px] font-mono text-cyan-400">{acct.handle}</span>
                            <button onClick={() => disconnectPlatform('bluesky')} className="text-[9px] font-mono text-red-400/60 hover:text-red-400 uppercase tracking-wider transition-colors">Disconnect</button>
                          </>
                        : <button
                            onClick={() => setConnectingPlatform(prev => prev === 'bluesky' ? null : 'bluesky')}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 border border-cyan-400/30 bg-cyan-400/5 text-cyan-400 text-[9px] font-mono uppercase tracking-wider hover:bg-cyan-400/10 transition-all"
                          >
                            <MessageSquare size={10} /> Connect
                          </button>
                      }
                    </div>
                  </div>
                  {connectingPlatform === 'bluesky' && !acct && (
                    <div className="mt-3 pt-3 border-t border-cyan-400/10 space-y-2">
                      <input
                        type="text" placeholder="handle (e.g. you.bsky.social)"
                        value={blueskyForm.identifier}
                        onChange={e => setBlueskyForm(f => ({ ...f, identifier: e.target.value }))}
                        className="w-full bg-black/40 border border-white/10 text-white text-[11px] font-mono px-2.5 py-1.5 outline-none focus:border-cyan-400/40 placeholder:text-white/20"
                      />
                      <input
                        type="password" placeholder="App Password (from bsky.app/settings)"
                        value={blueskyForm.appPassword}
                        onChange={e => setBlueskyForm(f => ({ ...f, appPassword: e.target.value }))}
                        className="w-full bg-black/40 border border-white/10 text-white text-[11px] font-mono px-2.5 py-1.5 outline-none focus:border-cyan-400/40 placeholder:text-white/20"
                      />
                      {blueskyMsg && <p className={`text-[10px] font-mono ${blueskyMsg.startsWith('✓') ? 'text-green-400' : 'text-red-400'}`}>{blueskyMsg}</p>}
                      <button
                        onClick={connectBluesky} disabled={blueskyLoading}
                        className="flex items-center gap-1.5 px-3 py-1.5 border border-cyan-400/30 bg-cyan-400/5 text-cyan-400 text-[9px] font-mono uppercase tracking-wider hover:bg-cyan-400/10 transition-all disabled:opacity-40"
                      >
                        {blueskyLoading ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />} Authenticate
                      </button>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      </div>

      {reports.length > 0 && (
        <div className="border border-white/8 bg-black/20 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Clock size={12} className="text-btc-orange/60" />
            <p className="text-[10px] font-mono uppercase tracking-widest text-white/40">Recent Intelligence</p>
          </div>
          <div className="space-y-2">
            {reports.slice(0, 5).map((r: any) => {
              const meta = PROFILE_TYPE_META[r.type] || PROFILE_TYPE_META.custom;
              const title = r.content?.analysis?.overallSummary
                ? r.content.analysis.overallSummary.slice(0, 80) + '...'
                : r.custom_topic || r.type;
              return (
                <div key={r.id} className="flex items-center gap-3 py-2 border-b border-white/[0.04] last:border-0">
                  <span className={`text-[8px] font-mono uppercase tracking-widest px-1.5 py-0.5 border ${meta.color} border-current/30 opacity-70 flex-shrink-0`}>
                    {r.type}
                  </span>
                  <span className="text-[11px] text-white/50 font-mono flex-1 truncate">{title}</span>
                  <span className="text-[9px] font-mono text-white/20 flex-shrink-0">
                    {new Date(r.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {user.authMethod === 'email' && (
        <div className="border border-white/8 bg-black/20 p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Lock size={12} className="text-btc-orange/60" />
            <p className="text-[10px] font-mono uppercase tracking-widest text-white/40">Account Security</p>
          </div>

          <button
            onClick={() => { setShowPwForm(!showPwForm); setPwMsg(null); }}
            className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-white/40 hover:text-btc-orange/70 transition-colors"
          >
            <ChevronRight size={11} className={`transition-transform ${showPwForm ? 'rotate-90' : ''}`} />
            Change Password
          </button>

          {showPwForm && (
            <div className="space-y-3 pl-4 border-l border-btc-orange/20">
              {[
                { label: 'Current Password', val: pwCurrent, set: setPwCurrent },
                { label: 'New Password',     val: pwNew,     set: setPwNew     },
                { label: 'Confirm New',      val: pwConfirm, set: setPwConfirm },
              ].map(f => (
                <div key={f.label}>
                  <label className="text-[9px] font-mono uppercase tracking-widest text-white/30 block mb-1">{f.label}</label>
                  <input
                    type="password"
                    value={f.val}
                    onChange={e => f.set(e.target.value)}
                    className="w-full bg-black/40 border border-white/10 text-white text-xs font-mono px-3 py-2 outline-none focus:border-btc-orange/40 transition-colors"
                  />
                </div>
              ))}
              {pwMsg && (
                <p className={`text-[10px] font-mono ${pwMsg.ok ? 'text-green-400' : 'text-red-400'}`}>{pwMsg.text}</p>
              )}
              <button
                onClick={savePassword}
                disabled={pwSaving}
                className="flex items-center gap-2 px-4 py-2 border border-btc-orange/30 bg-btc-orange/5 text-btc-orange text-[10px] font-mono uppercase tracking-widest hover:bg-btc-orange/10 transition-all disabled:opacity-40"
              >
                {pwSaving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                Update Password
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
