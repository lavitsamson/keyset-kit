/**
 * OFFSET vs keyset pagination on the 1M-row `posts` table (run `seed.ts` first).
 *
 * Both strategies go through TypeORM, newest first (`created_at DESC, id DESC`), 20 rows per page
 * plus one extra row to detect a next page. Keyset uses the built `keyset-kit/typeorm` adapter.
 * Each depth is measured without and with a composite index; the deepest page is also run under
 * `EXPLAIN (ANALYZE, BUFFERS)` using the exact SQL each strategy sent.
 *
 * Writes `bench/RESULTS.md` and the README's benchmark section, unless `--dry` is passed.
 * `BENCH_ITERATIONS` (default 50) sets the timed runs per strategy and depth.
 */
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import type { DataSource } from 'typeorm';
import { encodeCursor, type SortField } from 'keyset-kit';
import { paginateQueryBuilder } from 'keyset-kit/typeorm';
import { CapturingLogger, createDataSource, PostEntity, ROWS, type Post } from './shared.ts';

const DEPTHS = [1, 100, 1_000, 10_000];
const PAGE_SIZE = 20;
const ITERATIONS = Number(process.env['BENCH_ITERATIONS'] ?? 50);
const WARMUP = 5;
const INDEX = 'posts_created_at_id_idx';
const SORT = [
  { field: 'createdAt', direction: 'desc' },
  { field: 'id', direction: 'desc' },
] as const satisfies readonly SortField<Post>[];

const dry = process.argv.includes('--dry');
const resultsFile = new URL('RESULTS.md', import.meta.url);
const readmeFile = new URL('../README.md', import.meta.url);

interface Stats {
  median: number;
  p95: number;
}
interface Row {
  depth: number;
  offset: Stats;
  keyset: Stats;
}
interface Scenario {
  title: string;
  rows: Row[];
  explain: { offset: string; keyset: string };
}

const logger = new CapturingLogger();
const db = createDataSource(logger);
await db.initialize();
const repo = db.getRepository(PostEntity);

const [{ n: total }] = await db.query<[{ n: number }]>('SELECT count(*)::int AS n FROM posts');
if (total !== ROWS)
  throw new Error(`posts has ${String(total)} rows, expected ${String(ROWS)}. Run bench/seed.ts.`);

const offsetPage = (skip: number): Promise<Post[]> =>
  repo
    .createQueryBuilder('post')
    .orderBy('post.createdAt', 'DESC')
    .addOrderBy('post.id', 'DESC')
    .offset(skip)
    .limit(PAGE_SIZE + 1)
    .getMany();

const keysetPage = (after: string | null): Promise<Post[]> =>
  paginateQueryBuilder(repo.createQueryBuilder('post'), 'post', {
    sort: SORT,
    limit: PAGE_SIZE,
    after,
  }).then((page) => page.data);

/** Cursor pointing at the last row of the page before `depth` (the client would already hold it). */
async function cursorFor(depth: number): Promise<string | null> {
  if (depth === 1) return null;
  const [last] = await offsetPage((depth - 1) * PAGE_SIZE - 1);
  if (!last) throw new Error(`No row before page ${String(depth)}.`);
  return encodeCursor({ createdAt: last.createdAt, id: last.id }, { sort: SORT });
}

async function time(run: () => Promise<unknown>): Promise<number> {
  const started = performance.now();
  await run();
  return performance.now() - started;
}

function stats(samples: number[]): Stats {
  const sorted = samples.toSorted((a, b) => a - b);
  const at = (q: number): number =>
    sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)] ?? NaN;
  const mid = sorted.length / 2;
  const median =
    sorted.length % 2 === 0
      ? ((sorted[mid - 1] ?? NaN) + (sorted[mid] ?? NaN)) / 2
      : (sorted[Math.floor(mid)] ?? NaN);
  return { median, p95: at(0.95) };
}

