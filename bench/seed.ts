/**
 * Seeds `posts` with 1,000,000 rows. Skips the work when the table is already complete; pass
 * `--force` to rebuild it. The data is deterministic (fixed random seed): creation times are spread
 * over one year at one-second precision, so some rows share a timestamp and the `id` tie-breaker
 * matters, and they are unrelated to `id`, so physical order doesn't help either strategy.
 */
import { createDataSource, ROWS } from './shared.ts';

const force = process.argv.includes('--force');
const db = createDataSource();
await db.initialize();

const [{ exists }] = await db.query<[{ exists: boolean }]>(
  `SELECT to_regclass('posts') IS NOT NULL AS "exists"`,
);
const count = exists
  ? (await db.query<[{ n: number }]>('SELECT count(*)::int AS n FROM posts'))[0].n
  : 0;

if (count === ROWS && !force) {
  console.log(`posts already has ${ROWS.toLocaleString('en-US')} rows; use --force to reseed.`);
} else {
  const started = performance.now();
  await db.query('DROP TABLE IF EXISTS posts');
  await db.query(`
    CREATE TABLE posts (
      id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      author_id integer NOT NULL,
      title text NOT NULL,
      body text NOT NULL,
      created_at timestamptz(3) NOT NULL
    )`);
  // setseed and the INSERT must share a session, so run them in one transaction.
  await db.transaction(async (tx) => {
    await tx.query('SELECT setseed(0.42)');
    await tx.query(
      `INSERT INTO posts (author_id, title, body, created_at)
       SELECT 1 + floor(random() * 1000)::int,
              'Post ' || g,
              repeat(md5(g::text), 3),
              date_trunc('second', timestamptz '2025-01-01 00:00:00+00' + random() * interval '365 days')
       FROM generate_series(1, $1::int) AS g`,
      [ROWS],
    );
  });
  await db.query('VACUUM ANALYZE posts');
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  console.log(`Seeded ${ROWS.toLocaleString('en-US')} rows in ${seconds} s.`);
}

await db.destroy();
