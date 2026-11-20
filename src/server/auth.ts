import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { query } from './db';
import type { Profile } from '@/lib/types';
import { sessionState } from './auth-state';

export const configured = () =>
  !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
    process.env.DATABASE_URL &&
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function authClient() {
  const jar = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => jar.getAll(),
        setAll: (values) =>
          values.forEach(({ name, value, options }) => jar.set(name, value, options)),
      },
    },
  );
}
export async function currentUser(): Promise<Profile | null> {
  if (!configured()) return null;
  const {
    data: { user },
    error,
  } = await (await authClient()).auth.getUser();
  const state = sessionState(user, error);
  if (state === 'unavailable')
    throw new HttpError(503, 'Sign-in could not be checked right now. Please try again shortly.');
  if (state === 'unverified')
    throw new HttpError(
      403,
      'Please verify your email using the confirmation link, then sign in again.',
    );
  if (state !== 'signed-in' || !user) return null;
  const name =
    String(user.user_metadata?.display_name || 'Music lover')
      .trim()
      .slice(0, 60) || 'Music lover';
  await query('INSERT INTO profiles(id,display_name) VALUES($1,$2) ON CONFLICT(id) DO NOTHING', [
    user.id,
    name,
  ]);
  const [p] = await query(
    'SELECT id,display_name AS "displayName",admin,restricted,quiz_enrolled AS "quizEnrolled",digest_subscribed AS "digestSubscribed" FROM profiles WHERE id=$1',
    [user.id],
  );
  return p as Profile;
}
export async function requireUser() {
  const p = await currentUser();
  if (!p)
    throw new HttpError(
      401,
      'Your sign-in session is missing or has expired. Please sign in again.',
    );
  if (p.restricted)
    throw new HttpError(403, 'This account has been restricted. Contact the quiz administrator.');
  return p;
}
export async function requireHost(p: Profile, quizId: string) {
  if (p.admin) return;
  if (
    !(await query('SELECT 1 FROM quiz_hosts WHERE quiz_id=$1 AND user_id=$2', [quizId, p.id]))
      .length
  )
    throw new HttpError(403, 'This quiz is not assigned to you.');
}
export async function rateLimit(key: string, maximum = 30, seconds = 60) {
  const [r] = await query(
    `INSERT INTO rate_limits(key,count,expires_at) VALUES($1,1,now()+$2*interval '1 second')
    ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.expires_at < now() THEN 1 ELSE rate_limits.count+1 END,
    expires_at=CASE WHEN rate_limits.expires_at < now() THEN now()+$2*interval '1 second' ELSE rate_limits.expires_at END RETURNING count`,
    [key, seconds],
  );
  if (r.count > maximum) throw new HttpError(429, 'Please wait a moment before trying again.');
}
