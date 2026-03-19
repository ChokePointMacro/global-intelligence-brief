import React, { useState, useEffect } from 'react';
import {
  Twitter, Instagram, MessageSquare, Bell, BookOpen,
  Loader2, Check, Plus, Trash2, ToggleLeft, ToggleRight, X as XIcon, Pencil,
} from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../lib/utils';
import { apiFetch } from '../lib/api';
import { BackButton } from './BackButton';
import type { UserData, SocialAccount, ReportSchedule } from '../types';

const SettingsSection = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="space-y-2">
    <h3 className="text-xs font-mono uppercase tracking-widest font-bold text-btc-orange/60">{title}</h3>
    {children}
  </div>
);

export const Settings = ({ user, onLogout }: { user: UserData | null; onLogout: () => void }) => {
  const [watermark, setWatermark] = useState(() => {
    try { return JSON.parse(localStorage.getItem('gib_watermark') || '{}'); } catch { return {}; }
  });
  const [watermarkSaved, setWatermarkSaved] = useState(false);

  const [notifPermission, setNotifPermission] = useState<string>(() =>
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
  );

  const [emailTo, setEmailTo] = useState(localStorage.getItem('gib_email_to') || '');

  useEffect(() => {
    apiFetch('/api/app-settings/digest_email').then(r => r.ok ? r.json() : { value: null }).then(d => {
      if (d.value) { setEmailTo(d.value); localStorage.setItem('gib_email_to', d.value); }
    });
  }, []);

  const [schedules, setSchedules] = useState<ReportSchedule[]>([]);
  const [showAddSchedule, setShowAddSchedule] = useState(false);
  const [newSchedule, setNewSchedule] = useState({ type: 'global', customTopic: '', time: '08:00', days: '1,2,3,4,5' });

  const [socialAccounts, setSocialAccounts] = useState<SocialAccount[]>([]);
  const [substackForm, setSubstackForm] = useState({ subdomain: '', email: '', password: '' });
  const [substackLoading, setSubstackLoading] = useState(false);
  const [substackMsg, setSubstackMsg] = useState('');

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

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ time: '', days: '' });

  const startEditing = (s: ReportSchedule) => {
    setEditingId(s.id);
    setEditForm({ time: s.schedule_time, days: s.days });
  };

  const saveEdit = async () => {
    if (editingId === null) return;
    await apiFetch(`/api/scheduled-reports/${editingId}`, {
      method: 'PATCH',
      body: JSON.stringify({ schedule_time: editForm.time, days: editForm.days }),
    });
    setSchedules(prev => prev.map(s => s.id === editingId ? { ...s, schedule_time: editForm.time, days: editForm.days } : s));
    setEditingId(null);
  };

  const connectSubstack = async () => {
    if (!substackForm.subdomain) return setSubstackMsg("Enter your Substack subdomain.");
    setSubstackLoading(true);
    setSubstackMsg('');
    const res = await apiFetch('/api/social/substack/connect', { method: 'POST', body: JSON.stringify(substackForm) });
    const data = await res.json();
    if (res.ok) {
      setSubstackMsg(`Connected as ${data.handle}`);
      setSubstackForm({ subdomain: '', email: '', password: '' });
      setSocialAccounts(prev => [...prev.filter(a => a.platform !== 'substack'), { platform: 'substack', handle: data.handle }]);
    } else {
      setSubstackMsg(`Error: ${data.error}`);
    }
    setSubstackLoading(false);
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

  return (
    <div className="max-w-2xl mx-auto space-y-12">
      <BackButton />
      <h1 className="text-4xl font-serif italic border-b border-btc-orange/20 pb-6 text-white bitcoin-glow">System Settings</h1>

      <div className="space-y-10">
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

        <SettingsSection title="Email Digest">
          <div className="p-6 bg-[#0a0a0a] border border-btc-orange/30 space-y-4">
            <p className="text-xs text-gray-500">Automated reports are emailed to this address when generated by the scheduler. Requires SMTP_HOST, SMTP_USER, SMTP_PASS in your .env file.</p>
            <div className="space-y-1">
              <label className="text-[10px] font-mono uppercase tracking-widest text-btc-orange/40">Digest Recipient</label>
              <input
                type="email"
                value={emailTo}
                onChange={e => { setEmailTo(e.target.value); localStorage.setItem('gib_email_to', e.target.value); }}
                onBlur={e => {
                  if (e.target.value) apiFetch('/api/app-settings', { method: 'PUT', body: JSON.stringify({ key: 'digest_email', value: e.target.value }) });
                }}
                placeholder="you@example.com"
                className="w-full px-3 py-2 bg-black/40 border border-btc-orange/20 text-white font-mono text-xs focus:border-btc-orange outline-none transition-all"
              />
            </div>
            <p className="text-[10px] font-mono text-gray-600">Saved on blur. Email is sent automatically when scheduled reports complete.</p>
          </div>
        </SettingsSection>

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
                      {['global', 'crypto', 'equities', 'nasdaq', 'conspiracies', 'speculation', 'china', 'forecast', 'custom'].map(t => <option key={t} value={t}>{t}</option>)}
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
                  <div key={s.id} className="p-3 bg-black/20 border border-btc-orange/10 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-mono uppercase text-btc-orange">{s.report_type}</span>
                          {s.custom_topic && <span className="text-[9px] font-mono text-gray-500 truncate max-w-[120px]">{s.custom_topic}</span>}
                        </div>
                        {editingId !== s.id && (
                          <p className="text-[9px] font-mono text-gray-500">
                            {s.schedule_time} · {s.days.split(',').map(d => DAY_LABELS[Number(d)]).join(', ')}
                          </p>
                        )}
                        {s.last_run && <p className="text-[8px] font-mono text-gray-600">Last run: {new Date(s.last_run).toLocaleString()}</p>}
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => editingId === s.id ? setEditingId(null) : startEditing(s)} className="text-gray-500 hover:text-btc-orange transition-colors p-1">
                          {editingId === s.id ? <XIcon size={14} /> : <Pencil size={14} />}
                        </button>
                        <button onClick={() => toggleSchedule(s.id, s.enabled)} className="text-btc-orange hover:opacity-70 transition-opacity">
                          {s.enabled ? <ToggleRight size={20} /> : <ToggleLeft size={20} className="opacity-30" />}
                        </button>
                        <button onClick={() => deleteSchedule(s.id)} className="text-red-500 hover:text-red-400 transition-colors p-1">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>

                    {editingId === s.id && (
                      <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="space-y-3 pt-2 border-t border-btc-orange/10">
                        <div className="space-y-1">
                          <label className="text-[9px] font-mono uppercase tracking-widest opacity-40">Time (24h)</label>
                          <input type="time" value={editForm.time} onChange={e => setEditForm(f => ({ ...f, time: e.target.value }))}
                            className="w-full px-2 py-1.5 bg-black/60 border border-btc-orange/20 text-white font-mono text-xs outline-none focus:border-btc-orange" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[9px] font-mono uppercase tracking-widest opacity-40">Days</label>
                          <div className="flex gap-1">
                            {DAY_LABELS.map((day, idx) => {
                              const active = editForm.days.split(',').includes(String(idx));
                              return (
                                <button key={day} onClick={() => {
                                  const current = editForm.days.split(',').filter(Boolean);
                                  const next = active ? current.filter(d => d !== String(idx)) : [...current, String(idx)];
                                  setEditForm(f => ({ ...f, days: next.join(',') }));
                                }}
                                  className={cn("px-2 py-1 text-[9px] font-mono border transition-all", active ? "bg-btc-orange text-black border-btc-orange" : "border-btc-orange/20 text-gray-500 hover:border-btc-orange/40")}>
                                  {day}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                        <div className="flex gap-2 justify-end">
                          <button onClick={() => setEditingId(null)} className="px-3 py-1.5 text-[10px] font-mono uppercase border border-btc-orange/20 text-gray-500 hover:text-white transition-colors">Cancel</button>
                          <button onClick={saveEdit} className="px-3 py-1.5 text-[10px] font-mono uppercase bg-btc-orange text-black hover:opacity-90 transition-all">Save</button>
                        </div>
                      </motion.div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[10px] font-mono text-gray-600 text-center py-4">No schedules configured</p>
            )}
          </div>
        </SettingsSection>

        <SettingsSection title="Social Networks">
          <div className="p-6 bg-[#0a0a0a] border border-btc-orange/30 space-y-6">
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
              <p className="text-[9px] font-mono text-amber-400/70 -mt-2 ml-5">Warning: No Business/Creator account found. Connect a Business Instagram for posting.</p>
            )}

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

            <div className="border-t border-btc-orange/10 pt-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <BookOpen size={14} className="text-orange-400" />
                  <span className="text-xs font-mono font-bold text-white">Substack</span>
                  {socialAccounts.find(a => a.platform === 'substack') && (
                    <span className="text-[9px] font-mono text-emerald-400">● {socialAccounts.find(a => a.platform === 'substack')?.handle}</span>
                  )}
                </div>
                {socialAccounts.find(a => a.platform === 'substack') ? (
                  <button onClick={() => disconnectPlatform('substack')} className="text-[10px] font-mono uppercase text-red-500 hover:underline">Disconnect</button>
                ) : null}
              </div>
              {!socialAccounts.find(a => a.platform === 'substack') && (
                <div className="space-y-2">
                  <input type="text" value={substackForm.subdomain} onChange={e => setSubstackForm(f => ({ ...f, subdomain: e.target.value }))}
                    placeholder="your-publication.substack.com" className="w-full px-3 py-2 bg-black/40 border border-orange-500/20 text-white font-mono text-xs outline-none focus:border-orange-500/60 transition-all" />
                  <input type="email" value={substackForm.email} onChange={e => setSubstackForm(f => ({ ...f, email: e.target.value }))}
                    placeholder="Substack account email" className="w-full px-3 py-2 bg-black/40 border border-orange-500/20 text-white font-mono text-xs outline-none focus:border-orange-500/60 transition-all" />
                  <input type="password" value={substackForm.password} onChange={e => setSubstackForm(f => ({ ...f, password: e.target.value }))}
                    placeholder="Substack password" className="w-full px-3 py-2 bg-black/40 border border-orange-500/20 text-white font-mono text-xs outline-none focus:border-orange-500/60 transition-all" />
                  <button onClick={connectSubstack} disabled={substackLoading} className="flex items-center gap-2 px-4 py-2 bg-orange-600 text-white text-[10px] font-mono uppercase tracking-widest hover:bg-orange-500 transition-colors disabled:opacity-50">
                    {substackLoading ? <Loader2 size={12} className="animate-spin" /> : <BookOpen size={12} />} Connect Substack
                  </button>
                  {substackMsg && <p className="text-[10px] font-mono text-btc-orange">{substackMsg}</p>}
                </div>
              )}
            </div>
          </div>
        </SettingsSection>

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

        <SettingsSection title="System Debug">
          <div className="p-6 bg-[#0a0a0a] border border-btc-orange/30 space-y-3">
            {[
              { label: 'App URL', value: window.location.origin },
              { label: 'X Callback', value: `${window.location.origin}/auth/x/callback` },
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
