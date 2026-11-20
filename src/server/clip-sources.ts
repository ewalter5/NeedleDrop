import type { PoolClient } from 'pg';
import { query } from './db';

// Source information stays private to hosts. Match the current object, so old
// replaced imports do not make an unrelated clip look like a duplicate.
export async function currentYoutubeSources(quizId: string, client?: PoolClient) {
  return query(
    `SELECT c.id,c.position,j.payload FROM clips c JOIN jobs j
     ON j.kind='process_audio' AND j.payload->>'clipId'=c.id::text
     AND (c.storage_key=j.payload->>'originalKey'
       OR c.storage_key='clips/'||c.id::text||'/'||j.id::text||'.mp3')
     WHERE c.quiz_id=$1 AND j.payload ? 'youtubeUrl'`,
    [quizId],
    client,
  );
}
