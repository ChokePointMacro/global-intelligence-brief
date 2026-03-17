import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { apiFetch } from './lib/api';
import { Layout } from './components/Layout';
import { Dashboard } from './components/Dashboard';
import { Profile } from './components/Profile';
import { Compose } from './components/Compose';
import { Schedule } from './components/Schedule';
import { Settings } from './components/Settings';
import type { UserData } from './types';

export default function App() {
  const [user, setUser] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);

  const checkAuth = async () => {
    try {
      const res = await apiFetch('/api/me');
      if (res.ok) {
        const data = await res.json();
        setUser(data.user || null);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await apiFetch('/api/logout', { method: 'POST' });
    window.localStorage.removeItem('debug_sid');
    setUser(null);
  };

  useEffect(() => {
    checkAuth();
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

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <Loader2 className="animate-spin text-btc-orange" size={32} />
      </div>
    );
  }

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
