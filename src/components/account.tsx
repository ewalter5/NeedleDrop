'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ArrowRight, Mail, LockKeyhole, Disc3, Save } from 'lucide-react';
import { useApp } from './app';
import { api, Avatar, Notice } from './shared';
export function AuthPage() {
  const path = usePathname();
  const router = useRouter();
  const { data, refresh } = useApp();
  const signup = path === '/signup';
  const reset = path === '/forgot-password';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (window.location.search.includes('error=verification'))
      setError(
        'That verification link could not be used. Try signing in or request a new password reset.',
      );
  }, []);
  return (
    <div className="auth-wrap">
      <div className="auth-intro">
        <Disc3 size={36} />
        <span className="eyebrow">THERE’S ALWAYS ANOTHER GOOD SONG</span>
        <h1>{reset ? 'Let’s get you back in.' : signup ? 'Pull up a chair.' : 'Welcome back.'}</h1>
        <p>
          {reset
            ? 'We’ll email you a link to reset your password.'
            : signup
              ? 'A monthly musical mystery. A room full of good discoveries. All we need is you.'
              : 'Your next musical rabbit hole is waiting.'}
        </p>
      </div>
      <form
        className="card auth-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          setMessage('');
          try {
            if (data.demo)
              throw new Error('Connect Supabase and email services to enable accounts.');
            const response = await api<{ message?: string }>(
              `auth/${reset ? 'reset' : signup ? 'signup' : 'signin'}`,
              'POST',
              { email, password, displayName: name },
            );
            if (response.message) setMessage(response.message);
            else {
              await refresh();
              router.push('/');
            }
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2>
          {reset ? 'Reset password' : signup ? 'Create your account' : 'Sign in to Needle Drop'}
        </h2>
        {signup && (
          <label>
            Display name
            <input
              required
              maxLength={60}
              autoComplete="nickname"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="What should we call you?"
            />
          </label>
        )}
        <label>
          Email address
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </label>
        {!reset && (
          <label>
            Password
            <input
              type="password"
              minLength={signup ? 12 : 1}
              maxLength={128}
              autoComplete={signup ? 'new-password' : 'current-password'}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {signup && <small>At least 12 characters.</small>}
          </label>
        )}
        <Notice message={error} error />
        <Notice message={message} />
        <button className="button full" disabled={busy}>
          {busy
            ? 'One moment…'
            : reset
              ? 'Send reset link'
              : signup
                ? 'Join the listening room'
                : 'Sign in'}
          <ArrowRight size={16} />
        </button>
        {signup ? (
          <p className="fine-print">
            Your display name appears on posts and quiz results. Your email stays private. New
            accounts are enrolled in monthly quizzes and the weekly digest; change either in
            preferences.
          </p>
        ) : (
          !reset && (
            <Link className="text-link" href="/forgot-password">
              Forgot your password?
            </Link>
          )
        )}
        <div className="auth-switch">
          {signup ? 'Already part of the room?' : reset ? 'Remembered it?' : 'New to the room?'}{' '}
          <Link href={signup || reset ? '/login' : '/signup'}>
            {signup || reset ? 'Sign in' : 'Create an account'}
          </Link>
        </div>
      </form>
    </div>
  );
}
export function Account({ reset = false }: { reset?: boolean }) {
  const { data, refresh } = useApp();
  const p = data.profile!;
  const [name, setName] = useState(p.displayName);
  const [quiz, setQuiz] = useState(p.quizEnrolled);
  const [digest, setDigest] = useState(p.digestSubscribed);
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (data.demo) throw new Error('Account changes need connected services.');
      await fn();
      setMessage('Your changes are saved.');
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">MAKE YOURSELF AT HOME</span>
          <h1>
            {reset ? 'A fresh password' : 'Your corner'}
            <span className="orange">.</span>
          </h1>
          <p>A name for the room. The right amount of email.</p>
        </div>
      </div>
      <div className="settings-layout">
        {!reset && (
          <form
            className="card settings-card"
            onSubmit={(e) => {
              e.preventDefault();
              run(() =>
                api('profile', 'PATCH', {
                  displayName: name,
                  quizEnrolled: quiz,
                  digestSubscribed: digest,
                }),
              );
            }}
          >
            <div className="profile-heading">
              <Avatar name={name || 'You'} />
              <div>
                <h2>Your profile</h2>
                <p>Your email is never shown to other members.</p>
              </div>
            </div>
            <label>
              Display name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                minLength={1}
                maxLength={60}
                required
              />
            </label>
            <hr />
            <h3>
              <Mail size={18} />
              Email preferences
            </h3>
            <label className="toggle-row">
              <span>
                <strong>Monthly quizzes</strong>
                <small>
                  New quizzes, results, and 48-, 36-, and 24-hour deadline reminders until you
                  submit.
                </small>
              </span>
              <input type="checkbox" checked={quiz} onChange={(e) => setQuiz(e.target.checked)} />
            </label>
            <label className="toggle-row">
              <span>
                <strong>The weekly roundup</strong>
                <small>One email of community song discoveries. Separate from quiz emails.</small>
              </span>
              <input
                type="checkbox"
                checked={digest}
                onChange={(e) => setDigest(e.target.checked)}
              />
            </label>
            <button className="button" disabled={busy}>
              <Save size={16} />
              Save preferences
            </button>
          </form>
        )}
        <form
          className="card settings-card"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => api('auth/password', 'POST', { password }));
            setPassword('');
          }}
        >
          <LockKeyhole size={22} />
          <h2>{reset ? 'Reset your password' : 'Change your password'}</h2>
          <label>
            New password
            <input
              type="password"
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <small>Use at least 12 characters.</small>
          </label>
          <button className="button secondary" disabled={busy}>
            Update password
          </button>
        </form>
      </div>
      <Notice message={error} error />
      <Notice message={message} />
    </>
  );
}
export function UnsubscribePage() {
  const [info, setInfo] = useState<{ user: string; channel: string; token: string } | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const s = new URLSearchParams(window.location.search);
    setInfo({
      user: s.get('user') || '',
      channel: s.get('channel') || '',
      token: s.get('token') || '',
    });
  }, []);
  return (
    <div className="card unsubscribe">
      <Mail size={30} />
      <h1>{done ? 'You’re off the list.' : 'A little less email?'}</h1>
      <p>
        {done
          ? 'Your preference is saved. You can turn emails back on in your account settings.'
          : `Unsubscribe from ${info?.channel === 'digest' ? 'the weekly community digest' : 'monthly quizzes and quiz reminders'}. Your account and answers will stay.`}
      </p>
      <Notice error message={error} />
      {!done && (
        <button
          className="button"
          disabled={!info || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api('unsubscribe', 'POST', info);
              setDone(true);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Saving…' : 'Unsubscribe'}
        </button>
      )}
      <Link href="/account" className="text-link">
        Account preferences <ArrowRight size={15} />
      </Link>
    </div>
  );
}
