'use client';
import { useState } from 'react';
import { api } from './api';
export default function Auth({ name, onSignedIn }: { name: string; onSignedIn: () => void }) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function submit(action: 'signin' | 'signup' | 'resend') {
    setBusy(true);
    setMessage('');
    try {
      const result = await api<{ message?: string }>('/api/auth', 'POST', {
        action,
        email,
        password: action === 'resend' ? undefined : password,
      });
      if (action === 'signin') onSignedIn();
      else setMessage(result.message || 'Check your email.');
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login">
      <section className="hero">
        <div className="brand">
          <span className="brand-mark">{name.charAt(0)}</span>
          {name}
        </div>
        <p className="eyebrow section-space">Built for F-1 students</p>
        <h1>
          Your documents.
          <br />
          Your dates.
          <br />A little more peace of mind.
        </h1>
        <p className="muted">
          Securely organize your documents, review important dates and get reminders through
          WhatsApp.
        </p>
        <div className="notice small">
          A document organizer and date tracker. For immigration decisions, speak with your DSO or a
          qualified immigration attorney.
        </div>
      </section>
      <section className="card">
        <h2>{mode === 'signup' ? 'Create your account' : 'Welcome back'}</h2>
        <p className="muted small">Your files are private. Verify your email before signing in.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit(mode);
          }}
        >
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            minLength={12}
            maxLength={128}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <p className="muted small">At least 12 characters.</p>
          <button className="primary" disabled={busy} type="submit">
            {busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in'}
          </button>
        </form>
        <div className="row section-space">
          <button onClick={() => setMode(mode === 'signup' ? 'signin' : 'signup')}>
            {mode === 'signup' ? 'Already have an account?' : 'Create an account'}
          </button>
          <button disabled={busy || !email} onClick={() => void submit('resend')}>
            Resend verification
          </button>
        </div>
        {message && (
          <p className="notice section-space" role="status">
            {message}
          </p>
        )}
      </section>
    </div>
  );
}
