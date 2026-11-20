import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());
const { query, pool } = await import('../src/server/db');
const email = process.argv[2];
if (!email) throw new Error('Usage: pnpm admin admin@example.com (after verified signup)');
try {
  const rows = await query(
    `INSERT INTO profiles(id,display_name,admin) SELECT id,COALESCE(NULLIF(raw_user_meta_data->>'display_name',''),'Quiz host'),true FROM auth.users WHERE lower(email)=lower($1) AND email_confirmed_at IS NOT NULL ON CONFLICT(id) DO UPDATE SET admin=true RETURNING id`,
    [email],
  );
  if (!rows.length) throw new Error('No verified account found for that email');
  console.log('Administrator access granted.');
} finally {
  await pool().end();
}
