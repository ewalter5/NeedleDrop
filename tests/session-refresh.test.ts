import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServerClient } from '@supabase/ssr';
import { sessionState } from '../src/server/auth-state';

const user = {
  id: '10000000-0000-4000-8000-000000000001',
  aud: 'authenticated',
  role: 'authenticated',
  email_confirmed_at: '2026-11-20T12:00:00Z',
  app_metadata: {},
  user_metadata: {},
  created_at: '2026-11-20T12:00:00Z',
};
function token(exp: number) {
  return [
    JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
    JSON.stringify({ sub: user.id, aud: 'authenticated', role: 'authenticated', exp }),
    'signature',
  ]
    .map((part) => Buffer.from(part).toString('base64url'))
    .join('.');
}
function expiredSession() {
  const cookies = new Map<string, string>([
    [
      'test-auth',
      JSON.stringify({
        access_token: token(Math.floor(Date.now() / 1000) - 600),
        refresh_token: 'old-refresh',
        expires_at: Math.floor(Date.now() / 1000) - 600,
        expires_in: 3600,
        token_type: 'bearer',
        user,
      }),
    ],
  ]);
  return cookies;
}

test('the server session check renews expired access tokens and writes rotated cookies', async () => {
  const cookies = expiredSession();
  const freshToken = token(Math.floor(Date.now() / 1000) + 3600);
  let refreshes = 0,
    verifications = 0;
  const client = createServerClient('https://session-test.supabase.co', 'public-test-key', {
    cookieEncoding: 'raw',
    cookieOptions: { name: 'test-auth' },
    cookies: {
      getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
      setAll: (values) => {
        for (const item of values) {
          if (item.options.maxAge === 0) cookies.delete(item.name);
          else cookies.set(item.name, item.value);
        }
      },
    },
    global: {
      fetch: async (input, init) => {
        const url = new URL(String(input));
        if (url.pathname === '/auth/v1/token') {
          refreshes++;
          assert.equal(url.searchParams.get('grant_type'), 'refresh_token');
          return Response.json({
            access_token: freshToken,
            refresh_token: 'rotated-refresh',
            expires_in: 3600,
            token_type: 'bearer',
            user,
          });
        }
        assert.equal(url.pathname, '/auth/v1/user');
        assert.equal(new Headers(init?.headers).get('Authorization'), `Bearer ${freshToken}`);
        verifications++;
        return Response.json(user);
      },
    },
  });
  try {
    const result = await client.auth.getUser();
    assert.equal(result.error, null);
    assert.equal(sessionState(result.data.user, result.error), 'signed-in');
    assert.equal(refreshes, 1);
    assert.equal(verifications, 1);
    assert.ok([...cookies.values()].some((value) => value.includes('rotated-refresh')));
    assert.equal(
      [...cookies.values()].some((value) => value.includes('old-refresh')),
      false,
    );
  } finally {
    await client.auth.stopAutoRefresh();
  }
});

test('a rejected refresh token leaves host access unauthenticated', async () => {
  const cookies = expiredSession();
  const client = createServerClient('https://session-test.supabase.co', 'public-test-key', {
    cookieEncoding: 'raw',
    cookieOptions: { name: 'test-auth' },
    cookies: {
      getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
      setAll: (values) => {
        for (const item of values) {
          if (item.options.maxAge === 0) cookies.delete(item.name);
          else cookies.set(item.name, item.value);
        }
      },
    },
    global: {
      fetch: async () =>
        Response.json(
          { code: 'refresh_token_not_found', message: 'Invalid refresh token' },
          { status: 400 },
        ),
    },
  });
  try {
    const result = await client.auth.getUser();
    assert.equal(result.data.user, null);
    assert.equal(sessionState(result.data.user, result.error), 'signed-out');
  } finally {
    await client.auth.stopAutoRefresh();
  }
});
