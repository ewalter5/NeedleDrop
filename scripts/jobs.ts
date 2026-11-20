import nextEnv from '@next/env';
nextEnv.loadEnvConfig(process.cwd());
const { runJobs } = await import('../src/server/jobs');
const { pool } = await import('../src/server/db');
try {
  await runJobs();
} finally {
  await pool().end();
}
