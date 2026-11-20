import nextEnv from '@next/env';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

nextEnv.loadEnvConfig(process.cwd());
const clientId = process.env.SPOTIFY_CLIENT_ID;
const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
const redirectUri = 'http://127.0.0.1:8888/callback';

async function authorize() {
  if (!clientId || !clientSecret)
    throw new Error('Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in .env.local first.');
  const state = randomBytes(32).toString('hex');
  const authorization = new URL('https://accounts.spotify.com/authorize');
  authorization.search = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    state,
    scope: 'playlist-read-private playlist-read-collaborative',
    show_dialog: 'true',
  }).toString();
  let complete!: () => void;
  let fail!: (error: Error) => void;
  const completed = new Promise<void>((resolve, reject) => {
    complete = resolve;
    fail = reject;
  });
  // Attach a handler immediately, including while the server is starting.
  void completed.catch(() => {});
  let exchanging = false;
  const server = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    const url = new URL(request.url || '/', redirectUri);
    if (request.method !== 'GET' || url.pathname !== '/callback') {
      response.writeHead(404).end('Not found.');
      return;
    }
    if (url.searchParams.get('state') !== state) {
      response
        .writeHead(400)
        .end('Invalid authorization state. Use the URL printed in your terminal.');
      return;
    }
    if (exchanging) {
      response.writeHead(409).end('Authorization is already being completed.');
      return;
    }
    exchanging = true;
    try {
      const code = url.searchParams.get('code');
      if (!code || url.searchParams.has('error'))
        throw new Error('Spotify authorization was declined. Run the command again when ready.');
      const result = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        signal: AbortSignal.timeout(15000),
        headers: {
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
        }),
      });
      if (!result.ok)
        throw new Error(
          'Spotify token exchange failed. Check your client credentials and the exact redirect URI.',
        );
      const token = (await result.json()).refresh_token;
      if (typeof token !== 'string' || !token || /[\r\n]/.test(token))
        throw new Error(
          'Spotify did not return a refresh token. Run the authorization command again.',
        );
      const path = resolve('.env.local');
      // Read at save time to retain any other settings edited during authorization.
      let contents = await readFile(path, 'utf8');
      const newline = contents.includes('\r\n') ? '\r\n' : '\n';
      const line = `SPOTIFY_REFRESH_TOKEN=${JSON.stringify(token).replace(/\$/g, '\\$')}`;
      const pattern = /^[ \t]*SPOTIFY_REFRESH_TOKEN[ \t]*=.*$/m;
      contents = pattern.test(contents)
        ? contents.replace(pattern, () => line)
        : `${contents}${contents.endsWith('\n') ? '' : newline}${line}${newline}`;
      await writeFile(path, contents, { mode: 0o600 });
      response.end(
        'Spotify connected. Close this tab, return to PowerShell, and restart the website.',
      );
      complete();
    } catch (error) {
      response
        .writeHead(400)
        .end('Setup could not be completed. See your terminal for instructions.');
      // Return only controlled messages; never print the token response or callback URL.
      fail(
        new Error(
          error instanceof Error && error.message.startsWith('Spotify')
            ? error.message
            : 'Could not finish setup. Check the network and that .env.local is writable.',
        ),
      );
    }
  });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(8888, '127.0.0.1', resolve);
    });
    console.log(`Register this exact Spotify redirect URI: ${redirectUri}`);
    console.log(
      'Open this URL in your browser and authorize the account that owns/collaborates on your playlists:',
    );
    console.log(authorization.toString());
    timeout = setTimeout(
      () => fail(new Error('Spotify setup timed out. Run the command again.')),
      5 * 60000,
    );
    await completed;
    console.log(
      'Spotify refresh token saved privately to .env.local. Restart pnpm dev, then use Read playlist.',
    );
  } finally {
    if (timeout) clearTimeout(timeout);
    server.close();
    server.closeIdleConnections();
  }
}

try {
  await authorize();
} catch (error) {
  console.error(
    (error instanceof Error && error.message.startsWith('Spotify')) ||
      (error instanceof Error && error.message.startsWith('Set SPOTIFY')) ||
      (error instanceof Error && error.message.startsWith('Could not finish'))
      ? (error as Error).message
      : 'Spotify setup could not start. Check that port 8888 is available and try again.',
  );
  process.exitCode = 1;
}
