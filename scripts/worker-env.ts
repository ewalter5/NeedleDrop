import nextEnv from '@next/env';
nextEnv.loadEnvConfig(process.cwd());
// Keep local development on localhost, but put the hosted URL into email links.
if (process.env.WORKER_APP_URL) process.env.APP_URL = process.env.WORKER_APP_URL;
process.env.WORKER_SEND_EMAILS ??= 'false';
