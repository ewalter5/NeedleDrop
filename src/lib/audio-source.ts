import { z } from 'zod';

export const segmentSchema = z
  .object({
    start: z.number().finite().min(0).max(43200),
    end: z.number().finite().positive().max(43260),
  })
  .refine(
    ({ start, end }) => end > start && end - start <= 60,
    'Choose a segment between 0 and 60 seconds long.',
  );
export type Segment = z.infer<typeof segmentSchema>;

export function youtubeUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port)
    throw new Error('Use an HTTPS YouTube video link.');
  let id: string | null = null;
  if (url.hostname === 'youtu.be') id = url.pathname.slice(1);
  else if (
    ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(url.hostname)
  ) {
    id =
      url.pathname === '/watch'
        ? url.searchParams.get('v')
        : /^\/(?:shorts|embed)\/([^/]+)$/.exec(url.pathname)?.[1] || null;
  }
  if (!id || !/^[\w-]{11}$/.test(id))
    throw new Error('Choose a single YouTube video, not a playlist.');
  return `https://www.youtube.com/watch?v=${id}`;
}

export function spotifyPlaylistId(value: string): string {
  const url = new URL(value);
  const id = /^\/(?:intl-[a-z]+\/)?playlist\/([a-zA-Z0-9]{22})\/?$/.exec(url.pathname)?.[1];
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'open.spotify.com' ||
    url.port ||
    url.username ||
    url.password ||
    !id
  )
    throw new Error('Paste an open.spotify.com playlist link.');
  return id;
}
