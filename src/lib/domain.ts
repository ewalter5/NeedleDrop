import { fromZonedTime, formatInTimeZone } from 'date-fns-tz';
import type { QuizState } from './types';

export function normalizeAnswer(value: string) {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}
export function editDistance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++)
      next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
}
export function suggestGrade(answer: string, accepted: string[], kind: string, maximum: number) {
  if (['connection', 'theme', 'custom'].includes(kind))
    return { match: 'manual' as const, points: null };
  const a = normalizeAnswer(answer);
  const keys = accepted.map(normalizeAnswer).filter(Boolean);
  if (a && keys.includes(a)) return { match: 'exact' as const, points: maximum };
  if (
    a.length >= 4 &&
    keys.some(
      (k) => editDistance(a, k) <= Math.min(2, Math.floor(Math.max(k.length, a.length) * 0.2)),
    )
  )
    return { match: 'possible' as const, points: null };
  return { match: 'manual' as const, points: null };
}
export function effectiveState(
  q: { state: QuizState; releaseAt: string; deadline: string },
  now = new Date(),
): QuizState {
  if (q.state === 'released' || q.state === 'draft') return q.state;
  if (now >= new Date(q.deadline)) return 'grading';
  if (now >= new Date(q.releaseAt)) return 'open';
  return 'scheduled';
}
export function canRelease(
  deadline: string,
  submissions: { submittedAt: string | null; reviewed: boolean }[],
  now = new Date(),
) {
  const submitted = submissions.filter((s) => s.submittedAt);
  return now >= new Date(deadline) && submitted.length > 0 && submitted.every((s) => s.reviewed);
}
export function reminderDue(
  deadline: string,
  hours: number,
  now: Date,
  submitted: boolean,
  enrolled: boolean,
) {
  const until = new Date(deadline).getTime() - now.getTime();
  return (
    enrolled && !submitted && until > 0 && until <= hours * 3600000 && until > (hours - 1) * 3600000
  );
}
export function defaultSchedule(now = new Date(), timezone = 'America/New_York') {
  const local = formatInTimeZone(now, timezone, 'yyyy-MM-dd');
  const date = new Date(local + 'T12:00:00Z');
  const offset = (6 - date.getUTCDay() + 7) % 7;
  date.setUTCDate(date.getUTCDate() + offset);
  const saturday = date.toISOString().slice(0, 10);
  date.setUTCDate(date.getUTCDate() + 4);
  return {
    releaseAt: fromZonedTime(saturday + 'T09:00:00', timezone).toISOString(),
    deadline: fromZonedTime(date.toISOString().slice(0, 10) + 'T23:59:00', timezone).toISOString(),
  };
}
export function audioExpired(releasedAt: string | null, now = new Date()) {
  return !!releasedAt && now.getTime() >= new Date(releasedAt).getTime() + 7 * 86400000;
}
