import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import type { Pool } from 'pg';
import type { Profile } from '../src/lib/types';
import * as service from '../src/server/service';
import { query } from '../src/server/db';
import { runJobs, scheduleJobs } from '../src/server/jobs';
import { fillSongAnswers } from '../src/server/song-answers';
const db = new PGlite();
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const dad: Profile = {
  id: id(1),
  displayName: 'Dad',
  admin: true,
  restricted: false,
  quizEnrolled: true,
  digestSubscribed: false,
};
const guest: Profile = { ...dad, id: id(2), displayName: 'Guest', admin: false };
const player: Profile = { ...dad, id: id(3), displayName: 'Player', admin: false };
const other: Profile = { ...player, id: id(4), displayName: 'Other' };
let quizId = '';
const clip = id(10),
  title = id(11),
  theme = id(12);
before(async () => {
  process.env.DATABASE_URL = 'test-only';
  process.env.APP_URL = 'https://example.test';
  process.env.RESEND_API_KEY = 'test';
  process.env.EMAIL_FROM = 'quiz@example.test';
  process.env.UNSUBSCRIBE_SECRET = 'x'.repeat(64);
  // The adapter runs the actual repository SQL against embedded Postgres.
  const adapter = {
    query: async (sql: string, args: unknown[] = []) => {
      const r = await db.query(sql, args);
      return { rows: r.rows, rowCount: r.affectedRows };
    },
    release() {},
  };
  (globalThis as unknown as { pool: Pool }).pool = {
    ...adapter,
    connect: async () => adapter,
    end: async () => {},
  } as unknown as Pool;
  await db.exec(
    'CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb);',
  );
  const migration = (await readFile('migrations/001_initial.sql', 'utf8')).replace(
    'CREATE EXTENSION IF NOT EXISTS pgcrypto;',
    '',
  );
  await db.exec(migration);
  for (const p of [dad, guest, player, other]) {
    await query('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())', [
      p.id,
      `${p.displayName.toLowerCase()}@example.test`,
    ]);
    await query(
      'INSERT INTO profiles(id,display_name,admin,digest_subscribed) VALUES($1,$2,$3,false)',
      [p.id, p.displayName, p.admin],
    );
  }
});
after(async () => {
  await db.close();
  delete (globalThis as unknown as { pool?: Pool }).pool;
});

test('a test worker leaves email jobs queued while email sending is disabled', async () => {
  const saved = process.env.WORKER_SEND_EMAILS;
  process.env.WORKER_SEND_EMAILS = 'false';
  try {
    await service.enqueue('email', 'disabled-email-test', { event: 'open', userId: player.id });
    await runJobs();
    const [job] = await query(
      "SELECT state,attempts FROM jobs WHERE dedupe_key='disabled-email-test'",
    );
    assert.equal(job.state, 'pending');
    assert.equal(job.attempts, 0);
    await query("DELETE FROM jobs WHERE dedupe_key='disabled-email-test'");
  } finally {
    if (saved === undefined) delete process.env.WORKER_SEND_EMAILS;
    else process.env.WORKER_SEND_EMAILS = saved;
  }
});

