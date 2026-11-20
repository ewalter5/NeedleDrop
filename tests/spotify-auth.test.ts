import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

test(
  'Spotify setup validates state, saves the refresh token privately, and retains other settings',
  { timeout: 20000 },
  async () => {
    const require = createRequire(import.meta.url);
    const prefix = join(tmpdir(), 'needle-drop-oauth-test-');
    const dir = await mkdtemp(prefix);
    const envPath = join(dir, '.env.local');
    const fakeRefresh = 'private-test-refresh-token';
    await writeFile(
      envPath,
      'SPOTIFY_CLIENT_ID=test-client\nSPOTIFY_CLIENT_SECRET=test-client-secret\nAPP_URL=http://localhost:3000\nSPOTIFY_REFRESH_TOKEN=old-token\n',
    );
    const preload = join(dir, 'fake-token.cjs');
    await writeFile(
      preload,
      `globalThis.fetch = async (url, options) => {
    if (url !== 'https://accounts.spotify.com/api/token') throw new Error('Unexpected remote request');
    const body = new URLSearchParams(options.body);
    if (body.get('grant_type') !== 'authorization_code' || body.get('code') !== 'test-code' || body.get('redirect_uri') !== 'http://127.0.0.1:8888/callback') throw new Error('Invalid exchange');
    return Response.json({ refresh_token: '${fakeRefresh}', access_token: 'test-access-token' });
  };`,
    );
    const child = spawn(
      process.execPath,
      [
        '--require',
        preload,
        '--import',
        pathToFileURL(require.resolve('tsx/esm')).href,
        resolve('scripts/spotify-auth.ts'),
      ],
      {
        cwd: dir,
        env: {
          ...process.env,
          SPOTIFY_CLIENT_ID: 'test-client',
          SPOTIFY_CLIENT_SECRET: 'test-client-secret',
        },
        windowsHide: true,
      },
    );
    let stdout = '',
      stderr = '';
    const exited = new Promise<number | null>((resolve, reject) => {
      child.once('exit', resolve);
      child.once('error', reject);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    const authorization = new Promise<URL>((resolve, reject) => {
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
        const match = /https:\/\/accounts\.spotify\.com\/authorize\?[^\r\n]+/.exec(stdout);
        if (match) resolve(new URL(match[0]));
      });
      child.once('exit', () => reject(new Error('Setup exited before authorization was ready.')));
      child.once('error', reject);
    });
    try {
      const url = await authorization;
      assert.equal(
        url.searchParams.get('scope'),
        'playlist-read-private playlist-read-collaborative',
      );
      const invalid = await fetch('http://127.0.0.1:8888/callback?code=test-code&state=invalid');
      assert.equal(invalid.status, 400);
      await invalid.text();
      assert.equal((await readFile(envPath, 'utf8')).includes(fakeRefresh), false);
      const callback = new URL('http://127.0.0.1:8888/callback');
      callback.search = new URLSearchParams({
        code: 'test-code',
        state: url.searchParams.get('state')!,
      }).toString();
      const success = await fetch(callback);
      assert.equal(success.status, 200);
      assert.equal((await success.text()).includes(fakeRefresh), false);
      assert.equal(await exited, 0);
      const saved = await readFile(envPath, 'utf8');
      assert.ok(saved.includes(`SPOTIFY_REFRESH_TOKEN="${fakeRefresh}"`));
      assert.ok(saved.includes('APP_URL=http://localhost:3000'));
      assert.ok(saved.includes('SPOTIFY_CLIENT_SECRET=test-client-secret'));
      assert.equal((stdout + stderr).includes(fakeRefresh), false);
      assert.equal((stdout + stderr).includes('test-client-secret'), false);
    } finally {
      if (child.exitCode === null) {
        child.kill();
        await exited;
      }
      if (!resolve(dir).startsWith(resolve(prefix))) throw new Error('Unexpected test directory');
      await rm(dir, { recursive: true, force: true });
    }
  },
);
