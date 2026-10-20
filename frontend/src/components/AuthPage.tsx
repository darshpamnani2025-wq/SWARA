import React, { useState } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

interface AuthPageProps {
  onLoginSuccess: (user: any) => void;
}

export default function AuthPage({ onLoginSuccess }: AuthPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [experienceLevel, setExperienceLevel] = useState('Intermediate');
  const [isSignUp, setIsSignUp] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isSignUp) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              experience_level: experienceLevel, // Passes experience level to metadata & database trigger
            },
          },
        });
        if (error) throw error;
        if (data.user) {
          onLoginSuccess(data.user);
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        if (data.user) {
          onLoginSuccess(data.user);
        }
      }
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 text-slate-100">
      <div className="w-full max-w-md space-y-8 rounded-xl border border-slate-800 bg-slate-900 p-8 shadow-2xl">
        <div className="text-center">
          <h2 className="text-3xl font-bold tracking-tight text-cyan-400">SWARA</h2>
          <p className="mt-2 text-sm text-slate-400">
            {isSignUp ? 'Create your vocal coaching account' : 'Sign in to your dashboard'}
          </p>
        </div>

        {error && (
          <div className="rounded-lg bg-red-950/50 border border-red-800 p-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <form className="mt-8 space-y-6" onSubmit={handleAuth}>
          <div>
            <label className="block text-xs font-medium uppercase tracking-wider text-slate-400">Email Address</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-slate-100 focus:border-cyan-500 focus:outline-none"
              placeholder="singer@example.com"
            />
          </div>

          <div>
            <label className="block text-xs font-medium uppercase tracking-wider text-slate-400">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-slate-100 focus:border-cyan-500 focus:outline-none"
              placeholder="••••••••"
            />
          </div>

          {/* Experience Level Selector (Shown only on Sign Up) */}
          {isSignUp && (
            <div>
              <label className="block text-xs font-medium uppercase tracking-wider text-slate-400">Experience Level</label>
              <select
                value={experienceLevel}
                onChange={(e) => setExperienceLevel(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-slate-100 focus:border-cyan-500 focus:outline-none cursor-pointer"
              >
                <option value="Beginner">Beginner</option>
                <option value="Intermediate">Intermediate</option>
                <option value="Advanced">Advanced</option>
              </select>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-cyan-500 focus:outline-none disabled:opacity-50 transition-colors"
          >
            {loading ? 'Processing...' : isSignUp ? 'Sign Up' : 'Sign In'}
          </button>
        </form>

        <div className="text-center text-sm">
          <button
            type="button"
            onClick={() => setIsSignUp(!isSignUp)}
            className="text-cyan-400 hover:underline"
          >
            {isSignUp ? 'Already have an account? Sign In' : "Don't have an account? Sign Up"}
          </button>
        </div>
      </div>
    </div>
  );
}