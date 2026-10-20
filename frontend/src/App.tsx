import React, { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import VocalCoachDashboard from './components/VocalCoachDashboard';
import AuthPage from './components/AuthPage';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check active session on mount
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950 text-cyan-400">
        Loading SWARA...
      </div>
    );
  }

  if (!user) {
    return <AuthPage onLoginSuccess={(loggedInUser) => setUser(loggedInUser)} />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="flex justify-between items-center bg-slate-900 px-6 py-2 border-b border-slate-800 text-xs text-slate-400">
        <span className="font-semibold text-cyan-400">SWARA</span>
        <div>
          <span>Logged in as: <strong className="text-slate-200">{user.email}</strong></span>
          <button
            onClick={() => supabase.auth.signOut()}
            className="ml-4 text-red-400 hover:underline font-medium"
          >
            Sign Out
          </button>
        </div>
      </div>
      <VocalCoachDashboard user={user} />
    </div>
  );
}