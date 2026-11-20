import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  configured,
  currentUser,
  requireUser,
  authClient,
  HttpError,
  rateLimit,
  requireHost,
} from '@/server/auth';
import * as svc from '@/server/service';
import { query } from '@/server/db';
import { uuid } from '@/server/validation';
import { demoData, demoQuiz, demoResults } from '@/lib/demo';
import { verifyUnsubscribe } from '@/server/mail';
import { playlistTracks, searchYoutube, sourceRequestSchema } from '@/server/sources';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function route(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const path = (await params).path;
  const name = path.join('/');
  const method = req.method;
  try {
    if (name === 'health' && method === 'GET') {
      if (
        !configured() ||
        !process.env.APP_URL ||
        !process.env.RESEND_API_KEY ||
        !process.env.EMAIL_FROM ||
        (process.env.UNSUBSCRIBE_SECRET?.length || 0) < 32
      )
        return json({ status: 'not configured' }, 503);
      await query('SELECT 1 FROM settings LIMIT 1');
      return json({ status: 'ok' });
    }
    if (method !== 'GET') {
      const expected = new URL(process.env.APP_URL || req.url).origin;
      if (req.headers.get('origin') !== expected)
        throw new HttpError(403, 'Request origin is not allowed.');
      const limit = (path[0] === 'clips' ? 26 : 1) * 1024 * 1024;
      const length = Number(req.headers.get('content-length') || 0);
      if (length > limit) throw new HttpError(413, 'Request is too large.');
      if (req.body) {
        const chunks: Uint8Array[] = [];
        let size = 0;
        const reader = req.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > limit) {
            await reader.cancel();
            throw new HttpError(413, 'Request is too large.');
          }
          chunks.push(value);
        }
        const body = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          body.set(chunk, offset);
          offset += chunk.length;
        }
        req = new NextRequest(req.url, { method, headers: req.headers, body: body.buffer });
      }
    }
    if (!configured()) {
      if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEMO !== 'true')
        throw new HttpError(503, 'The website is awaiting service configuration.');
      if (method !== 'GET')
        throw new HttpError(503, 'This is a preview. Connect services to save changes.');
      if (name === 'bootstrap') return json(demoData);
      if (path[0] === 'quizzes' && path[1] === demoQuiz.id)
        return json({ quiz: demoQuiz, submission: null });
      if (path[0] === 'results') return json(demoResults);
      throw new HttpError(404, 'This preview feature needs live services.');
    }
    if (name === 'bootstrap' && method === 'GET')
      return json(await svc.bootstrap(await currentUser()));
    if (path[0] === 'auth' && method === 'POST') {
      const auth = await authClient();
      const data = await req.json();
      const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
      await rateLimit(`auth:${createHash('sha256').update(ip).digest('hex')}`, 20, 900);
      const action = path[1];
      if (action === 'signout') {
        await auth.auth.signOut();
        return json({ ok: true });
      }
      if (action === 'password') {
        await requireUser();
        const { password } = z.object({ password: z.string().min(12).max(128) }).parse(data);
        const { error } = await auth.auth.updateUser({ password });
        if (error) throw new HttpError(400, error.message);
        return json({ message: 'Password updated.' });
      }
      const email = z.email().parse(data.email);
      await rateLimit(
        `auth-email:${createHash('sha256').update(email.toLowerCase()).digest('hex')}`,
        8,
        900,
      );
      if (action === 'reset') {
        await auth.auth.resetPasswordForEmail(email, {
          redirectTo: `${process.env.APP_URL}/auth/callback?next=/account/reset`,
        });
        return json({ message: 'If that account exists, a password reset email is on its way.' });
      }
      const password = z
        .string()
        .min(action === 'signup' ? 12 : 1)
        .max(128)
        .parse(data.password);
      if (action === 'signup') {
        const displayName = z.string().trim().min(1).max(60).parse(data.displayName);
        const { error } = await auth.auth.signUp({
          email,
          password,
          options: {
            data: { display_name: displayName },
            emailRedirectTo: `${process.env.APP_URL}/auth/callback`,
          },
        });
        if (error) throw new HttpError(400, error.message);
        return json({ message: 'Check your email to verify your account, then sign in.' });
      }
      if (action === 'signin') {
        const { error } = await auth.auth.signInWithPassword({ email, password });
        if (error)
          throw new HttpError(400, 'Unable to sign in. Check your details and verify your email.');
        return json({ ok: true });
      }
      throw new HttpError(404, 'Unknown account action.');
    }
    if (name === 'unsubscribe' && method === 'POST') {
      const d = z
        .object({ user: uuid, channel: z.enum(['quiz', 'digest']), token: z.string() })
        .parse(await req.json());
      if (!verifyUnsubscribe(d.user, d.channel, d.token))
        throw new HttpError(403, 'This unsubscribe link is invalid.');
      await query(
        `UPDATE profiles SET ${d.channel === 'quiz' ? 'quiz_enrolled' : 'digest_subscribed'}=false WHERE id=$1`,
        [d.user],
      );
      return json({ ok: true });
    }
    const p = await requireUser();
    if (name === 'session' && method === 'GET') return json({ userId: p.id });
    if (method !== 'GET') await rateLimit(`write:${p.id}`, 90);
    if (name === 'profile' && method === 'PATCH') {
      const d = z
        .object({
          displayName: z.string().trim().min(1).max(60),
          quizEnrolled: z.boolean(),
          digestSubscribed: z.boolean(),
        })
        .parse(await req.json());
      await query(
        'UPDATE profiles SET display_name=$2,quiz_enrolled=$3,digest_subscribed=$4 WHERE id=$1',
        [p.id, d.displayName, d.quizEnrolled, d.digestSubscribed],
      );
      return json({ ok: true });
    }
    if (name === 'quizzes' && method === 'POST') return json(await svc.createQuiz(p));
    if (path[0] === 'quizzes' && path[1]) {
      const id = uuid.parse(path[1]);
      if (path[2] === 'submission' && method === 'PUT')
        return json(await svc.saveSubmission(id, p, await req.json()));
      if (method === 'GET') return json(await svc.playerQuiz(id, p));
    }
    if (path[0] === 'results' && method === 'GET')
      return json(await svc.resultsFor(uuid.parse(path[1])));
    if (path[0] === 'host' && path[1]) {
      const id = uuid.parse(path[1]);
      await requireHost(p, id);
      if (path[2] === 'sources' && method === 'POST') {
        await rateLimit(`sources:${p.id}`, 30, 3600);
        const source = sourceRequestSchema.parse(await req.json());
        return json(
          source.kind === 'spotify'
            ? await playlistTracks(source.url)
            : await searchYoutube(source.query),
        );
      }
      if (path.length === 2 && method === 'GET') return json(await svc.hostQuiz(id, p));
      if (path.length === 2 && method === 'PUT')
        return json(await svc.saveQuiz(id, p, await req.json()));
      if (path[2] === 'publish' && method === 'POST') return json(await svc.publishQuiz(id, p));
      if (path[2] === 'deadline' && method === 'PATCH')
        return json(await svc.updateDeadline(id, p, await req.json()));
      if (path[2] === 'close' && method === 'POST') return json(await svc.closeEmpty(id, p));
      if (path[2] === 'grades' && method === 'PUT')
        return json(await svc.gradeSubmission(id, uuid.parse(path[3]), p, await req.json()));
      if (path[2] === 'hosts' && method === 'PUT') {
        if (!p.admin) throw new HttpError(403, 'Only administrators assign hosts.');
        const { userId, remove } = z
          .object({ userId: uuid, remove: z.boolean().default(false) })
          .parse(await req.json());
        if (remove)
          await query('DELETE FROM quiz_hosts WHERE quiz_id=$1 AND user_id=$2', [id, userId]);
        else
          await query(
            'INSERT INTO quiz_hosts(quiz_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
            [id, userId],
          );
        return json({ ok: true });
      }
    }
    if (path[0] === 'clips') {
      const id = uuid.parse(path[1]);
      if (method === 'GET') return json(await svc.playback(id, p));
      if (method === 'POST') {
        await rateLimit(`upload:${p.id}`, 20, 3600);
        if (path[2] === 'youtube')
          return json(await svc.importYoutubeClip(id, p, await req.json()));
        const form = await req.formData();
        const file = form.get('audio');
        if (!(file instanceof File)) throw new HttpError(400, 'Choose an audio file.');
        const selection =
          form.has('start') || form.has('end')
            ? {
                start:
                  form.get('start') === null || form.get('start') === ''
                    ? NaN
                    : Number(form.get('start')),
                end:
                  form.get('end') === null || form.get('end') === ''
                    ? NaN
                    : Number(form.get('end')),
              }
            : undefined;
        return json(await svc.uploadClip(id, p, file, selection));
      }
    }
    if (path[0] === 'posts') {
      if (method === 'POST') {
        await rateLimit(`post:${p.id}`, 10, 600);
        return json(await svc.writePost(p, await req.json()));
      }
      if (method === 'PATCH')
        return json(await svc.writePost(p, await req.json(), uuid.parse(path[1])));
      if (method === 'DELETE') return json(await svc.deletePost(uuid.parse(path[1]), p));
    }
    if (path[0] === 'admin') {
      if (!p.admin) throw new HttpError(403, 'Administrator access is required.');
      if (path[1] === 'users' && method === 'GET')
        return json(
          await query(
            'SELECT id,display_name AS "displayName",admin,restricted FROM profiles ORDER BY display_name',
          ),
        );
      if (path[1] === 'users' && method === 'PATCH') {
        const d = z.object({ id: uuid, restricted: z.boolean() }).parse(await req.json());
        if (d.id === p.id) throw new HttpError(400, 'You cannot restrict your own account.');
        await query('UPDATE profiles SET restricted=$2 WHERE id=$1', [d.id, d.restricted]);
        return json({ ok: true });
      }
      if (path[1] === 'jobs' && method === 'GET')
        return json(
          await query(
            "SELECT id,kind,state,attempts,last_error,due_at FROM jobs WHERE state<>'done' ORDER BY due_at LIMIT 100",
          ),
        );
      if (path[1] === 'settings' && method === 'PUT') {
        const d = z
          .object({
            digestDay: z.number().int().min(0).max(6),
            digestHour: z.number().int().min(0).max(23),
            timezone: z.string().refine((v) => {
              try {
                new Intl.DateTimeFormat('en', { timeZone: v });
                return true;
              } catch {
                return false;
              }
            }),
          })
          .parse(await req.json());
        await query('UPDATE settings SET digest_day=$1,digest_hour=$2,timezone=$3', [
          d.digestDay,
          d.digestHour,
          d.timezone,
        ]);
        return json({ ok: true });
      }
    }
    throw new HttpError(404, 'Not found.');
  } catch (error) {
    if (error instanceof SyntaxError) return json({ error: 'Invalid request body.' }, 400);
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    if (error instanceof z.ZodError)
      return json(
        { error: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') },
        400,
      );
    console.error('API request failed', error instanceof Error ? error.name : 'UnknownError');
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
}
function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } });
}
export { route as GET, route as POST, route as PUT, route as PATCH, route as DELETE };
