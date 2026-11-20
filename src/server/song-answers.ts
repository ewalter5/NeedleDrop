import type { PoolClient } from 'pg';
import type { SongDetails } from '@/lib/song-metadata';
import { query } from './db';

export async function fillSongAnswers(clipId: string, song: SongDetails, client?: PoolClient) {
  for (const kind of ['title', 'artist'] as const) {
    const answer = song[kind].trim().slice(0, 2000);
    if (!answer) continue;
    await query(
      `UPDATE answer_keys k SET answer=$2 FROM answer_fields f
       WHERE k.field_id=f.id AND f.clip_id=$1 AND f.kind=$3 AND btrim(k.answer)=''`,
      [clipId, answer, kind],
      client,
    );
  }
}
