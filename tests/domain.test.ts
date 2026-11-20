import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeAnswer,
  suggestGrade,
  effectiveState,
  canRelease,
  reminderDue,
  defaultSchedule,
  audioExpired,
} from '../src/lib/domain';
import { quizSchema, postSchema, gradeSchema } from '../src/server/validation';
import { verifyUnsubscribe, unsubscribeToken } from '../src/server/mail';
import { ffmpegArguments } from '../src/server/jobs';
test('grading normalizes case, spacing, punctuation, and accents, with no blank exact matches', () => {
  assert.equal(normalizeAnswer('  BÉYONCÉ!  Knowles '), 'beyonce knowles');
  assert.deepEqual(suggestGrade('AC/DC', ['acdc'], 'artist', 2), { match: 'exact', points: 2 });
  assert.equal(suggestGrade('Fleetwod Mac', ['Fleetwood Mac'], 'artist', 1).match, 'possible');
  assert.equal(suggestGrade('Stars', ['Space'], 'title', 1).match, 'manual');
  assert.equal(suggestGrade('', [''], 'title', 1).match, 'manual');
  for (const kind of ['connection', 'theme', 'custom'])
    assert.equal(suggestGrade('Space', ['Space'], kind, 3).match, 'manual');
});
test('state boundaries and release require submitted, host-reviewed entries', () => {
  const q = {
    state: 'scheduled' as const,
    releaseAt: '2026-11-07T14:00:00Z',
    deadline: '2026-11-12T04:59:00Z',
  };
  assert.equal(effectiveState(q, new Date(q.releaseAt)), 'open');
  assert.equal(effectiveState(q, new Date(q.deadline)), 'grading');
  assert.equal(effectiveState({ ...q, state: 'draft' }, new Date(q.deadline)), 'draft');
  assert.equal(canRelease(q.deadline, [], new Date('2026-11-13')), false);
  assert.equal(
    canRelease(q.deadline, [{ submittedAt: null, reviewed: false }], new Date('2026-11-13')),
    false,
  );
  assert.equal(
    canRelease(q.deadline, [{ submittedAt: 'yes', reviewed: false }], new Date('2026-11-13')),
    false,
  );
  assert.equal(
    canRelease(
      q.deadline,
      [
        { submittedAt: 'yes', reviewed: true },
        { submittedAt: null, reviewed: false },
      ],
      new Date('2026-11-13'),
    ),
    true,
  );
  assert.equal(
    canRelease(q.deadline, [{ submittedAt: 'yes', reviewed: true }], new Date(q.releaseAt)),
    false,
  );
});
test('reminders target only enrolled people without submissions and stay before deadline', () => {
  const deadline = '2026-11-12T04:59:00Z';
  const now = new Date(new Date(deadline).getTime() - 48 * 3600000);
  assert.equal(reminderDue(deadline, 48, now, false, true), true);
  assert.equal(reminderDue(deadline, 48, now, true, true), false);
  assert.equal(reminderDue(deadline, 48, now, false, false), false);
  assert.equal(reminderDue(deadline, 36, now, false, true), false);
  assert.equal(reminderDue(deadline, 24, new Date(deadline), false, true), false);
});
test('Saturday-to-Wednesday defaults respect daylight saving transitions', () => {
  const spring = defaultSchedule(new Date('2026-03-06T17:00:00Z'));
  assert.equal(spring.releaseAt, '2026-03-07T14:00:00.000Z');
  assert.equal(spring.deadline, '2026-03-12T03:59:00.000Z');
  const fall = defaultSchedule(new Date('2026-10-30T17:00:00Z'));
  assert.equal(fall.releaseAt, '2026-10-31T13:00:00.000Z');
  assert.equal(fall.deadline, '2026-11-05T04:59:00.000Z');
});
test('seven-day retention and FFmpeg strip all source metadata', () => {
  assert.equal(audioExpired('2026-11-01T12:00:00Z', new Date('2026-11-08T12:00:00Z')), true);
  assert.equal(audioExpired(null), false);
  const args = ffmpegArguments('input', 'output');
  assert.equal(args[args.indexOf('-map_metadata') + 1], '-1');
  assert.ok(args.includes('-vn'));
  assert.equal(args[args.indexOf('-protocol_whitelist') + 1], 'file,pipe');
  assert.equal(args[args.indexOf('-id3v2_version') + 1], '0');
});
test('unsubscribe signatures bind both user and email channel', () => {
  process.env.UNSUBSCRIBE_SECRET = 'a'.repeat(64);
  const token = unsubscribeToken('user-a', 'quiz');
  assert.equal(verifyUnsubscribe('user-a', 'quiz', token), true);
  assert.equal(verifyUnsubscribe('user-b', 'quiz', token), false);
  assert.equal(verifyUnsubscribe('user-a', 'digest', token), false);
  assert.equal(verifyUnsubscribe('user-a', 'quiz', 'invalid'), false);
});
test('validation rejects unsafe links, invalid scores, orphan fields, and reversed dates', () => {
  assert.equal(postSchema.safeParse({ body: 'Music', url: 'javascript:alert(1)' }).success, false);
  assert.equal(
    gradeSchema.safeParse({
      grades: { '00000000-0000-4000-8000-000000000001': { points: -1, feedback: '' } },
    }).success,
    false,
  );
  assert.equal(
    quizSchema.safeParse({
      title: 'A quiz',
      description: '',
      rules: '',
      releaseAt: '2026-11-12T00:00:00Z',
      deadline: '2026-11-11T00:00:00Z',
      timezone: 'America/New_York',
      clips: [],
      fields: [],
    }).success,
    false,
  );
});
