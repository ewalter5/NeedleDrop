import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import nodemailer from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';

// SMTP has no provider idempotency key. Do not automatically retry an ambiguous
// delivery failure, which could otherwise send the same message more than once.
export class SmtpDeliveryError extends Error {}
export function mailConfigured() {
  if (process.env.WORKER_SEND_EMAILS === 'false') return false;
  if (process.env.MAIL_TRANSPORT === 'smtp')
    return !!(
      process.env.EMAIL_FROM &&
      process.env.SMTP_HOST &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASSWORD
    );
  return !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}
export function smtpConfiguration(): SMTPTransport.Options {
  const port = Number(process.env.SMTP_PORT || 465);
  if (!mailConfigured() || ![465, 587].includes(port))
    throw new Error('Configure SMTP email settings with TLS port 465 or 587.');
  return {
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    requireTLS: port === 587,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
    tls: { minVersion: 'TLSv1.2' },
    logger: false,
    debug: false,
    disableFileAccess: true,
    disableUrlAccess: true,
  };
}
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
      if (!mailConfigured()) throw new Error('Email delivery is disabled or not configured');
      if (process.env.MAIL_TRANSPORT === 'smtp') {
        const transport = nodemailer.createTransport(smtpConfiguration());
        try {
          const result = await transport.sendMail({
            from: process.env.EMAIL_FROM,
            to,
            subject,
            text: `${text}\n\nManage your email preferences: ${unsubscribe}`,
            messageId: `<${createHash('sha256').update(key).digest('hex')}@needledrop.local>`,
            headers: { 'List-Unsubscribe': `<${unsubscribe}>` },
          });
          if (!result.accepted?.length || result.rejected?.length)
            throw new Error('Recipient was not accepted');
        } catch {
          throw new SmtpDeliveryError(
            'SMTP delivery needs review. Check the sender account before requeuing this message; it may already have been sent.',
          );
        } finally {
          transport.close();
        }
        return;
      }
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
