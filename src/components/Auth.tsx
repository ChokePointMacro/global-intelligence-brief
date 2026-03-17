import { useState } from 'react';
import { LogOut, Mail, Lock, User } from 'lucide-react';

interface AuthProps {
  user: { id: number; email: string; name: string } | null;
  onLogin: (email: string, password: string) => Promise<void>;
  onSignup: (name: string, email: string, password: string) => Promise<void>;
  onLogout: () => Promise<void>;
}

export function Auth({ user, onLogin, onSignup, onLogout }: AuthProps) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState({ name: '', email: '', password: '', confirmPassword: '' });

  if (user) {
    return (
      <div className="flex items-center gap-4">
        <span className="text-sm text-gray-300">{user.name}</span>
        <button
          onClick={async () => {
            try {
              await onLogout();
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Logout failed');
            }
          }}
          className="flex items-center gap-2 px-3 py-2 bg-red-600 hover:bg-red-700 rounded text-white transition-colors"
        >
          <LogOut size={16} />
          Logout
        </button>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (mode === 'login') {
        if (!formData.email || !formData.password) {
          throw new Error('Please fill in all fields');
        }
        await onLogin(formData.email, formData.password);
      } else {
        if (!formData.name || !formData.email || !formData.password || !formData.confirmPassword) {
          throw new Error('Please fill in all fields');
        }
        if (formData.password !== formData.confirmPassword) {
          throw new Error('Passwords do not match');
        }
        if (formData.password.length < 6) {
          throw new Error('Password must be at least 6 characters');
        }
        await onSignup(formData.name, formData.email, formData.password);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-96 bg-black/80 border border-cyan-500/30 rounded-lg p-8 backdrop-blur-sm">
      <h2 className="text-2xl font-bold text-cyan-400 mb-6">
        {mode === 'login' ? 'Sign In' : 'Create Account'}
      </h2>

      <form onSubmit={handleSubmit} className="space-y-4">
        {mode === 'signup' && (
          <div>
            <label className="block text-sm text-gray-400 mb-2 flex items-center gap-2">
              <User size={16} />
              Full Name
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full bg-black/50 border border-cyan-500/30 rounded px-3 py-2 text-white placeholder-gray-600 focus:border-cyan-400 focus:outline-none"
              placeholder="Your name"
            />
          </div>
        )}

        <div>
          <label className="block text-sm text-gray-400 mb-2 flex items-center gap-2">
            <Mail size={16} />
            Email
          </label>
          <input
            type="email"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            className="w-full bg-black/50 border border-cyan-500/30 rounded px-3 py-2 text-white placeholder-gray-600 focus:border-cyan-400 focus:outline-none"
            placeholder="you@example.com"
          />
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-2 flex items-center gap-2">
            <Lock size={16} />
            Password
          </label>
          <input
            type="password"
            value={formData.password}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
            className="w-full bg-black/50 border border-cyan-500/30 rounded px-3 py-2 text-white placeholder-gray-600 focus:border-cyan-400 focus:outline-none"
            placeholder={mode === 'signup' ? 'Min 6 characters' : 'Your password'}
          />
        </div>

        {mode === 'signup' && (
          <div>
            <label className="block text-sm text-gray-400 mb-2 flex items-center gap-2">
              <Lock size={16} />
              Confirm Password
            </label>
            <input
              type="password"
              value={formData.confirmPassword}
              onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
              className="w-full bg-black/50 border border-cyan-500/30 rounded px-3 py-2 text-white placeholder-gray-600 focus:border-cyan-400 focus:outline-none"
              placeholder="Confirm password"
            />
          </div>
        )}

        {error && (
          <div className="bg-red-900/30 border border-red-500/50 rounded px-3 py-2 text-red-300 text-sm">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-cyan-600 hover:bg-cyan-700 disabled:bg-gray-600 text-white font-semibold py-2 rounded transition-colors"
        >
          {loading ? 'Please wait...' : mode === 'login' ? 'Sign In' : 'Create Account'}
        </button>
      </form>

      <div className="mt-4 text-center">
        <button
          onClick={() => {
            setMode(mode === 'login' ? 'signup' : 'login');
            setFormData({ name: '', email: '', password: '', confirmPassword: '' });
            setError('');
          }}
          className="text-sm text-cyan-400 hover:text-cyan-300 underline"
        >
          {mode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
        </button>
      </div>
    </div>
  );
}
