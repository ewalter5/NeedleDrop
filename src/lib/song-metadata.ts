export type SongDetails = { title: string; artist: string };

function text(value: unknown): string {
  return typeof value === 'string' && value.trim() !== 'NA' ? value.trim().slice(0, 2000) : '';
}
function songTitle(value: string): string {
  return value
    .replace(/\s*[\[(]([^\])]+)[\])]/g, (whole, content: string) =>
      /^(?:(?:official|music|lyrics?|video|audio|hd|hq|4k|visuali[sz]er)[\s|,-]*)+$/i.test(
        content.trim(),
      )
        ? ''
        : whole,
    )
    .replace(/\s+/g, ' ')
    .trim();
}

// Music metadata is preferred. Title parsing is a best-effort suggestion for hosts
// to review; ordinary uploader channels are not assumed to be recording artists.
export function songDetails(value: unknown): SongDetails {
  const info = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const track = text(info.track);
  const videoTitle = songTitle(text(info.title));
  const artists = Array.isArray(info.artists)
    ? info.artists.map(text).filter(Boolean).join(', ')
    : '';
  const artist = text(info.artist) || artists || text(info.creator);
  const pair = /^(.+?)\s+[-–—]\s+(.+)$/.exec(videoTitle);
  const channel = text(info.channel) || text(info.uploader);
  const topicArtist = /\s+-\s+Topic$/i.test(channel) ? channel.replace(/\s+-\s+Topic$/i, '') : '';
  return {
    title: track
      ? songTitle(track)
      : songTitle(pair?.[2] || videoTitle)
          .replace(/\s+(?:ft\.?|feat\.?|featuring)\s+.+$/i, '')
          .trim(),
    artist: artist || pair?.[1]?.trim() || topicArtist,
  };
}

export function downloadedSongDetails(stdout: string): SongDetails {
  for (const line of stdout.trim().split(/\r?\n/).reverse()) {
    try {
      return songDetails(JSON.parse(line));
    } catch {
      /* Ignore non-JSON progress lines. */
    }
  }
  return { title: '', artist: '' };
}