test('YouTube import enforces host access and queues a validated private excerpt', async () => {
  const created = await service.createQuiz(dad);
  const clipId = id(980);
  await query('INSERT INTO clips(id,quiz_id,position) VALUES($1,$2,1)', [clipId, created.id]);
  const input = { url: 'https://youtu.be/dQw4w9WgXcQ', start: 45, end: 65 };
  await assert.rejects(() => service.importYoutubeClip(clipId, player, input), /not assigned/);
  await assert.rejects(() => service.importYoutubeClip(clipId, dad, { ...input, end: 200 }));
  await service.importYoutubeClip(clipId, dad, input);
  const [clipRow] = await query('SELECT * FROM clips WHERE id=$1', [clipId]);
  assert.equal(clipRow.audio_status, 'processing');
  const [job] = await query(
    "SELECT * FROM jobs WHERE kind='process_audio' AND payload->>'clipId'=$1",
    [clipId],
  );
  assert.deepEqual(job.payload.segment, { start: 45, end: 65 });
  assert.equal(job.payload.youtubeUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(
    (
      await service.importYoutubeClip(clipId, dad, {
        ...input,
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=45',
      })
    ).duplicate,
    true,
  );
  assert.equal(
    (
      await query(
        "SELECT count(*)::int AS n FROM jobs WHERE kind='process_audio' AND payload->>'clipId'=$1",
        [clipId],
      )
    )[0].n,
    1,
  );
  assert.equal(
    (await service.hostQuiz(created.id, dad)).quiz.clips[0].sourceUrl,
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  );
  const duplicateId = id(979);
  await query('INSERT INTO clips(id,quiz_id,position) VALUES($1,$2,2)', [duplicateId, created.id]);
  await assert.rejects(
    () => service.importYoutubeClip(duplicateId, dad, input),
    /already used in Clip 1/,
  );
  await query("UPDATE clips SET audio_status='ready',storage_key=$2 WHERE id=$1", [
    clipId,
    `clips/${clipId}/${job.id}.mp3`,
  ]);
  assert.equal((await service.importYoutubeClip(clipId, dad, input)).duplicate, true);
  await service.importYoutubeClip(clipId, dad, { ...input, start: 46, end: 66 });
  assert.equal(
    (
      await query(
        "SELECT count(*)::int AS n FROM jobs WHERE kind='process_audio' AND payload->>'clipId'=$1",
        [clipId],
      )
    )[0].n,
    2,
  );
  // Keep subsequent scheduler tests offline.
  await query('DELETE FROM jobs');
  await query("UPDATE quizzes SET state='scheduled' WHERE id=$1", [created.id]);
  await assert.rejects(() => service.importYoutubeClip(clipId, dad, input), /locks/);
  await query('DELETE FROM quizzes WHERE id=$1', [created.id]);
});
test('full quiz lifecycle: host permissions, private drafts, versioned submissions, graded release, audited corrections', async () => {
  const { id: created } = await service.createQuiz(dad);
  quizId = created;
  await assert.rejects(() => service.createQuiz(guest), /administrator/);
  await assert.rejects(() => service.hostQuiz(quizId, guest), /not assigned/);
  await query('INSERT INTO quiz_hosts(quiz_id,user_id) VALUES($1,$2)', [quizId, guest.id]);
  const draft = {
    title: 'Test music quiz',
    description: 'A musical puzzle',
    rules: 'Listen by ear.',
    releaseAt: new Date(Date.now() - 3600000).toISOString(),
    deadline: new Date(Date.now() + 86400000).toISOString(),
    timezone: 'America/New_York',
    clips: [{ id: clip, position: 1 }],
    fields: [
      {
        id: title,
        clipId: clip,
        label: 'Title',
        kind: 'title',
        maxPoints: 1,
        position: 0,
        answer: 'Space Oddity',
        alternatives: ['Space oddity!'],
      },
      {
        id: theme,
        clipId: null,
        label: 'Theme',
        kind: 'theme',
        maxPoints: 4,
        position: 1,
        answer: 'Space',
        alternatives: [],
      },
    ],
  };
  await service.saveQuiz(quizId, guest, draft);
  assert.deepEqual(
    (await query('SELECT alternatives FROM answer_keys WHERE field_id=$1', [title]))[0]
      .alternatives,
    [],
  );
  await assert.rejects(() => service.playerQuiz(quizId, player), /not opened/);
  await assert.rejects(() => service.publishQuiz(quizId, guest), /processed audio/);
  await query("UPDATE clips SET audio_status='ready',storage_key='sanitized-object' WHERE id=$1", [
    clip,
  ]);
  await service.publishQuiz(quizId, guest);
  await assert.rejects(() => service.saveQuiz(quizId, guest, draft), /locks/);
  const playerView = await service.playerQuiz(quizId, player);
  const serialized = JSON.stringify(playerView);
  assert.ok(!serialized.includes('Space Oddity'));
  assert.ok(!serialized.includes('sanitized-object'));
  assert.ok(!serialized.includes('alternatives'));
  const saved = await service.saveSubmission(quizId, player, {
    answers: { [title]: 'space oddity!', [theme]: 'The night sky' },
    submit: true,
    version: 0,
  });
  assert.equal(saved.version, 1);
  assert.ok(saved.submittedAt);
  await assert.rejects(
    () => service.saveSubmission(quizId, player, { answers: {}, submit: false, version: 0 }),
    /another tab/,
  );
  const revised = await service.saveSubmission(quizId, player, {
    answers: { [title]: 'Space Oddity', [theme]: 'Space' },
    submit: false,
    version: 1,
  });
  assert.ok(revised.submittedAt);
  assert.equal(revised.version, 2);
  await service.saveSubmission(quizId, other, {
    answers: { [title]: 'Draft only' },
    submit: false,
    version: 0,
  });
  const otherView = await service.playerQuiz(quizId, other);
  assert.equal(otherView.submission?.answers[title], 'Draft only');
  assert.equal((await service.hostQuiz(quizId, guest)).submissions.length, 1);
  await assert.rejects(() => service.resultsFor(quizId), /not been released/);
  await assert.rejects(
    () =>
      service.gradeSubmission(quizId, saved.id, guest, {
        grades: { [title]: { points: 1, feedback: '' }, [theme]: { points: 4, feedback: '' } },
      }),
    /after the deadline/,
  );
  await query("UPDATE quizzes SET deadline=now()-interval '1 second' WHERE id=$1", [quizId]);
  await assert.rejects(
    () => service.saveSubmission(quizId, player, { answers: {}, submit: true, version: 2 }),
    /closed/,
  );
  await assert.rejects(
    () =>
      service.updateDeadline(quizId, guest, {
        deadline: new Date(Date.now() + 3600000).toISOString(),
      }),
    /Only upcoming/,
  );
  await assert.rejects(
    () => service.gradeSubmission(quizId, saved.id, other, { grades: {} }),
    /not assigned/,
  );
  await assert.rejects(
    () =>
      service.gradeSubmission(quizId, saved.id, guest, {
        grades: { [title]: { points: 2, feedback: '' }, [theme]: { points: 4, feedback: '' } },
      }),
    /valid score/,
  );
  const review = await service.hostQuiz(quizId, guest);
  assert.equal(review.submissions[0].suggestions[title].match, 'exact');
  assert.equal(review.submissions[0].suggestions[theme].match, 'manual');
  assert.equal((await service.getQuiz(quizId)).state, 'grading');
  const graded = await service.gradeSubmission(quizId, saved.id, guest, {
    grades: { [title]: { points: 1, feedback: '' }, [theme]: { points: 3, feedback: 'Almost' } },
  });
  assert.equal(graded.released, true);
  const result = await service.resultsFor(quizId);
  assert.equal(result.submissions.length, 1);
  assert.equal(result.fields[0].answer, 'Space Oddity');
  assert.ok(!JSON.stringify(result).includes('@example.test'));
  await service.gradeSubmission(quizId, saved.id, dad, {
    grades: { [title]: { points: 1, feedback: '' }, [theme]: { points: 4, feedback: 'Corrected' } },
  });
  assert.equal((await query('SELECT count(*)::int AS n FROM grade_audit'))[0].n, 2);
});

test('metadata fills blank song answers but preserves host corrections and other questions', async () => {
  const created = await service.createQuiz(dad);
  const clipId = id(981);
  await query('INSERT INTO clips(id,quiz_id,position) VALUES($1,$2,1)', [clipId, created.id]);
  const fields = [
    { id: id(982), kind: 'title', answer: '' },
    { id: id(983), kind: 'artist', answer: 'Host correction' },
    { id: id(984), kind: 'connection', answer: '' },
  ];
  for (const f of fields) {
    await query(
      'INSERT INTO answer_fields(id,quiz_id,clip_id,label,kind,max_points,position) VALUES($1,$2,$3,$4,$4,1,0)',
      [f.id, created.id, clipId, f.kind],
    );
    await query('INSERT INTO answer_keys(field_id,answer,alternatives) VALUES($1,$2,$3)', [
      f.id,
      f.answer,
      JSON.stringify(['Old alternative']),
    ]);
  }
  await fillSongAnswers(clipId, { title: 'Detected title', artist: 'Detected artist' });
  await fillSongAnswers(clipId, { title: 'Later metadata', artist: 'Later artist' });
  await query(
    'INSERT INTO submissions(quiz_id,user_id,answers,submitted_at) VALUES($1,$2,$3,now())',
    [created.id, player.id, JSON.stringify({ [id(982)]: 'Old alternative' })],
  );
  const host = await service.hostQuiz(created.id, dad);
  assert.equal(host.quiz.fields.find((f) => f.id === id(982))?.answer, 'Detected title');
  assert.equal(host.quiz.fields.find((f) => f.id === id(983))?.answer, 'Host correction');
  assert.equal(host.quiz.fields.find((f) => f.id === id(984))?.answer, '');
  assert.equal(JSON.stringify(host).includes('alternatives'), false);
  assert.equal(host.submissions[0].suggestions[id(982)].match, 'manual');
  await query('DELETE FROM quizzes WHERE id=$1', [created.id]);
});
test('community ownership and single-level replies are enforced', async () => {
  const post = await service.writePost(player, {
    body: 'A good listen',
    url: 'https://example.com/song',
    parentId: null,
  });
  await assert.rejects(
    () => service.writePost(other, { body: 'Taking over', url: '' }, post.id),
    /own posts/,
  );
  const reply = await service.writePost(other, { body: 'Love it', url: '', parentId: post.id });
  await assert.rejects(
    () => service.writePost(player, { body: 'Nested reply', url: '', parentId: reply.id }),
    /directly/,
  );
  await assert.rejects(() => service.deletePost(post.id, other), /own posts/);
  assert.equal((await service.postsFor())[0].replies.length, 1);
  await service.deletePost(post.id, dad);
  assert.equal((await service.postsFor()).length, 0);
});
test('direct browser database roles cannot read private app tables', async () => {
  const permission = await query(
    "SELECT has_table_privilege('authenticated','answer_keys','SELECT') AS allowed,has_table_privilege('anon','submissions','SELECT') AS anonymous",
  );
  assert.equal(permission[0].allowed, false);
  assert.equal(permission[0].anonymous, false);
});
test('scheduled reminders dedupe, recheck submission state, and respect opt-outs', async () => {
  // Keep other completed quizzes out of this email test without changing their archived records.
  await query('UPDATE profiles SET quiz_enrolled=false');
  await query('UPDATE profiles SET quiz_enrolled=true WHERE id=$1', [player.id]);
  const { id: q } = await service.createQuiz(dad);
  const now = new Date();
  await query("UPDATE quizzes SET state='open',release_at=$2,deadline=$3 WHERE id=$1", [
    q,
    new Date(now.getTime() - 86400000),
    new Date(now.getTime() + 48 * 3600000),
  ]);
  const tomorrow = (Number(formatDay(now)) + 1) % 7;
  await query('UPDATE settings SET digest_day=$1', [tomorrow]);
  await scheduleJobs(now);
  await scheduleJobs(now);
  const reminder = await query('SELECT * FROM jobs WHERE dedupe_key=$1', [
    `reminder:${q}:${player.id}:48`,
  ]);
  assert.equal(reminder.length, 1);
  await query('INSERT INTO submissions(quiz_id,user_id,submitted_at) VALUES($1,$2,now())', [
    q,
    player.id,
  ]);
  const originalFetch = globalThis.fetch;
  const deliveries: string[] = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    deliveries.push(body.subject);
    return new Response('{}', { status: 200 });
  };
  try {
    await runJobs();
    assert.ok(!deliveries.some((s) => s.startsWith('Reminder:')));
    assert.ok(deliveries.some((s) => s.startsWith('A new music quiz:')));
    const count = deliveries.length;
    await runJobs();
    assert.equal(deliveries.length, count);
  } finally {
    globalThis.fetch = originalFetch;
  }
  await query('UPDATE profiles SET quiz_enrolled=false WHERE id=$1', [player.id]);
  await scheduleJobs(new Date(now.getTime() + 12 * 3600000));
  assert.equal(
    (await query('SELECT 1 FROM jobs WHERE dedupe_key=$1', [`reminder:${q}:${player.id}:36`]))
      .length,
    0,
  );
});
function formatDay(date: Date) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    timeZone: 'America/New_York',
  }).format(date) === 'Sun'
    ? 0
    : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(
        new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'America/New_York' }).format(
          date,
        ),
      ) + 1;
}
test('empty quizzes need explicit administrator closure', async () => {
  const { id: q } = await service.createQuiz(dad);
  await query(
    "UPDATE quizzes SET state='grading',release_at=now()-interval '3 days',deadline=now()-interval '1 day' WHERE id=$1",
    [q],
  );
  await scheduleJobs();
  assert.equal((await service.getQuiz(q)).state, 'grading');
  await assert.rejects(() => service.closeEmpty(q, guest), /administrator/);
  await service.closeEmpty(q, dad);
  assert.equal((await service.getQuiz(q)).state, 'released');
});
test('expired audio is deleted while written answers, scores, and discussions survive', async () => {
  await query('UPDATE profiles SET quiz_enrolled=false');
  await query("UPDATE quizzes SET released_at=now()-interval '8 days' WHERE id=$1", [quizId]);
  const post = await service.writePost(player, {
    body: 'Still here after the quiz',
    url: '',
    parentId: null,
  });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://storage.example.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  const originalFetch = globalThis.fetch;
  const removed: string[] = [];
  globalThis.fetch = async (input, init) => {
    if (String(input).includes('/storage/')) {
      removed.push(String(init?.body));
      return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error('Unexpected external request');
  };
  try {
    await runJobs();
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.ok(removed.some((s) => s.includes('sanitized-object')));
  const [c] = await query('SELECT storage_key,audio_status FROM clips WHERE id=$1', [clip]);
  assert.equal(c.storage_key, null);
  assert.equal(c.audio_status, 'deleted');
  const result = await service.resultsFor(quizId);
  assert.equal(result.fields[0].answer, 'Space Oddity');
  assert.equal(result.submissions[0].grades[theme].points, 4);
  assert.equal((await service.postsFor())[0].id, post.id);
});
test('database snapshot restores into an isolated database with quiz results intact', async () => {
  const snapshot = await db.dumpDataDir();
  const restored = new PGlite({ loadDataDir: snapshot });
  try {
    const result = await restored.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM grade_audit',
    );
    assert.equal(result.rows[0].n, 2);
    const answers = await restored.query<{ answer: string }>(
      'SELECT answer FROM answer_keys WHERE field_id=$1',
      [title],
    );
    assert.equal(answers.rows[0].answer, 'Space Oddity');
  } finally {
    await restored.close();
  }
});
test('new members do not get results-announcement emails for quizzes that already closed', async () => {
  const member = id(99);
  await query('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())', [
    member,
    'new@example.test',
  ]);
  await query(
    'INSERT INTO profiles(id,display_name,created_at,digest_subscribed) VALUES($1,$2,now(),false)',
    [member, 'New member'],
  );
  await scheduleJobs();
  assert.equal(
    (await query('SELECT 1 FROM jobs WHERE dedupe_key=$1', [`results:${quizId}:${member}`])).length,
    0,
  );
});
