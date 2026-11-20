import { test } from 'node:test';
import assert from 'node:assert/strict';
import { segmentSchema, youtubeUrl, spotifyPlaylistId } from '../src/lib/audio-source';
import { ffmpegArguments, youtubeArguments } from '../src/server/jobs';
import { playlistTracks } from '../src/server/sources';
import { audioStep, audioFailureMessage } from '../src/server/audio-errors';

test('yt-dlp discovers FFmpeg on PATH and receives an override only for actual paths', () => {
  const saved = process.env.FFMPEG_PATH;
  try {
    for (const value of [
      undefined,
      'ffmpeg',
      'ffmpeg.exe',
      'C:\\tools\\ffmpeg.exe',
      '/usr/bin/ffmpeg',
    ]) {
      if (value === undefined) delete process.env.FFMPEG_PATH;
      else process.env.FFMPEG_PATH = value;
      const args = youtubeArguments('https://youtu.be/dQw4w9WgXcQ', 'clip.%(ext)s', {
        start: 0,
        end: 20,
      });
      const index = args.indexOf('--ffmpeg-location');
      if (value && /[\\/]/.test(value)) assert.equal(args[index + 1], value);
      else assert.equal(index, -1);
    }
  } finally {
    if (saved === undefined) delete process.env.FFMPEG_PATH;
    else process.env.FFMPEG_PATH = saved;
  }
});

test('audio diagnostics identify failure stages without leaking tool output or credentials', async () => {
  const secret = 'private-token-and-song-name';
  const failures = [
    {
      step: 'YouTube download' as const,
      error: { code: 'ENOENT', message: secret },
      match: /yt-dlp was not found/,
    },
    {
      step: 'Audio inspection' as const,
      error: { code: 'ENOENT', message: secret },
      match: /ffprobe was not found/,
    },
    {
      step: 'Audio conversion' as const,
      error: { killed: true, stderr: secret },
      match: /timed out/,
    },
    {
      step: 'YouTube download' as const,
      error: { stderr: `WARNING: ffmpeg-location ffmpeg does not exist! ${secret}` },
      match: /FFmpeg was not found by yt-dlp/,
    },
    {
      step: 'YouTube download' as const,
      error: { stderr: `HTTP Error 403 ${secret}` },
      match: /YouTube blocked/,
    },
    {
      step: 'Audio storage' as const,
      error: { message: secret, stderr: secret },
      match: /Audio storage failed/,
    },
  ];
  for (const failure of failures) {
    await assert.rejects(
      audioStep(failure.step, async () => {
        throw failure.error;
      }),
      (error) => {
        const message = audioFailureMessage(error);
        assert.match(message, failure.match);
        assert.equal(message.includes(secret), false);
        return true;
      },
    );
  }
  assert.equal(audioFailureMessage(new Error(secret)).includes(secret), false);
});

test('only canonical YouTube video URLs can reach the downloader', () => {
  const expected = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  assert.equal(youtubeUrl('https://youtu.be/dQw4w9WgXcQ?t=30'), expected);
  assert.equal(youtubeUrl('https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=anything'), expected);
  assert.equal(youtubeUrl('https://youtube.com/shorts/dQw4w9WgXcQ'), expected);
  for (const value of [
    'http://youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ',
    'https://127.0.0.1/',
    'file:///etc/passwd',
    'https://youtube.com/playlist?list=x',
    'https://user:pass@youtube.com/watch?v=dQw4w9WgXcQ',
  ])
    assert.throws(() => youtubeUrl(value));
});
test('segments reject reversed, nonfinite, negative and excessive ranges', () => {
  assert.equal(segmentSchema.safeParse({ start: 90.5, end: 110.5 }).success, true);
  for (const range of [
    { start: -1, end: 20 },
    { start: 30, end: 15 },
    { start: 10, end: 10 },
    { start: 0, end: 61 },
    { start: NaN, end: 20 },
    { start: 0, end: Infinity },
  ])
    assert.equal(segmentSchema.safeParse(range).success, false);
});
test('downloader requests one section and conversion trims accurately without source metadata', () => {
  const segment = { start: 83.5, end: 103.5 };
  const args = youtubeArguments('https://youtu.be/dQw4w9WgXcQ', 'clip.%(ext)s', segment);
  assert.equal(args[args.indexOf('--download-sections') + 1], '*83.5-103.5');
  assert.ok(args.includes('--no-playlist'));
  assert.ok(args.includes('--ignore-config'));
  assert.equal(args.at(-1), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  const conversion = ffmpegArguments('source', 'output.mp3', segment);
  assert.equal(conversion[conversion.indexOf('-ss') + 1], '83.5');
  assert.equal(conversion[conversion.indexOf('-t') + 1], '20');
  assert.ok(conversion.indexOf('-ss') > conversion.indexOf('-i'));
  assert.equal(conversion[conversion.indexOf('-map_metadata') + 1], '-1');
});
test('Spotify input only accepts playlist links on the expected origin', () => {
  const id = '37i9dQZF1DXcBWIGoYBM5M';
  assert.equal(spotifyPlaylistId(`https://open.spotify.com/playlist/${id}?si=abc`), id);
  assert.throws(() => spotifyPlaylistId(`https://evil.test/playlist/${id}`));
  assert.throws(() => spotifyPlaylistId(`https://open.spotify.com/track/${id}`));
});

test('playlist import refreshes server credentials, handles current item format and skips unavailable tracks', async () => {
  const originalFetch = globalThis.fetch;
  const saved = [
    process.env.SPOTIFY_CLIENT_ID,
    process.env.SPOTIFY_CLIENT_SECRET,
    process.env.SPOTIFY_REFRESH_TOKEN,
  ];
  process.env.SPOTIFY_CLIENT_ID = 'test-client';
  process.env.SPOTIFY_CLIENT_SECRET = 'test-secret';
  process.env.SPOTIFY_REFRESH_TOKEN = 'test-refresh';
  const calls: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/api/token')) {
      assert.equal(
        new URLSearchParams(init?.body as URLSearchParams).get('grant_type'),
        'refresh_token',
      );
      return Response.json({ access_token: 'server-only-token' });
    }
    assert.equal(
      (init?.headers as Record<string, string>).Authorization,
      'Bearer server-only-token',
    );
    return Response.json({
      items: [
        { item: null },
        { item: { type: 'episode', name: 'Podcast' } },
        { is_local: true, item: { type: 'track', name: 'Local' } },
        { item: { type: 'track', id: 'track-id', name: 'Song', artists: [{ name: 'Artist' }] } },
      ],
      next: null,
    });
  };
  try {
    const result = await playlistTracks('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M');
    assert.deepEqual(result.tracks, [
      { title: 'Song', artist: 'Artist', url: 'https://open.spotify.com/track/track-id' },
    ]);
    assert.equal(result.truncated, false);
    assert.equal(calls.length, 2);
    assert.ok(calls[1].includes('/items?'));
    assert.equal(JSON.stringify(result).includes('server-only-token'), false);
    globalThis.fetch = async (input) =>
      String(input).endsWith('/api/token')
        ? Response.json({ access_token: 'token' })
        : new Response('', { status: 403 });
    await assert.rejects(
      () => playlistTracks('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M'),
      /owner\/collaborator/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    ['SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET', 'SPOTIFY_REFRESH_TOKEN'].forEach((key, i) => {
      if (saved[i] === undefined) delete process.env[key];
      else process.env[key] = saved[i];
    });
  }
});
