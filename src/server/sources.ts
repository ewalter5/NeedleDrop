import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import { HttpError } from './auth';
import { spotifyPlaylistId, youtubeUrl } from '@/lib/audio-source';
import { songDetails } from '@/lib/song-metadata';

const run = promisify(execFile);
export const sourceRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('spotify'), url: z.string().max(500) }),
  z.object({ kind: z.literal('search'), query: z.string().trim().min(1).max(250) }),
]);
async function spotifyToken() {
  const client = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!client || !secret)
    throw new HttpError(
      503,
      'Configure Spotify client credentials on the server to import playlists.',
    );
  const refresh = process.env.SPOTIFY_REFRESH_TOKEN;
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
    headers: {
      Authorization: `Basic ${Buffer.from(`${client}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(
      refresh
        ? { grant_type: 'refresh_token', refresh_token: refresh }
        : { grant_type: 'client_credentials' },
    ),
  });
  if (!response.ok)
    throw new HttpError(
      502,
      'Spotify authentication failed. Check the server credentials and refresh token.',
    );
  return (await response.json()).access_token as string;
}
export async function playlistTracks(value: string) {
  let id: string;
  try {
    id = spotifyPlaylistId(value);
  } catch {
    throw new HttpError(400, 'Paste a Spotify playlist link.');
  }
  const token = await spotifyToken();
  const tracks: { title: string; artist: string; url: string }[] = [];
  let more = false;
  // Bound API work and keep imports within the quiz's 30-clip limit.
  for (let offset = 0; offset < 300 && tracks.length < 30; offset += 50) {
    const response = await fetch(
      `https://api.spotify.com/v1/playlists/${id}/items?limit=50&offset=${offset}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok)
      throw new HttpError(
        response.status === 429 ? 429 : 502,
        response.status === 403 || response.status === 404
          ? 'Spotify cannot read this playlist. App access may require an authorized playlist owner/collaborator and a server refresh token.'
          : 'Spotify playlist import failed. Try again later.',
      );
    const page = await response.json();
    for (const entry of page.items || []) {
      const track = entry.item ?? entry.track;
      if (!track || track.type !== 'track' || entry.is_local || track.is_local) continue;
      if (tracks.length === 30) {
        more = true;
        break;
      }
      tracks.push({
        title: String(track.name).slice(0, 300),
        artist: (track.artists || [])
          .map((a: { name: string }) => a.name)
          .join(', ')
          .slice(0, 300),
        url: `https://open.spotify.com/track/${track.id}`,
      });
    }
    more = (more && tracks.length === 30) || !!page.next;
    if (!page.next) break;
  }
  return { tracks, truncated: more, url: `https://open.spotify.com/playlist/${id}` };
}
export async function searchYoutube(query: string) {
  try {
    const { stdout } = await run(
      process.env.YTDLP_PATH || 'yt-dlp',
      [
        '--ignore-config',
        '--no-plugin-dirs',
        '--no-cache-dir',
        '--no-playlist',
        '--skip-download',
        '--dump-single-json',
        '--js-runtimes',
        'node',
        '--socket-timeout',
        '15',
        '--retries',
        '1',
        '--',
        `ytsearch3:${query}`,
      ],
      { timeout: 60000, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
    );
    const data = JSON.parse(stdout);
    return {
      matches: (data.entries || [])
        .filter((e: { id?: string; is_live?: boolean }) => e.id && !e.is_live)
        .map((e: { id: string; title: string; channel?: string; duration?: number }) => ({
          url: youtubeUrl(`https://www.youtube.com/watch?v=${e.id}`),
          title: e.title,
          channel: e.channel || '',
          duration: e.duration,
          song: songDetails(e),
        })),
    };
  } catch {
    throw new HttpError(
      502,
      'YouTube search failed. Check yt-dlp installation or paste a video link directly.',
    );
  }
}
