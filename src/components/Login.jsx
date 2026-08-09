import React, { useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { Loader2, LogIn } from 'lucide-react';
import BrandLogo from '@/components/BrandLogo';

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(err?.message || 'Sign in failed. Check your email and password.');
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center text-center mb-8">
          <BrandLogo imgClassName="h-11" />
          <p className="text-muted-foreground mt-4 text-sm">Sign in to your account</p>
        </div>
        <form onSubmit={onSubmit} className="bg-card border border-border rounded-2xl shadow-sm p-6 space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="email" className="text-sm font-medium text-foreground">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full h-11 px-3 bg-background border border-input rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-ring"
              placeholder="you@company.com"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="password" className="text-sm font-medium text-foreground">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full h-11 px-3 bg-background border border-input rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-ring"
              placeholder="••••••••"
            />
          </div>
          {error && (
            <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2" role="alert">
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="w-full h-11 inline-flex items-center justify-center gap-2 bg-primary hover:opacity-90 disabled:opacity-60 text-primary-foreground font-semibold rounded-lg transition-opacity"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
