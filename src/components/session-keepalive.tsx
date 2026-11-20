'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError, Notice } from './shared';

export function SessionKeepalive({ userId }: { userId?: string }) {
  const [message, setMessage] = useState('');
  const [needsSignIn, setNeedsSignIn] = useState(false);
  useEffect(() => {
    if (!userId) return;
    let stopped = false;
    let checking = false;
    async function check() {
      if (stopped || checking || document.visibilityState === 'hidden') return;
      checking = true;
      try {
        // The server verifies the user and persists any refreshed Supabase cookies.
        // Never authorize a host action using the browser's cached profile.
        const session = await api<{ userId: string }>('session');
        if (stopped) return;
        setNeedsSignIn(false);
        setMessage(
          session.userId === userId
            ? ''
            : 'The signed-in account changed. Save your work separately and refresh before continuing.',
        );
      } catch (error) {
        if (stopped) return;
        const expired = error instanceof ApiError && error.status === 401;
        setNeedsSignIn(expired);
        setMessage(
          expired
            ? 'Your sign-in session has ended. Sign in again in another tab, then retry here. Your current form is still open.'
            : 'Your sign-in connection could not be checked. We will retry automatically.',
        );
      } finally {
        checking = false;
      }
    }
    const timer = window.setInterval(() => {
      void check();
    }, 60000);
    const resume = () => {
      void check();
    };
    window.addEventListener('focus', resume);
    window.addEventListener('online', resume);
    document.addEventListener('visibilitychange', resume);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', resume);
      window.removeEventListener('online', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [userId]);
  if (!userId || !message) return null;
  return (
    <div>
      <Notice error message={message} />
      {needsSignIn && (
        <p>
          <Link href="/login" target="_blank" rel="noopener noreferrer">
            Sign in again
          </Link>
        </p>
      )}
    </div>
  );
}
