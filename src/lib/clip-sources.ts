import { youtubeUrl } from './audio-source';
import { normalizeAnswer } from './domain';
import type { SongDetails } from './song-metadata';

type SourceClip = { id: string; position: number; sourceUrl?: string | null };
type AnswerField = { clipId: string | null; kind: string; answer: string };

export function findExistingSong<T extends SourceClip>(
  clips: T[],
  fields: AnswerField[],
  url: string,
  song: SongDetails,
): T | undefined {
  const canonical = (value: string) => {
    try {
      return youtubeUrl(value);
    } catch {
      return '';
    }
  };
  const source = canonical(url);
  const title = normalizeAnswer(song.title);
  const artist = normalizeAnswer(song.artist);
  return clips.find((clip) => {
    if (source && canonical(clip.sourceUrl || '') === source) return true;
    if (!title || !artist) return false;
    const answers = fields.filter((field) => field.clipId === clip.id);
    return (
      answers.some((f) => f.kind === 'title' && normalizeAnswer(f.answer) === title) &&
      answers.some((f) => f.kind === 'artist' && normalizeAnswer(f.answer) === artist)
    );
  });
}