async function explain(source: DataSource, run: () => Promise<unknown>): Promise<string> {
  const sent = await logger.capture(run);
  const plan = await source.query<{ 'QUERY PLAN': string }[]>(
    `EXPLAIN (ANALYZE, BUFFERS) ${sent.query}`,
    sent.parameters,
  );
  return `${sent.query}\n\n${plan.map((line) => line['QUERY PLAN']).join('\n')}`;
}

async function measure(title: string, withIndex: boolean): Promise<Scenario> {
  await db.query(`DROP INDEX IF EXISTS ${INDEX}`);
  if (withIndex) await db.query(`CREATE INDEX ${INDEX} ON posts (created_at DESC, id DESC)`);
  await db.query('ANALYZE posts');
  console.log(`\n${title}`);

  const rows: Row[] = [];
  for (const depth of DEPTHS) {
    const skip = (depth - 1) * PAGE_SIZE;
    const cursor = await cursorFor(depth);

    // Both strategies must return the same page, or the comparison is meaningless.
    const expected = (await offsetPage(skip)).slice(0, PAGE_SIZE).map((p) => p.id);
    const actual = (await keysetPage(cursor)).map((p) => p.id);
    if (expected.join() !== actual.join())
      throw new Error(`Page ${String(depth)} differs between strategies.`);

    for (let i = 0; i < WARMUP; i++) {
      await offsetPage(skip);
      await keysetPage(cursor);
    }
    const offsetSamples: number[] = [];
    const keysetSamples: number[] = [];
    for (let i = 0; i < ITERATIONS; i++) {
      // Alternate which strategy goes first so neither benefits from running second.
      if (i % 2 === 0) {
        offsetSamples.push(await time(() => offsetPage(skip)));
        keysetSamples.push(await time(() => keysetPage(cursor)));
      } else {
        keysetSamples.push(await time(() => keysetPage(cursor)));
        offsetSamples.push(await time(() => offsetPage(skip)));
      }
    }
    const row = { depth, offset: stats(offsetSamples), keyset: stats(keysetSamples) };
    rows.push(row);
    console.log(
      `  page ${String(depth).padStart(6)}  offset ${ms(row.offset.median).padStart(9)}  keyset ${ms(row.keyset.median).padStart(9)}`,
    );
  }

  const deepest = DEPTHS.at(-1) ?? 1;
  const cursor = await cursorFor(deepest);
  return {
    title,
    rows,
    explain: {
      offset: await explain(db, () => offsetPage((deepest - 1) * PAGE_SIZE)),
      keyset: await explain(db, () => keysetPage(cursor)),
    },
  };
}

function ms(value: number): string {
  return `${value < 10 ? value.toFixed(2) : value.toFixed(1)} ms`;
}

