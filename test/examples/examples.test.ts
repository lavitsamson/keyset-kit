// Smoke tests for examples/: build each app, seed it against a real database, start it as a child
// process and page through GET /posts over HTTP. Run after `pnpm build` (the examples import the
// built package).
import { execFileSync, execSync, spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer, type AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POSTGRES_IMAGE } from '../integration/postgres.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
// Same image as the Mongoose integration tests (MongoDB 8.x can't start on CI's kernel, see #2).
const MONGO_IMAGE = 'mongo:7.0.43';
const SEEDED = 200;

interface Post {
  id?: number;
  _id?: string;
  title: string;
  createdAt: string;
  score?: number | null;
}

let postgres: StartedPostgreSqlContainer;
let mongo: StartedMongoDBContainer;

beforeAll(async () => {
  [postgres, mongo] = await Promise.all([
    new PostgreSqlContainer(POSTGRES_IMAGE).start(),
    new MongoDBContainer(MONGO_IMAGE).start(),
  ]);
});

afterAll(async () => {
  await Promise.all([postgres.stop(), mongo.stop()]);
});

async function freePort(): Promise<number> {
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  server.close();
  await once(server, 'close');
  return port;
}

/** Builds, seeds and starts an example; resolves once it logs that it is listening. */
async function startExample(
  name: string,
  env: Record<string, string>,
): Promise<{ base: string; stop: () => void }> {
  const cwd = `${ROOT}examples/${name}`;
  const port = await freePort();
  const fullEnv = { ...process.env, ...env, PORT: String(port), CURSOR_SECRET: 'smoke-test' };

  execSync(`pnpm --filter @examples/${name} build`, { cwd: ROOT, stdio: 'pipe' });
  execFileSync(process.execPath, ['dist/seed.js'], { cwd, env: fullEnv, stdio: 'pipe' });

  const child: ChildProcess = spawn(process.execPath, ['dist/main.js'], { cwd, env: fullEnv });
  let output = '';
  await new Promise<void>((resolve, reject) => {
    const onData = (chunk: Buffer): void => {
      output += chunk.toString();
      if (output.includes('listening on')) resolve();
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.once('exit', (code) => {
      reject(new Error(`${name} exited with code ${String(code)}:\n${output}`));
    });
  });
  return { base: `http://127.0.0.1:${String(port)}`, stop: () => child.kill() };
}

const nextLink = (res: Response): string | null =>
  [...(res.headers.get('link') ?? '').matchAll(/<([^>]+)>; rel="([a-z]+)"/g)].find(
    (m) => m[2] === 'next',
  )?.[1] ?? null;

/** Follows rel="next" links from `path` to the last page. */
async function walk(base: string, path: string): Promise<Post[]> {
  const posts: Post[] = [];
  let next: string | null = path;
  for (let pages = 0; next !== null; pages++) {
    if (pages > 100) throw new Error('too many pages');
    const res = await fetch(base + next);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Post[] };
    posts.push(...body.data);
    next = nextLink(res);
  }
  return posts;
}

function expectNewestFirst(posts: Post[], key: (p: Post) => string | number): void {
  expect(posts).toHaveLength(SEEDED);
  expect(new Set(posts.map(key)).size).toBe(SEEDED);
  for (const [i, post] of posts.entries()) {
    const previous = posts[i - 1];
    if (!previous) continue;
    const order = Date.parse(previous.createdAt) - Date.parse(post.createdAt);
    expect(order).toBeGreaterThanOrEqual(0);
    if (order === 0) expect(key(previous) < key(post)).toBe(true); // tie-breaker ascending
  }
}

async function expectBadRequest(base: string): Promise<void> {
  const res = await fetch(`${base}/posts?sort=password`);
  expect(res.status).toBe(400);
  expect(res.headers.get('content-type')).toMatch(/^application\/problem\+json/);
}

const examples = [
  {
    name: 'express-prisma',
    env: (): Record<string, string> => ({ DATABASE_URL: postgres.getConnectionUri() }),
    key: (p: Post): string | number => p.id ?? -1,
  },
  {
    name: 'nestjs-typeorm',
    env: (): Record<string, string> => ({ DATABASE_URL: postgres.getConnectionUri() }),
    key: (p: Post): string | number => p.id ?? -1,
  },
  {
    name: 'express-mongoose',
    env: (): Record<string, string> => ({
      MONGODB_URL: `${mongo.getConnectionString()}/keyset?directConnection=true`,
    }),
    key: (p: Post): string | number => p._id ?? '',
  },
];

describe.each(examples)('examples/$name', ({ name, env, key }) => {
  let app: { base: string; stop: () => void };

  beforeAll(async () => {
    app = await startExample(name, env());
  });

  afterAll(() => {
    app.stop();
  });

  it('pages through every post via the Link header, newest first', async () => {
    expectNewestFirst(await walk(app.base, '/posts?limit=30'), key);
  });

  it('supports a client-chosen sort', async () => {
    const posts = await walk(app.base, '/posts?limit=40&sort=-score');
    expect(new Set(posts.map(key)).size).toBe(SEEDED);
  });

  it('answers invalid input with Problem Details', async () => {
    await expectBadRequest(app.base);
  });
});
