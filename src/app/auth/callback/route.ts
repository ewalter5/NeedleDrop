import { NextRequest, NextResponse } from 'next/server';
import { authClient, configured } from '@/server/auth';
export async function GET(req: NextRequest) {
  const base = process.env.APP_URL || req.nextUrl.origin;
  if (!configured()) return NextResponse.redirect(new URL('/login', base));
  const auth = await authClient();
  const code = req.nextUrl.searchParams.get('code');
  const tokenHash = req.nextUrl.searchParams.get('token_hash');
  const type = req.nextUrl.searchParams.get('type');
  let error: unknown = new Error('Missing verification code');
  if (code) ({ error } = await auth.auth.exchangeCodeForSession(code));
  else if (tokenHash && ['email', 'recovery', 'signup'].includes(type || ''))
    ({ error } = await auth.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as 'email' | 'recovery' | 'signup',
    }));
  const next = req.nextUrl.searchParams.get('next');
  const target = type === 'recovery' || next === '/account/reset' ? '/account/reset' : '/';
  return NextResponse.redirect(new URL(error ? '/login?error=verification' : target, base));
}
