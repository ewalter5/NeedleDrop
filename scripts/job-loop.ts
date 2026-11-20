import './worker-env';
const { runJobs } = await import('../src/server/jobs');
let stopping = false;
process.on('SIGTERM', () => {
  stopping = true;
});
process.on('SIGINT', () => {
  stopping = true;
});
while (!stopping) {
  try {
    await runJobs();
  } catch (e) {
    console.error('Job cycle failed:', e instanceof Error ? e.name : 'UnknownError');
  }
  for (let i = 0; i < 60 && !stopping; i++) await new Promise((r) => setTimeout(r, 5000));
}
const { pool } = await import('../src/server/db');
await pool().end();
