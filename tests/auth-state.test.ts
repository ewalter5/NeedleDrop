import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sessionState } from '../src/server/auth-state';

test('missing sessions and unverified emails remain separate from verified users', () => {
  assert.equal(sessionState(null, null), 'signed-out');
  assert.equal(sessionState(null, { name: 'AuthSessionMissingError' }), 'signed-out');
  assert.equal(sessionState(null, { status: 401 }), 'signed-out');
  assert.equal(sessionState({}, null), 'unverified');
  assert.equal(sessionState({ email_confirmed_at: '2026-11-20T12:00:00Z' }, null), 'signed-in');
});
test('authentication service failures never masquerade as unverified accounts or authorize a user', () => {
  for (const failure of [
    { status: 503 },
    { status: 429 },
    { name: 'AuthRetryableFetchError' },
    new TypeError('network unavailable'),
  ])
    assert.equal(
      sessionState({ email_confirmed_at: '2026-11-20T12:00:00Z' }, failure),
      'unavailable',
    );
  assert.equal(
    sessionState({ email_confirmed_at: '2026-11-20T12:00:00Z' }, { status: 401 }),
    'signed-out',
  );
});
