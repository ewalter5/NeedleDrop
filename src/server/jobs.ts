import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { query, transaction, lockQuiz } from './db';
import { enqueue, releaseIfReady } from './service';
import { reminderDue } from '@/lib/domain';
import { storage } from './storage';
import { mailer, unsubscribeUrl } from './mail';
import { segmentSchema, youtubeUrl, type Segment } from '@/lib/audio-source';
import { audioStep, audioFailureMessage, AudioProcessingError } from './audio-errors';

export const ffmpegArguments = (input: string, output: string, segment?: Segment) => [
  '-nostdin',
  '-y',
  '-protocol_whitelist',
  'file,pipe',
  '-i',
  input,
  ...(segment ? ['-ss', String(segment.start), '-t', String(segment.end - segment.start)] : []),
  '-map',
  '0:a:0',
  '-vn',
  '-sn',
  '-dn',
  '-map_metadata',
  '-1',
  '-map_chapters',
  '-1',
  '-c:a',
  'libmp3lame',
  '-b:a',
  '128k',
  '-id3v2_version',
  '0',
  '-write_id3v1',
  '0',
  output,
];
export function youtubeArguments(url: string, output: string, segment: Segment) {
  const range = segmentSchema.parse(segment);
  const ffmpeg = process.env.FFMPEG_PATH;
  return [
    '--ignore-config',
    '--no-plugin-dirs',
    '--no-cache-dir',
    '--no-playlist',
    '--no-progress',
    '--js-runtimes',
    'node',
    '--socket-timeout',
    '15',
    '--retries',
    '1',
    '--fragment-retries',
    '1',
    '--format',
    'bestaudio/best',
    '--max-filesize',
    '25M',
    '--match-filter',
    '!is_live & duration <= 1800',
    '--download-sections',
    `*${range.start}-${range.end}`,
    '--force-keyframes-at-cuts',
    // yt-dlp requires an actual file/directory here, not a command name on PATH.
    ...(ffmpeg && /[\\/]/.test(ffmpeg) ? ['--ffmpeg-location', ffmpeg] : []),
    '--output',
    output,
    '--',
    youtubeUrl(url),
  ];
}
async function audioDuration(path: string) {
  const ffmpeg = process.env.FFMPEG_PATH;
  const probe =
    process.env.FFPROBE_PATH ||
    (ffmpeg && /[\\/]/.test(ffmpeg)
      ? join(dirname(ffmpeg), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
      : 'ffprobe');
  const { stdout } = await audioStep('Audio inspection', () =>
    promisify(execFile)(
      probe,
      [
        '-v',
        'error',
        '-protocol_whitelist',
        'file,pipe',
        '-show_entries',
        'format=duration',
        '-of',
        'json',
        path,
      ],
      { timeout: 15000, maxBuffer: 1024 * 1024, windowsHide: true },
    ),
  );
  const duration = Number(JSON.parse(stdout).format?.duration);
  if (!Number.isFinite(duration) || duration <= 0)
    throw new AudioProcessingError(
      'Audio inspection failed. Could not determine the audio duration.',
    );
  return duration;
}
type Job = {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
  dedupe_key: string;
  sent_at: string | null;
};
export async function scheduleJobs(now = new Date()) {
  const quizzes = await query("SELECT * FROM quizzes WHERE state<>'draft'");
  const people = await query(
    'SELECT id,created_at,quiz_enrolled,digest_subscribed FROM profiles WHERE NOT restricted',
  );
  for (const q of quizzes) {
    await transaction(async (c) => {
      await lockQuiz(q.id, c);
      await releaseIfReady(q.id, c);
      await query(
        "UPDATE quizzes SET state=CASE WHEN deadline<=now() THEN 'grading' WHEN release_at<=now() THEN 'open' ELSE 'scheduled' END WHERE id=$1 AND state<>'released'",
        [q.id],
        c,
      );
    });
    const [fresh] = await query('SELECT * FROM quizzes WHERE id=$1', [q.id]);
    if (now >= new Date(fresh.release_at)) {
      for (const p of people.filter((p) => p.quiz_enrolled)) {
        // Don't send stale opening announcements for archived quizzes.
        if (now < new Date(fresh.deadline))
          await enqueue('email', `open:${q.id}:${p.id}`, {
            event: 'open',
            quizId: q.id,
            userId: p.id,
          });
        const [s] = await query(
          'SELECT submitted_at FROM submissions WHERE quiz_id=$1 AND user_id=$2',
          [q.id, p.id],
        );
        for (const hours of [48, 36, 24])
          if (reminderDue(fresh.deadline, hours, now, !!s?.submitted_at, true))
            await enqueue('email', `reminder:${q.id}:${p.id}:${hours}`, {
              event: 'reminder',
              quizId: q.id,
              userId: p.id,
              hours,
            });
        if (
          fresh.state === 'released' &&
          fresh.released_at &&
          now.getTime() - new Date(fresh.released_at).getTime() < 7 * 86400000 &&
          new Date(p.created_at) <= new Date(fresh.deadline)
        )
          await enqueue('email', `results:${q.id}:${p.id}`, {
            event: 'results',
            quizId: q.id,
            userId: p.id,
          });
      }
    }
    if (
      fresh.released_at &&
      now.getTime() >= new Date(fresh.released_at).getTime() + 7 * 86400000
    ) {
      await transaction(async (c) => {
        await lockQuiz(q.id, c);
        const clips = await query(
          'SELECT storage_key FROM clips WHERE quiz_id=$1 AND storage_key IS NOT NULL',
          [q.id],
          c,
        );
        for (const clip of clips)
          await enqueue(
            'delete_audio',
            `delete:${clip.storage_key}`,
            { keys: [clip.storage_key] },
            c,
          );
        await query(
          "UPDATE clips SET storage_key=NULL,audio_status='deleted' WHERE quiz_id=$1",
          [q.id],
          c,
        );
      });
    }
  }
  const [settings] = await query('SELECT * FROM settings');
  if (
    Number(formatInTimeZone(now, settings.timezone, 'i')) % 7 === settings.digest_day &&
    Number(formatInTimeZone(now, settings.timezone, 'H')) >= settings.digest_hour
  ) {
    const day = formatInTimeZone(now, settings.timezone, 'yyyy-MM-dd');
    const end = fromZonedTime(
      `${day}T${String(settings.digest_hour).padStart(2, '0')}:00:00`,
      settings.timezone,
    );
    const previous = new Date(`${day}T12:00:00Z`);
    previous.setUTCDate(previous.getUTCDate() - 7);
    const start = fromZonedTime(
      `${previous.toISOString().slice(0, 10)}T${String(settings.digest_hour).padStart(2, '0')}:00:00`,
      settings.timezone,
    );
    for (const p of people.filter((p) => p.digest_subscribed))
      await enqueue('email', `digest:${day}:${p.id}`, {
        event: 'digest',
        userId: p.id,
        start: start.toISOString(),
        end: end.toISOString(),
      });
  }
  await query('DELETE FROM rate_limits WHERE expires_at<now()');
}
async function processAudio(job: Job) {
  const {
    clipId,
    originalKey,
    youtubeUrl: sourceUrl,
    segment: selection,
  } = job.payload as {
    clipId: string;
    originalKey: string;
    youtubeUrl?: string;
    segment?: Segment;
  };
  const segment = selection ? segmentSchema.parse(selection) : undefined;
  const outputKey = `clips/${clipId}/${job.id}.mp3`;
  await enqueue(
    'reconcile_audio',
    `reconcile:${job.id}`,
    { key: outputKey },
    undefined,
    new Date(Date.now() + 86400000),
  );
  const [clip] = await query('SELECT * FROM clips WHERE id=$1', [clipId]);
  if (!clip) {
    await storage().remove([originalKey, outputKey]);
    return;
  }
  await transaction(async (c) => {
    await lockQuiz(clip.quiz_id, c);
    const [fresh] = await query('SELECT * FROM clips WHERE id=$1', [clipId], c);
    if (!fresh || fresh.storage_key !== originalKey) {
      // A successful retry must not remove the published output.
      await enqueue('delete_audio', `delete:${originalKey}`, { keys: [originalKey] }, c);
      if (fresh?.storage_key !== outputKey)
        await enqueue('delete_audio', `delete:${outputKey}`, { keys: [outputKey] }, c);
      return;
    }
    const dir = await mkdtemp(join(tmpdir(), 'needle-drop-'));
    try {
      let input = join(dir, 'source');
      const output = join(dir, 'clip.mp3');
      if (sourceUrl) {
        if (!segment) throw new Error('Missing YouTube segment');
        await audioStep('YouTube download', () =>
          promisify(execFile)(
            process.env.YTDLP_PATH || 'yt-dlp',
            youtubeArguments(sourceUrl, join(dir, 'download.%(ext)s'), segment),
            { timeout: 180000, maxBuffer: 1024 * 1024, windowsHide: true },
          ),
        );
        const files = (await readdir(dir)).filter(
          (f) => /^download\.[a-z0-9]+$/.test(f) && !f.endsWith('.part'),
        );
        if (files.length !== 1)
          throw new AudioProcessingError(
            'YouTube download failed. No audio excerpt was produced. Choose another recording.',
          );
        input = join(dir, files[0]);
        if ((await stat(input)).size > 25 * 1024 * 1024)
          throw new AudioProcessingError(
            'YouTube download failed. The downloaded file exceeds 25 MB.',
          );
      } else
        await audioStep('Audio storage', async () =>
          writeFile(input, await storage().download(originalKey)),
        );
      if (segment && !sourceUrl && segment.end > (await audioDuration(input)) + 0.15)
        throw new AudioProcessingError(
          'Audio inspection failed. The selected end time exceeds the recording duration.',
        );
      await audioStep('Audio conversion', () =>
        promisify(execFile)(
          process.env.FFMPEG_PATH || 'ffmpeg',
          ffmpegArguments(
            input,
            output,
            sourceUrl ? { start: 0, end: segment!.end - segment!.start } : segment,
          ),
          { timeout: 90000, maxBuffer: 1024 * 1024 },
        ),
      );
      const outputDuration = await audioDuration(output);
      if (
        segment &&
        (outputDuration < segment.end - segment.start - 0.5 ||
          outputDuration > segment.end - segment.start + 0.5)
      )
        throw new AudioProcessingError(
          'Audio inspection failed. The source does not contain the full selected excerpt. Choose a different range.',
        );
      await audioStep('Audio storage', async () => {
        await storage().remove([outputKey]);
        await storage().upload(outputKey, await readFile(output), 'audio/mpeg');
      });
      await query(
        "UPDATE clips SET storage_key=$2,audio_status='ready' WHERE id=$1",
        [clipId, outputKey],
        c,
      );
      await enqueue('delete_audio', `delete:${originalKey}`, { keys: [originalKey] }, c);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}
async function sendEmail(job: Job) {
  const payload = job.payload;
  const userId = String(payload.userId);
  await transaction(async (c) => {
    // Keep the same lock order used by submissions/grading.
    if (payload.quizId) await lockQuiz(String(payload.quizId), c);
    const [p] = await query(
      'SELECT p.*,u.email,u.email_confirmed_at FROM profiles p JOIN auth.users u ON u.id=p.id WHERE p.id=$1 FOR UPDATE OF p',
      [userId],
      c,
    );
    const digest = payload.event === 'digest';
    if (
      !p ||
      p.restricted ||
      !p.email_confirmed_at ||
      (digest ? !p.digest_subscribed : !p.quiz_enrolled)
    )
      return;
    let subject = '',
      text = '';
    const app = process.env.APP_URL;
    if (digest) {
      const end = new Date(String(payload.end));
      const start = new Date(String(payload.start));
      const posts = await query(
        `SELECT p.id,p.body,p.url,u.display_name FROM posts p JOIN profiles u ON u.id=p.author_id WHERE p.parent_id IS NULL AND NOT u.restricted AND p.created_at>$1 AND p.created_at<=$2 ORDER BY p.created_at`,
        [start, end],
        c,
      );
      if (!posts.length) return;
      subject = 'Your weekly Needle Drop';
      text =
        'This week in the listening room:\n\n' +
        posts
          .map((p) => `${p.display_name}: ${p.body}\n${p.url}\n${app}/community#post-${p.id}`)
          .join('\n\n');
    } else {
      const [q] = await query('SELECT * FROM quizzes WHERE id=$1', [payload.quizId], c);
      if (!q) return;
      const link = `${app}/quiz/${q.id}`;
      if (payload.event === 'reminder') {
        const [s] = await query(
          'SELECT submitted_at FROM submissions WHERE quiz_id=$1 AND user_id=$2',
          [q.id, p.id],
          c,
        );
        if (
          s?.submitted_at ||
          new Date() >= new Date(q.deadline) ||
          new Date() < new Date(q.release_at)
        )
          return;
        subject = `Reminder: ${q.title} is due soon`;
        text = `Your answers for ${q.title} haven't been submitted yet.\n\nDeadline: ${formatInTimeZone(q.deadline, q.timezone, 'EEEE, MMMM d, h:mm a zzz')}\n\nSave and submit your answers: ${link}`;
      } else if (payload.event === 'results') {
        if (q.state !== 'released') return;
        subject = `The results are in: ${q.title}`;
        text = `See the scores, answers, and everyone's guesses:\n${app}/results/${q.id}`;
      } else {
        if (new Date() >= new Date(q.deadline) || new Date() < new Date(q.release_at)) return;
        subject = `A new music quiz: ${q.title}`;
        text = `${q.description}\n\nThe new quiz is ready. Listen and submit your answers:\n${link}`;
      }
    }
    // Provider keys expire after 24h. Don't retry ambiguous deliveries beyond that window.
    if (job.sent_at && Date.now() - new Date(job.sent_at).getTime() > 23 * 3600000)
      throw new Error('Delivery needs manual review: provider deduplication window expired');
    await mailer().send({
      to: p.email,
      subject,
      text,
      key: job.dedupe_key,
      unsubscribe: unsubscribeUrl(p.id, digest ? 'digest' : 'quiz'),
    });
  });
}
export async function runJobs() {
  await scheduleJobs();
  for (let i = 0; i < 100; i++) {
    const job = await transaction(async (c) => {
      const [j] = await query(
        `SELECT * FROM jobs WHERE (state='pending' AND due_at<=now()) OR (state='working' AND locked_at<now()-interval '10 minutes') ORDER BY due_at FOR UPDATE SKIP LOCKED LIMIT 1`,
        [],
        c,
      );
      if (!j) return null;
      const [claimed] = await query(
        "UPDATE jobs SET state='working',locked_at=now(),attempts=attempts+1,sent_at=CASE WHEN kind='email' THEN COALESCE(sent_at,now()) ELSE sent_at END WHERE id=$1 RETURNING *",
        [j.id],
        c,
      );
      return claimed as Job;
    });
    if (!job) break;
    try {
      if (job.kind === 'process_audio') await processAudio(job);
      else if (job.kind === 'delete_audio') await storage().remove(job.payload.keys as string[]);
      else if (job.kind === 'reconcile_audio') {
        if (!(await query('SELECT 1 FROM clips WHERE storage_key=$1', [job.payload.key])).length)
          await storage().remove([String(job.payload.key)]);
      } else if (job.kind === 'email') await sendEmail(job);
      else throw new Error('Unknown background job kind');
      await query("UPDATE jobs SET state='done',last_error=NULL WHERE id=$1", [job.id]);
    } catch (error) {
      // Never persist FFmpeg output, source names, or secrets in error logs.
      const message =
        job.kind === 'process_audio'
          ? audioFailureMessage(error)
          : error instanceof Error
            ? error.message.slice(0, 200)
            : 'Background job failed';
      await query(
        "UPDATE jobs SET state=CASE WHEN attempts>=5 AND kind NOT IN ('delete_audio','reconcile_audio') THEN 'failed' ELSE 'pending' END,due_at=now()+least(60,power(2,least(attempts,6)))*interval '1 minute',last_error=$2 WHERE id=$1",
        [job.id, message],
      );
      if (job.kind === 'process_audio' && job.attempts >= 5) {
        await query(
          "UPDATE clips SET audio_status='failed',storage_key=NULL WHERE id=$1 AND storage_key=$2",
          [job.payload.clipId, job.payload.originalKey],
        );
        await enqueue('delete_audio', `failed:${job.id}`, {
          keys: [job.payload.originalKey, `clips/${job.payload.clipId}/${job.id}.mp3`],
        });
      }
      console.error(`Job ${job.id}: ${message}`);
    }
  }
}
