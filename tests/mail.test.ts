import { test } from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';
import { mailer, mailConfigured, smtpConfiguration, SmtpDeliveryError } from '../src/server/mail';

const settings = [
  'WORKER_SEND_EMAILS',
  'MAIL_TRANSPORT',
  'EMAIL_FROM',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USER',
  'SMTP_PASSWORD',
] as const;
function configure() {
  const saved = settings.map((key) => process.env[key]);
  Object.assign(process.env, {
    WORKER_SEND_EMAILS: 'true',
    MAIL_TRANSPORT: 'smtp',
    EMAIL_FROM: 'Quiz <sender@example.test>',
    SMTP_HOST: 'smtp.example.test',
    SMTP_PORT: '465',
    SMTP_USER: 'sender@example.test',
    SMTP_PASSWORD: 'private-password',
  });
  return () =>
    settings.forEach((key, i) => {
      if (saved[i] === undefined) delete process.env[key];
      else process.env[key] = saved[i];
    });
}
test('SMTP configuration enforces encryption and the explicit email-disable switch', () => {
  const restore = configure();
  try {
    assert.equal(mailConfigured(), true);
    assert.equal(smtpConfiguration().secure, true);
    process.env.SMTP_PORT = '587';
    assert.equal(smtpConfiguration().requireTLS, true);
    process.env.SMTP_PORT = '25';
    assert.throws(smtpConfiguration);
    process.env.WORKER_SEND_EMAILS = 'false';
    assert.equal(mailConfigured(), false);
    delete process.env.WORKER_SEND_EMAILS;
    delete process.env.SMTP_PASSWORD;
    assert.equal(mailConfigured(), false);
  } finally {
    restore();
  }
});
test('SMTP sends plain-text quiz mail with preferences and deterministic message ID', async (t) => {
  const restore = configure();
  const messages: Record<string, unknown>[] = [];
  let closed = false;
  t.mock.method(
    nodemailer,
    'createTransport',
    () =>
      ({
        sendMail: async (input: Record<string, unknown>) => {
          messages.push(input);
          return { accepted: ['player@example.test'], rejected: [] };
        },
        close: () => {
          closed = true;
        },
      }) as never,
  );
  const input = {
    to: 'player@example.test',
    subject: 'Quiz',
    text: 'Listen now',
    key: 'quiz:user:open',
    unsubscribe: 'https://example.test/unsubscribe',
  };
  try {
    await mailer().send(input);
    await mailer().send(input);
    assert.equal(messages[0].messageId, messages[1].messageId);
    assert.ok(String(messages[0].text).includes(input.unsubscribe));
    assert.equal(JSON.stringify(messages).includes('private-password'), false);
    assert.equal(closed, true);
  } finally {
    restore();
  }
});
test('SMTP failures use a controlled manual-review error without leaking credentials', async (t) => {
  const restore = configure();
  t.mock.method(
    nodemailer,
    'createTransport',
    () =>
      ({
        sendMail: async () => {
          throw new Error('private-password in provider response');
        },
        close() {},
      }) as never,
  );
  try {
    await assert.rejects(
      mailer().send({
        to: 'player@example.test',
        subject: 'Quiz',
        text: 'Hello',
        key: 'test',
        unsubscribe: 'https://example.test/unsubscribe',
      }),
      (error) => error instanceof SmtpDeliveryError && !error.message.includes('private-password'),
    );
  } finally {
    restore();
  }
});
