import { createHmac, timingSafeEqual } from 'node:crypto';
export interface Mailer {
  send(input: {
    to: string;
    subject: string;
    text: string;
    key: string;
    unsubscribe: string;
  }): Promise<void>;
}
export function unsubscribeToken(userId: string, channel: 'quiz' | 'digest') {
  const secret = process.env.UNSUBSCRIBE_SECRET;
  if (!secret || secret.length < 32)
    throw new Error('UNSUBSCRIBE_SECRET must contain at least 32 characters');
  return createHmac('sha256', secret).update(`${userId}:${channel}`).digest('hex');
}
export function verifyUnsubscribe(userId: string, channel: 'quiz' | 'digest', token: string) {
  const expected = unsubscribeToken(userId, channel);
  return /^[a-f0-9]{64}$/.test(token) && timingSafeEqual(Buffer.from(expected), Buffer.from(token));
}
export function unsubscribeUrl(userId: string, channel: 'quiz' | 'digest') {
  return `${process.env.APP_URL}/unsubscribe?user=${userId}&channel=${channel}&token=${unsubscribeToken(userId, channel)}`;
}
export function mailer(): Mailer {
  return {
    async send({ to, subject, text, key, unsubscribe }) {
      if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM)
        throw new Error('Email service is not configured');
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        signal: AbortSignal.timeout(15000),
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': key,
        },
        body: JSON.stringify({
          from: process.env.EMAIL_FROM,
          to: [to],
          subject,
          text: `${text}\n\nManage your email preferences: ${unsubscribe}`,
          headers: { 'List-Unsubscribe': `<${unsubscribe}>` },
        }),
      });
      if (!response.ok) throw new Error(`Email provider returned ${response.status}`);
    },
  };
}
