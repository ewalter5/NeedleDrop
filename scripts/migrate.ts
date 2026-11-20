import nextEnv from '@next/env';
import { readdir, readFile } from 'node:fs/promises';
nextEnv.loadEnvConfig(process.cwd());
const { pool, transaction } = await import('../src/server/db');
try {
  await transaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtext('needle-drop-migrations'))");
    await c.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY,applied_at timestamptz DEFAULT now())',
    );
    await c.query(
      'ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY; REVOKE ALL ON schema_migrations FROM anon,authenticated',
    );
    for (const name of (await readdir('migrations')).filter((f) => f.endsWith('.sql')).sort()) {
      if ((await c.query('SELECT 1 FROM schema_migrations WHERE name=$1', [name])).rowCount)
        continue;
      await c.query(await readFile(`migrations/${name}`, 'utf8'));
      await c.query('INSERT INTO schema_migrations(name) VALUES($1)', [name]);
      console.log(`Applied ${name}`);
    }
  });
} finally {
  await pool().end();
}
