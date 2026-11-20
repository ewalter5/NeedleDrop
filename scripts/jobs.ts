import './worker-env';
const { runJobs } = await import('../src/server/jobs');
const { pool } = await import('../src/server/db');
try {
  await runJobs();
  console.log('Worker cycle finished. Email jobs wait until explicitly enabled and configured.');
} catch (error) {
  console.error('Worker cycle failed:', error instanceof Error ? error.name : 'UnknownError');
  process.exitCode = 1;
} finally {
  await pool().end();
}
