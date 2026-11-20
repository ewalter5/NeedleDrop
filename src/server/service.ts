import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { query, transaction, lockQuiz } from './db';
import { HttpError, requireHost } from './auth';
import {
  effectiveState,
  canRelease,
  defaultSchedule,
  suggestGrade,
  audioExpired,
} from '@/lib/domain';
import type { Bootstrap, Profile, Quiz, Field, Clip, Post, Submission, Result } from '@/lib/types';
import { quizSchema, submissionSchema, gradeSchema, postSchema } from './validation';
import { storage } from './storage';
import { segmentSchema, youtubeUrl } from '@/lib/audio-source';

const quizSelect = `SELECT q.id,q.title,q.description,q.rules,q.release_at AS "releaseAt",q.deadline,q.timezone,q.state,q.released_at AS "releasedAt",p.display_name AS "hostName",
 (SELECT count(*)::int FROM clips WHERE quiz_id=q.id) AS "clipCount",COALESCE((SELECT sum(max_points)::float FROM answer_fields WHERE quiz_id=q.id),0) AS "maxPoints"
 FROM quizzes q JOIN profiles p ON p.id=q.created_by`;
function mapQuiz(row: Record<string, unknown>): Quiz {
  const q = {
    ...row,
    releaseAt: new Date(row.releaseAt as string).toISOString(),
    deadline: new Date(row.deadline as string).toISOString(),
    releasedAt: row.releasedAt ? new Date(row.releasedAt as string).toISOString() : null,
  } as Quiz;
  q.state = effectiveState(q);
  return q;
}
export async function getQuiz(id: string, client?: PoolClient) {
  const [row] = await query(quizSelect + ' WHERE q.id=$1', [id], client);
  if (!row) throw new HttpError(404, 'Quiz not found.');
  return mapQuiz(row);
}
export async function fieldsFor(id: string, client?: PoolClient): Promise<Field[]> {
  return (await query(
    'SELECT id,clip_id AS "clipId",label,kind,max_points::float AS "maxPoints",position FROM answer_fields WHERE quiz_id=$1 ORDER BY position,id',
    [id],
    client,
  )) as Field[];
}
async function clipsFor(id: string): Promise<Clip[]> {
  return (await query(
    `SELECT id,position,(audio_status='ready') AS ready FROM clips WHERE quiz_id=$1 ORDER BY position`,
    [id],
  )) as Clip[];
}
export async function postsFor(): Promise<Post[]> {
  const rows =
    await query(`SELECT p.id,p.author_id AS "authorId",u.display_name AS author,p.body,p.url,p.created_at AS "createdAt",p.parent_id AS "parentId" FROM posts p JOIN profiles u ON u.id=p.author_id
    WHERE p.parent_id IS NULL AND NOT u.restricted ORDER BY p.created_at DESC LIMIT 50`);
  if (!rows.length) return [];
  const replies = await query(
    `SELECT p.id,p.author_id AS "authorId",u.display_name AS author,p.body,p.url,p.created_at AS "createdAt",p.parent_id AS "parentId" FROM posts p JOIN profiles u ON u.id=p.author_id WHERE p.parent_id=ANY($1::uuid[]) AND NOT u.restricted ORDER BY p.created_at`,
    [rows.map((p) => p.id)],
  );
  return rows.map((p) => ({ ...p, replies: replies.filter((r) => r.parentId === p.id) })) as Post[];
}
export async function bootstrap(profile: Profile | null): Promise<Bootstrap> {
  const [settings] = await query(
    'SELECT digest_day AS "digestDay",digest_hour AS "digestHour",timezone FROM settings',
  );
  if (!profile || profile.restricted)
    return {
      demo: false,
      configured: true,
      profile,
      quizzes: [],
      posts: [],
      canHost: false,
      settings: settings as Bootstrap['settings'],
    };
  const quizzes = (
    await query(
      quizSelect +
        ` WHERE q.state <> 'draft' OR $1 OR EXISTS(SELECT 1 FROM quiz_hosts h WHERE h.quiz_id=q.id AND h.user_id=$2) ORDER BY q.release_at DESC`,
      [profile.admin, profile.id],
    )
  ).map(mapQuiz);
  const canHost =
    profile.admin ||
    !!(await query('SELECT 1 FROM quiz_hosts WHERE user_id=$1 LIMIT 1', [profile.id])).length;
  const managedQuizIds = (
    await query('SELECT quiz_id FROM quiz_hosts WHERE user_id=$1', [profile.id])
  ).map((r) => r.quiz_id as string);
  return {
    demo: false,
    configured: true,
    profile,
    quizzes,
    posts: await postsFor(),
    canHost,
    managedQuizIds,
    settings: settings as Bootstrap['settings'],
  };
}
function mapSubmission(s: Record<string, unknown>): Submission & { version: number } {
  return {
    ...s,
    submittedAt: s.submittedAt ? new Date(s.submittedAt as string).toISOString() : null,
    grades: s.grades || {},
  } as Submission & { version: number };
}
export async function playerQuiz(id: string, p: Profile) {
  const q = await getQuiz(id);
  if (q.state === 'draft' || q.state === 'scheduled')
    throw new HttpError(403, 'This quiz has not opened yet.');
  const [s] = await query(
    'SELECT id,user_id AS "userId",answers,submitted_at AS "submittedAt",reviewed,version FROM submissions WHERE quiz_id=$1 AND user_id=$2',
    [id, p.id],
  );
  return {
    quiz: { ...q, fields: await fieldsFor(id), clips: await clipsFor(id) },
    submission: s ? mapSubmission(s) : null,
  };
}
export async function saveSubmission(id: string, p: Profile, input: unknown) {
  const data = submissionSchema.parse(input);
  return transaction(async (c) => {
    await lockQuiz(id, c);
    const q = await getQuiz(id, c);
    if (q.state !== 'open')
      throw new HttpError(409, 'Submissions are closed. Your last saved answers are preserved.');
    const fields = await fieldsFor(id, c);
    if (Object.keys(data.answers).some((id) => !fields.some((f) => f.id === id)))
      throw new HttpError(400, 'Unknown answer field.');
    const [old] = await query(
      'SELECT * FROM submissions WHERE quiz_id=$1 AND user_id=$2 FOR UPDATE',
      [id, p.id],
      c,
    );
    if ((old?.version ?? 0) !== data.version)
      throw new HttpError(409, 'Answers changed in another tab. Reload before saving again.');
    const [saved] = await query(
      `INSERT INTO submissions(quiz_id,user_id,answers,submitted_at,version) VALUES($1,$2,$3,CASE WHEN $4 THEN now() ELSE NULL END,1)
      ON CONFLICT(quiz_id,user_id) DO UPDATE SET answers=$3,submitted_at=CASE WHEN $4 THEN now() ELSE submissions.submitted_at END,reviewed=false,reviewed_by=NULL,version=submissions.version+1,updated_at=now()
      RETURNING id,user_id AS "userId",answers,submitted_at AS "submittedAt",reviewed,version`,
      [id, p.id, JSON.stringify(data.answers), data.submit],
      c,
    );
    return mapSubmission(saved);
  });
}
export async function createQuiz(p: Profile) {
  if (!p.admin)
    throw new HttpError(403, 'An administrator must create and assign a quiz to a guest host.');
  const dates = defaultSchedule();
  const [q] = await query(
    'INSERT INTO quizzes(title,release_at,deadline,created_by) VALUES($1,$2,$3,$4) RETURNING id',
    ['Untitled quiz', dates.releaseAt, dates.deadline, p.id],
  );
  return q;
}
export async function hostQuiz(id: string, p: Profile) {
  await requireHost(p, id);
  const q = await getQuiz(id);
  const fields = await query(
    `SELECT f.id,f.clip_id AS "clipId",f.label,f.kind,f.max_points::float AS "maxPoints",f.position,k.answer,k.alternatives FROM answer_fields f JOIN answer_keys k ON k.field_id=f.id WHERE f.quiz_id=$1 ORDER BY f.position`,
    [id],
  );
  const clips = await query(
    `SELECT id,position,(audio_status='ready') AS ready,audio_status AS "audioStatus" FROM clips WHERE quiz_id=$1 ORDER BY position`,
    [id],
  );
  const submissions = await query(
    `SELECT s.id,s.user_id AS "userId",p.display_name AS "displayName",s.answers,s.submitted_at AS "submittedAt",s.reviewed,s.version,
    COALESCE((SELECT jsonb_object_agg(field_id,jsonb_build_object('points',points,'feedback',feedback)) FROM grades WHERE submission_id=s.id),'{}') AS grades
    FROM submissions s JOIN profiles p ON p.id=s.user_id WHERE s.quiz_id=$1 AND s.submitted_at IS NOT NULL ORDER BY p.display_name`,
    [id],
  );
  const reviewed = submissions.map(mapSubmission).map((s) => ({
    ...s,
    suggestions: Object.fromEntries(
      fields.map((f) => [
        f.id,
        suggestGrade(
          s.answers[f.id] || '',
          [f.answer, ...f.alternatives],
          f.kind,
          Number(f.maxPoints),
        ),
      ]),
    ),
  }));
  const hosts = await query(
    'SELECT h.user_id AS id,p.display_name AS "displayName" FROM quiz_hosts h JOIN profiles p ON p.id=h.user_id WHERE quiz_id=$1',
    [id],
  );
  return { quiz: { ...q, fields, clips }, submissions: reviewed, hosts };
}
export async function saveQuiz(id: string, p: Profile, input: unknown) {
  await requireHost(p, id);
  const data = quizSchema.parse(input);
  return transaction(async (c) => {
    await lockQuiz(id, c);
    const q = await getQuiz(id, c);
    if (q.state !== 'draft')
      throw new HttpError(
        409,
        'Quiz structure locks once scheduled. Only its deadline can now change.',
      );
    const old = await query('SELECT * FROM clips WHERE quiz_id=$1', [id], c);
    // IDs are supplied by the editor; prevent adopting IDs owned by another quiz.
    const foreign = await query(
      'SELECT 1 FROM clips WHERE id=ANY($1::uuid[]) AND quiz_id<>$2 UNION ALL SELECT 1 FROM answer_fields WHERE id=ANY($3::uuid[]) AND quiz_id<>$2',
      [data.clips.map((c) => c.id), id, data.fields.map((f) => f.id)],
      c,
    );
    if (foreign.length) throw new HttpError(400, 'Invalid clip or field identifier.');
    await query(
      'UPDATE quizzes SET title=$2,description=$3,rules=$4,release_at=$5,deadline=$6,timezone=$7 WHERE id=$1',
      [id, data.title, data.description, data.rules, data.releaseAt, data.deadline, data.timezone],
      c,
    );
    await query('DELETE FROM answer_fields WHERE quiz_id=$1', [id], c);
    // Temporarily move positions to permit reordering under the unique constraint.
    await query('UPDATE clips SET position=position+1000 WHERE quiz_id=$1', [id], c);
    for (const clip of data.clips)
      await query(
        'INSERT INTO clips(id,quiz_id,position) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET position=$3',
        [clip.id, id, clip.position],
        c,
      );
    for (const clip of old.filter((o) => !data.clips.some((c) => c.id === o.id))) {
      if (clip.storage_key)
        await enqueue(
          'delete_audio',
          `delete:${clip.storage_key}`,
          { keys: [clip.storage_key] },
          c,
        );
      await query('DELETE FROM clips WHERE id=$1', [clip.id], c);
    }
    for (const f of data.fields) {
      await query(
        'INSERT INTO answer_fields(id,quiz_id,clip_id,label,kind,max_points,position) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [f.id, id, f.clipId, f.label, f.kind, f.maxPoints, f.position],
        c,
      );
      await query(
        'INSERT INTO answer_keys(field_id,answer,alternatives) VALUES($1,$2,$3)',
        [f.id, f.answer, JSON.stringify(f.alternatives)],
        c,
      );
    }
    return { ok: true };
  });
}
export async function publishQuiz(id: string, p: Profile) {
  await requireHost(p, id);
  return transaction(async (c) => {
    await lockQuiz(id, c);
    const q = await getQuiz(id, c);
    if (q.state !== 'draft') throw new HttpError(409, 'This quiz is already scheduled.');
    const clips = await query('SELECT * FROM clips WHERE quiz_id=$1', [id], c);
    const fields = await fieldsFor(id, c);
    const empty = await query(
      `SELECT 1 FROM answer_keys k JOIN answer_fields f ON f.id=k.field_id WHERE f.quiz_id=$1 AND trim(k.answer)=''`,
      [id],
      c,
    );
    if (
      !clips.length ||
      clips.some((c) => c.audio_status !== 'ready') ||
      !fields.length ||
      empty.length ||
      clips.some((c) => !fields.some((f) => f.clipId === c.id))
    )
      throw new HttpError(
        400,
        'Add processed audio, at least one question per clip, and an answer key for every field before publishing.',
      );
    if (new Date(q.deadline) <= new Date()) throw new HttpError(400, 'Choose a future deadline.');
    await query("UPDATE quizzes SET state='scheduled' WHERE id=$1", [id], c);
    return { ok: true };
  });
}
export async function updateDeadline(id: string, p: Profile, input: unknown) {
  await requireHost(p, id);
  const { deadline } = z.object({ deadline: z.iso.datetime({ offset: true }) }).parse(input);
  return transaction(async (c) => {
    await lockQuiz(id, c);
    const q = await getQuiz(id, c);
    if (
      !['scheduled', 'open'].includes(q.state) ||
      new Date(deadline) <= new Date() ||
      new Date(deadline) <= new Date(q.releaseAt)
    )
      throw new HttpError(409, 'Only upcoming and open quizzes can receive a future deadline.');
    await query('UPDATE quizzes SET deadline=$2 WHERE id=$1', [id, deadline], c);
    return { ok: true };
  });
}
export async function releaseIfReady(id: string, c: PoolClient, explicitEmpty = false) {
  const q = await getQuiz(id, c);
  if (q.state === 'released' || q.state === 'draft') return false;
  const rows = await query(
    'SELECT submitted_at AS "submittedAt",reviewed FROM submissions WHERE quiz_id=$1',
    [id],
    c,
  );
  if (
    canRelease(q.deadline, rows as { submittedAt: string | null; reviewed: boolean }[]) ||
    (explicitEmpty && !rows.some((s) => s.submittedAt) && new Date(q.deadline) <= new Date())
  ) {
    await query("UPDATE quizzes SET state='released',released_at=now() WHERE id=$1", [id], c);
    return true;
  }
  return false;
}
export async function gradeSubmission(
  id: string,
  submissionId: string,
  p: Profile,
  input: unknown,
) {
  await requireHost(p, id);
  const data = gradeSchema.parse(input);
  return transaction(async (c) => {
    await lockQuiz(id, c);
    const q = await getQuiz(id, c);
    if (!['grading', 'released'].includes(q.state))
      throw new HttpError(409, 'Grading starts after the deadline.');
    const [s] = await query(
      'SELECT * FROM submissions WHERE id=$1 AND quiz_id=$2 AND submitted_at IS NOT NULL FOR UPDATE',
      [submissionId, id],
      c,
    );
    if (!s) throw new HttpError(404, 'Submitted entry not found.');
    const fields = await fieldsFor(id, c);
    if (
      Object.keys(data.grades).length !== fields.length ||
      fields.some((f) => !data.grades[f.id] || data.grades[f.id].points > f.maxPoints)
    )
      throw new HttpError(400, 'Confirm a valid score for every field.');
    const previous = await query(
      'SELECT field_id,points,feedback FROM grades WHERE submission_id=$1',
      [s.id],
      c,
    );
    await query('DELETE FROM grades WHERE submission_id=$1', [s.id], c);
    for (const f of fields)
      await query(
        'INSERT INTO grades(submission_id,field_id,points,feedback) VALUES($1,$2,$3,$4)',
        [s.id, f.id, data.grades[f.id].points, data.grades[f.id].feedback],
        c,
      );
    await query(
      'INSERT INTO grade_audit(submission_id,actor_id,previous,replacement) VALUES($1,$2,$3,$4)',
      [s.id, p.id, JSON.stringify(previous), JSON.stringify(data.grades)],
      c,
    );
    await query('UPDATE submissions SET reviewed=true,reviewed_by=$2 WHERE id=$1', [s.id, p.id], c);
    return { ok: true, released: await releaseIfReady(id, c) };
  });
}
export async function closeEmpty(id: string, p: Profile) {
  if (!p.admin) throw new HttpError(403, 'Only an administrator can close an empty quiz.');
  return transaction(async (c) => {
    await lockQuiz(id, c);
    if (!(await releaseIfReady(id, c, true)))
      throw new HttpError(409, 'This quiz is not empty and closed, or has already released.');
    return { ok: true };
  });
}
export async function resultsFor(id: string): Promise<Result> {
  const quiz = await getQuiz(id);
  if (quiz.state !== 'released') throw new HttpError(403, 'Results have not been released yet.');
  const fields = await query(
    'SELECT f.id,f.clip_id AS "clipId",f.label,f.kind,f.max_points::float AS "maxPoints",f.position,k.answer FROM answer_fields f JOIN answer_keys k ON k.field_id=f.id WHERE f.quiz_id=$1 ORDER BY f.position',
    [id],
  );
  const submissions = await query(
    `SELECT s.id,s.user_id AS "userId",p.display_name AS "displayName",s.answers,s.submitted_at AS "submittedAt",s.reviewed,
    COALESCE((SELECT jsonb_object_agg(field_id,jsonb_build_object('points',points,'feedback',feedback)) FROM grades WHERE submission_id=s.id),'{}') AS grades
    FROM submissions s JOIN profiles p ON p.id=s.user_id WHERE s.quiz_id=$1 AND s.submitted_at IS NOT NULL`,
    [id],
  );
  return {
    quiz: { ...quiz, clips: await clipsFor(id) },
    fields: fields as Result['fields'],
    submissions: submissions.map(mapSubmission),
  };
}
export async function playback(clipId: string, p: Profile) {
  const [clip] = await query('SELECT * FROM clips WHERE id=$1', [clipId]);
  if (!clip) throw new HttpError(404, 'Clip not found.');
  const q = await getQuiz(clip.quiz_id);
  if (['draft', 'scheduled'].includes(q.state)) await requireHost(p, q.id);
  if (audioExpired(q.releasedAt) || clip.audio_status === 'deleted')
    throw new HttpError(
      410,
      'This quiz’s audio has been removed. Written results are still available.',
    );
  if (clip.audio_status !== 'ready') throw new HttpError(409, 'This clip is not ready yet.');
  return { url: await storage().playback(clip.storage_key) };
}
export async function enqueue(
  kind: string,
  key: string,
  payload: unknown,
  c?: PoolClient,
  dueAt?: Date,
) {
  await query(
    'INSERT INTO jobs(kind,dedupe_key,payload,due_at) VALUES($1,$2,$3,$4) ON CONFLICT(dedupe_key) DO NOTHING',
    [kind, key, JSON.stringify(payload), dueAt ?? new Date()],
    c,
  );
}
export async function uploadClip(clipId: string, p: Profile, file: File, selection?: unknown) {
  const segment = selection === undefined ? undefined : segmentSchema.parse(selection);
  const [clip] = await query('SELECT * FROM clips WHERE id=$1', [clipId]);
  if (!clip) throw new HttpError(404, 'Save the quiz before uploading clips.');
  await requireHost(p, clip.quiz_id);
  if (file.size === 0 || file.size > 25 * 1024 * 1024)
    throw new HttpError(400, 'Choose an audio file under 25 MB.');
  const key = `originals/${randomUUID()}`;
  // A durable cleanup record also covers a process crash between upload and DB commit.
  await enqueue(
    'delete_audio',
    `orphan:${key}`,
    { keys: [key] },
    undefined,
    new Date(Date.now() + 86400000),
  );
  await storage().upload(key, Buffer.from(await file.arrayBuffer()), 'application/octet-stream');
  try {
    return await transaction(async (c) => {
      await lockQuiz(clip.quiz_id, c);
      const q = await getQuiz(clip.quiz_id, c);
      if (q.state !== 'draft') throw new HttpError(409, 'Audio locks when a quiz is scheduled.');
      const [fresh] = await query('SELECT * FROM clips WHERE id=$1', [clipId], c);
      if (!fresh) throw new HttpError(409, 'This clip was removed.');
      if (fresh.storage_key)
        await enqueue(
          'delete_audio',
          `delete:${fresh.storage_key}`,
          { keys: [fresh.storage_key] },
          c,
        );
      await query(
        "UPDATE clips SET audio_status='processing',storage_key=$2 WHERE id=$1",
        [clipId, key],
        c,
      );
      await enqueue('process_audio', `process:${key}`, { clipId, originalKey: key, segment }, c);
      return { ok: true };
    });
  } catch (error) {
    await storage().remove([key]);
    throw error;
  }
}
export async function importYoutubeClip(clipId: string, p: Profile, input: unknown) {
  const data = z
    .object({ url: z.string().max(500), start: z.number(), end: z.number() })
    .parse(input);
  const segment = segmentSchema.parse(data);
  let url: string;
  try {
    url = youtubeUrl(data.url);
  } catch {
    throw new HttpError(400, 'Paste a valid YouTube video link.');
  }
  const [clip] = await query('SELECT * FROM clips WHERE id=$1', [clipId]);
  if (!clip) throw new HttpError(404, 'Save the quiz before importing clips.');
  await requireHost(p, clip.quiz_id);
  return transaction(async (c) => {
    await lockQuiz(clip.quiz_id, c);
    const q = await getQuiz(clip.quiz_id, c);
    if (q.state !== 'draft') throw new HttpError(409, 'Audio locks when a quiz is scheduled.');
    const [fresh] = await query('SELECT * FROM clips WHERE id=$1', [clipId], c);
    if (!fresh) throw new HttpError(409, 'This clip was removed.');
    if (fresh.storage_key)
      await enqueue(
        'delete_audio',
        `delete:${fresh.storage_key}`,
        { keys: [fresh.storage_key] },
        c,
      );
    const key = `originals/${randomUUID()}`;
    await query(
      "UPDATE clips SET audio_status='processing',storage_key=$2 WHERE id=$1",
      [clipId, key],
      c,
    );
    await enqueue(
      'process_audio',
      `process:${key}`,
      { clipId, originalKey: key, youtubeUrl: url, segment },
      c,
    );
    return { ok: true };
  });
}
export async function writePost(p: Profile, input: unknown, id?: string) {
  const data = postSchema.parse(input);
  if (id) {
    const [post] = await query(
      'UPDATE posts SET body=$2,url=$3,edited_at=now() WHERE id=$1 AND (author_id=$4 OR $5) RETURNING id',
      [id, data.body, data.url, p.id, p.admin],
    );
    if (!post) throw new HttpError(403, 'You can edit only your own posts.');
    return post;
  }
  if (data.parentId) {
    const [parent] = await query(
      'SELECT p.parent_id FROM posts p JOIN profiles u ON u.id=p.author_id WHERE p.id=$1 AND NOT u.restricted',
      [data.parentId],
    );
    if (!parent || parent.parent_id)
      throw new HttpError(400, 'Replies must belong directly to a post.');
  }
  const [post] = await query(
    'INSERT INTO posts(author_id,parent_id,body,url) VALUES($1,$2,$3,$4) RETURNING id',
    [p.id, data.parentId, data.body, data.url],
  );
  return post;
}
export async function deletePost(id: string, p: Profile) {
  const rows = await query('DELETE FROM posts WHERE id=$1 AND (author_id=$2 OR $3) RETURNING id', [
    id,
    p.id,
    p.admin,
  ]);
  if (!rows.length) throw new HttpError(403, 'You can delete only your own posts.');
  return { ok: true };
}
