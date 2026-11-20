import { z } from 'zod';
const instant = z.iso.datetime({ offset: true });
export const uuid = z.uuid();
export const fieldSchema = z.object({
  id: uuid,
  clipId: uuid.nullable(),
  label: z.string().trim().min(1).max(100),
  kind: z.enum(['title', 'artist', 'connection', 'custom', 'theme']),
  maxPoints: z.number().positive().max(1000),
  position: z.number().int().min(0),
  answer: z.string().trim().max(2000),
  alternatives: z.array(z.string().trim().min(1).max(300)).max(30),
});
export const quizSchema = z
  .object({
    title: z.string().trim().min(1).max(150),
    description: z.string().max(1000),
    rules: z.string().max(10000),
    releaseAt: instant,
    deadline: instant,
    timezone: z.string().refine((v) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: v });
        return true;
      } catch {
        return false;
      }
    }, 'Invalid timezone'),
    clips: z.array(z.object({ id: uuid, position: z.number().int().positive() })).max(30),
    fields: z.array(fieldSchema).max(200),
  })
  .superRefine((q, ctx) => {
    if (new Date(q.deadline) <= new Date(q.releaseAt))
      ctx.addIssue({ code: 'custom', message: 'Deadline must follow release time' });
    if (
      new Set(q.clips.map((c) => c.id)).size !== q.clips.length ||
      new Set(q.clips.map((c) => c.position)).size !== q.clips.length ||
      new Set(q.fields.map((f) => f.id)).size !== q.fields.length
    )
      ctx.addIssue({ code: 'custom', message: 'Clip and field identifiers must be unique' });
    if (q.fields.some((f) => f.clipId && !q.clips.some((c) => c.id === f.clipId)))
      ctx.addIssue({ code: 'custom', message: 'Every field must belong to this quiz' });
  });
export const submissionSchema = z.object({
  answers: z.record(uuid, z.string().max(4000)),
  submit: z.boolean(),
  version: z.number().int().nonnegative(),
});
export const gradeSchema = z.object({
  grades: z.record(
    uuid,
    z.object({ points: z.number().nonnegative().max(1000), feedback: z.string().max(2000) }),
  ),
});
export const postSchema = z.object({
  body: z.string().trim().min(1).max(5000),
  url: z.union([
    z.literal(''),
    z
      .url()
      .refine(
        (v) => ['https:', 'http:'].includes(new URL(v).protocol),
        'Use an HTTP or HTTPS link',
      ),
  ]),
  parentId: uuid.nullable().default(null),
});
