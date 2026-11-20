import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { readFileSync } from 'node:fs';

const globalDb = globalThis as unknown as { pool?: Pool };
export function pool() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  return (globalDb.pool ??= new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    ...(process.env.PG_CA_FILE
      ? { ssl: { ca: readFileSync(process.env.PG_CA_FILE, 'utf8'), rejectUnauthorized: true } }
      : {}),
  }));
}
export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  args: unknown[] = [],
  client?: PoolClient,
): Promise<T[]> {
  return (await (client ?? pool()).query<T>(sql, args)).rows;
}
export async function transaction<T>(fn: (client: PoolClient) => Promise<T>) {
  const client = await pool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
export async function lockQuiz(id: string, client: PoolClient) {
  await query('SELECT id FROM quizzes WHERE id=$1 FOR UPDATE', [id], client);
}