function table(rows: Row[]): string {
  const header = [
    '| Page | Rows skipped | OFFSET median | OFFSET p95 | Keyset median | Keyset p95 | Keyset speed-up |',
    '| ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];
  return [
    ...header,
    ...rows.map((r) =>
      [
        '',
        r.depth.toLocaleString('en-US'),
        ((r.depth - 1) * PAGE_SIZE).toLocaleString('en-US'),
        ms(r.offset.median),
        ms(r.offset.p95),
        ms(r.keyset.median),
        ms(r.keyset.p95),
        `${(r.offset.median / r.keyset.median).toFixed(1)}x`,
        '',
      ]
        .join(' | ')
        .trim(),
    ),
  ].join('\n');
}

function command(file: string, args: string[]): string {
  try {
    return execFileSync(file, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'unknown';
  }
}

async function typeormVersion(): Promise<string> {
  const manifest = new URL('../node_modules/typeorm/package.json', import.meta.url);
  return (JSON.parse(await readFile(manifest, 'utf8')) as { version: string }).version;
}

const cpus = os.cpus();
const cpu = `${cpus[0]?.model.trim() ?? 'unknown CPU'} (${String(cpus.length)} logical cores)`;

async function environment(): Promise<string> {
  const [{ version }] = await db.query<[{ version: string }]>('SELECT version()');
  const [{ size }] = await db.query<[{ size: string }]>(
    `SELECT pg_size_pretty(pg_total_relation_size('posts')) AS size`,
  );
  const docker = command('docker', [
    'info',
    '--format',
    '{{.ServerVersion}}, {{.NCPU}} CPUs, {{.MemTotal}}',
  ]);
  const [dockerVersion = docker, dockerCpus = '', dockerMem = ''] = docker.split(', ');
  const dockerMemory =
    Number.isFinite(Number(dockerMem)) && dockerMem !== ''
      ? `${(Number(dockerMem) / 1024 ** 3).toFixed(1)} GB`
      : dockerMem;
  return [
    `- Run on ${new Date().toISOString().slice(0, 10)}, ${String(ITERATIONS)} timed runs per cell after ${String(WARMUP)} warm-up runs`,
    `- CPU: ${cpu}`,
    `- Memory: ${(os.totalmem() / 1024 ** 3).toFixed(1)} GB`,
    `- OS: ${os.version()} (${os.platform()} ${os.release()})`,
    `- Docker ${dockerVersion}${dockerCpus ? ` (VM: ${dockerCpus}, ${dockerMemory})` : ''}`,
    `- ${version.split(' on ')[0] ?? version} (\`postgres:18.6-alpine\`, \`shared_buffers=512MB\`, other settings default)`,
    `- Node.js ${process.version}, TypeORM ${await typeormVersion()}`,
    `- Table: ${ROWS.toLocaleString('en-US')} rows, ${size} including indexes`,
  ].join('\n');
}

const scenarios = [
  await measure('Without an index on the sort columns (primary key only)', false),
  await measure('With a composite index on (created_at DESC, id DESC)', true),
];
const env = await environment();
await db.destroy();

if (dry) {
  for (const s of scenarios)
    console.log(`\n${s.title}\n\n${s.explain.offset}\n\n${s.explain.keyset}`);
  process.exit(0);
}

const summary = scenarios.map((s) => `### ${s.title}\n\n${table(s.rows)}`).join('\n\n');
const results = `# Benchmark results

Generated by \`pnpm bench\` (see [bench/README.md](README.md)). Do not edit by hand.

OFFSET vs keyset pagination on a ${ROWS.toLocaleString('en-US')}-row PostgreSQL table, newest first
(\`ORDER BY created_at DESC, id DESC\`), ${String(PAGE_SIZE)} rows per page. Both strategies run
through TypeORM; keyset uses \`paginateQueryBuilder\` from \`keyset-kit/typeorm\`. Times are
end-to-end from Node.js, including the network round trip to the database container and
TypeORM's row mapping.

## Environment

${env}

## Latency

${summary}

## Query plans at page ${(DEPTHS.at(-1) ?? 1).toLocaleString('en-US')}

${scenarios
  .map(
    (s) => `### ${s.title}

OFFSET:

\`\`\`text
${s.explain.offset}
\`\`\`

Keyset:

\`\`\`text
${s.explain.keyset}
\`\`\``,
  )
  .join('\n\n')}
`;

const prettierConfig = { ...(await resolveConfig(fileURLToPath(resultsFile))), parser: 'markdown' };
await writeFile(resultsFile, await format(results, prettierConfig));

const readme = await readFile(readmeFile, 'utf8');
const start = '<!-- bench:start -->';
const end = '<!-- bench:end -->';
const from = readme.indexOf(start);
const to = readme.indexOf(end);
if (from === -1 || to === -1) throw new Error(`README.md needs ${start} and ${end} markers.`);
const section = `${start}\n\n${scenarios
  .map((s) => `**${s.title}**\n\n${table(s.rows)}`)
  .join(
    '\n\n',
  )}\n\nMeasured on ${cpu} with Docker; full environment and \`EXPLAIN ANALYZE\` output in [bench/RESULTS.md](bench/RESULTS.md).\n\n`;
await writeFile(
  readmeFile,
  await format(readme.slice(0, from) + section + readme.slice(to), { ...prettierConfig }),
);
console.log('\nWrote bench/RESULTS.md and the README benchmark section.');
