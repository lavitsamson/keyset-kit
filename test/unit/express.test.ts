import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { keysetParams, setLinkHeader, type KeysetParamsConfig } from '../../src/express/index.js';
import { encodeCursor, type SortField } from '../../src/index.js';
import { buildPage } from '../../src/core/page.js';
import { paginateMemory } from './helpers/memory.js';

interface Post {
  id: number;
  title: string;
  createdAt: Date;
  score: number | null;
}

const defaultSort: SortField<Post>[] = [
  { field: 'createdAt', direction: 'desc' },
  { field: 'id', direction: 'asc' },
];
const config: KeysetParamsConfig<Post> = {
  allowedSort: ['createdAt', 'title', 'score', 'id'],
  defaultSort,
  maxLimit: 50,
};
const secret = 'express-secret';

const posts: Post[] = Array.from({ length: 23 }, (_, i) => ({
  id: i + 1,
  title: `post ${String(i % 5)}`,
  createdAt: new Date(Date.UTC(2026, 0, 1 + (i % 7))),
  score: i % 4 === 0 ? null : i,
}));

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.get('/echo', keysetParams(config), (req, res) => {
    res.json(req.keyset);
  });
  app.get(
    '/nulls',
    keysetParams<Post>({
      allowedSort: ['score'],
      defaultSort: [
        { field: 'score', direction: 'asc', nulls: 'first', nullable: false },
        { field: 'id', direction: 'asc' },
      ],
    }),
    (req, res) => {
      res.json(req.keyset.sort);
    },
  );
  app.get('/signed', keysetParams({ ...config, secret }), (req, res) => {
    res.json({ secret: req.keyset.secret });
  });
  const router = express.Router();
  router.get('/posts', keysetParams({ ...config, secret }), (req, res) => {
    const page = paginateMemory(posts, req.keyset);
    setLinkHeader(res, req, page.pageInfo);
    res.json({ ids: page.data.map((p) => p.id), pageInfo: page.pageInfo });
  });
  app.use('/api', router);
  app.get('/existing-link', (req, res) => {
    res.append('Link', '</docs>; rel="help"');
    setLinkHeader(res, req, {
      hasNextPage: true,
      hasPreviousPage: false,
      startCursor: 'start',
      endCursor: 'end',
    });
    res.end();
  });
  app.get('/no-pages', (req, res) => {
    setLinkHeader(res, req, {
      hasNextPage: false,
      hasPreviousPage: false,
      startCursor: 's',
      endCursor: 'e',
    });
    res.end();
  });

  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  server.close();
  await once(server, 'close');
});

const get = (path: string) => fetch(base + path);
async function problem(path: string) {
  const res = await get(path);
  expect(res.status).toBe(400);
  expect(res.headers.get('content-type')).toMatch(/^application\/problem\+json/);
  return (await res.json()) as {
    type: string;
    title: string;
    status: number;
    detail: string;
    errors: { parameter: string; detail: string }[];
  };
}

describe('keysetParams', () => {
  it('uses the default sort and leaves limit to the paginator when no parameters are given', async () => {
    expect(await (await get('/echo')).json()).toEqual({
      // Passed on as declared; each adapter fills in its database's default null order.
      sort: [
        { field: 'createdAt', direction: 'desc' },
        { field: 'id', direction: 'asc' },
      ],
      maxLimit: 50,
      after: null,
      before: null,
    });
  });

  it('parses limit and a client sort, appending the tie-breaker', async () => {
    const body = (await (await get('/echo?limit=10&sort=-createdAt,+title')).json()) as {
      limit: number;
      sort: SortField<Post>[];
    };
    expect(body.limit).toBe(10);
    expect(body.sort).toEqual([
      { field: 'createdAt', direction: 'desc' },
      { field: 'title', direction: 'asc' },
      { field: 'id', direction: 'asc' },
    ]);
  });

  it('drops fields after the tie-breaker, since they cannot affect the order', async () => {
    const body = (await (await get('/echo?sort=-id,title')).json()) as { sort: SortField<Post>[] };
    expect(body.sort).toEqual([{ field: 'id', direction: 'desc' }]);
  });

  it('applies nulls and nullable configured in defaultSort to client-chosen fields', async () => {
    expect(await (await get('/nulls?sort=-score')).json()).toEqual([
      { field: 'score', direction: 'desc', nulls: 'first', nullable: false },
      { field: 'id', direction: 'asc' },
    ]);
  });

  it('passes the configured secret on in req.keyset', async () => {
    expect(await (await get('/signed')).json()).toEqual({ secret });
  });

  it.each([['0'], ['-1'], ['abc'], ['1.5'], ['99999999999999999999'], ['']])(
    'rejects limit=%s with a Problem Details response',
    async (limit) => {
      const body = await problem(`/echo?limit=${limit}`);
      expect(body).toMatchObject({ type: 'about:blank', title: 'Bad Request', status: 400 });
      expect(body.errors).toEqual([
        { parameter: 'limit', detail: '`limit` must be a positive integer.' },
      ]);
    },
  );

  it('rejects repeated parameters', async () => {
    const body = await problem('/echo?limit=1&limit=2');
    expect(body.errors).toEqual([
      { parameter: 'limit', detail: '`limit` must be given at most once.' },
    ]);
  });

  it('rejects disallowed, duplicate and empty sort fields, listing what is allowed', async () => {
    const body = await problem('/echo?sort=password,title,title,');
    expect(body.errors.map((e) => e.detail)).toEqual([
      'Cannot sort by "password". Allowed: createdAt, title, score, id.',
      '"title" appears more than once in `sort`.',
      '`sort` contains an empty field.',
    ]);
  });

  it('reports every problem at once', async () => {
    const body = await problem('/echo?limit=x&after=a&before=b&sort=nope');
    expect(body.errors.map((e) => e.parameter)).toEqual(['limit', 'before', 'sort']);
    expect(body.detail).toMatch(/^Invalid pagination parameters: /);
  });

  it('rejects malformed, tampered and wrong-sort cursors', async () => {
    const garbage = await problem('/echo?after=not-a-cursor!');
    expect(garbage.errors[0]).toMatchObject({ parameter: 'after' });

    const unsigned = encodeCursor(
      { createdAt: new Date(0), id: 1 },
      {
        sort: [
          { field: 'createdAt', direction: 'desc' },
          { field: 'id', direction: 'asc' },
        ],
      },
    );
    const tampered = await problem(`/api/posts?before=${unsigned}`);
    expect(tampered.errors[0]).toMatchObject({ parameter: 'before' });
    expect(tampered.errors[0]?.detail).toMatch(/not signed/);

    const wrongSort = await problem(`/echo?sort=title&after=${unsigned}`);
    expect(wrongSort.errors[0]?.detail).toMatch(/different sort order/);
  });

  it('accepts a valid cursor for the active sort', async () => {
    const cursor = encodeCursor(
      { createdAt: new Date(0), id: 1 },
      {
        sort: [
          { field: 'createdAt', direction: 'desc' },
          { field: 'id', direction: 'asc' },
        ],
      },
    );
    const res = await get(`/echo?after=${cursor}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ after: cursor, before: null });
  });

  it('accepts cursors produced under a different database null order (e.g. MongoDB)', async () => {
    const rows = posts.map((p) => ({ ...p }));
    const mongoOrdered = buildPage(
      rows,
      { sort: defaultSort, limit: 3 },
      (row, field) => (row as Record<string, unknown>)[field] ?? null,
      'smallest',
    );
    const res = await get(`/echo?after=${mongoOrdered.pageInfo.endCursor ?? ''}`);
    expect(res.status).toBe(200);
  });

  it('validates its configuration up front', () => {
    expect(() => keysetParams<Post>({ allowedSort: ['id'], defaultSort: [] })).toThrow(
      /non-empty array/,
    );
    expect(() => keysetParams<Post>({ ...config, maxLimit: 0 })).toThrow(
      /`maxLimit` must be a positive integer/,
    );
  });
});

describe('setLinkHeader', () => {
  it('follows rel="next" through every page and back with rel="prev"', async () => {
    const forward: number[] = [];
    let path: string | null = '/api/posts?limit=5&sort=title';
    const linkOf = (res: Response, rel: string): string | null =>
      [...(res.headers.get('link') ?? '').matchAll(/<([^>]+)>; rel="([a-z]+)"/g)].find(
        (m) => m[2] === rel,
      )?.[1] ?? null;

    let lastResponse: Response | undefined;
    while (path !== null) {
      const res = await get(path);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ids: number[] };
      forward.push(...body.ids);
      lastResponse = res;
      path = linkOf(res, 'next');
      if (path !== null) {
        expect(path.startsWith('/api/posts?')).toBe(true); // relative, keeps the mount path
        expect(path).toContain('limit=5');
        expect(path).toContain('sort=title');
        expect(path).not.toContain('before=');
      }
    }

    const expected = [...posts]
      .sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : a.id - b.id))
      .map((p) => p.id);
    expect(forward).toEqual(expected);

    const prev = lastResponse ? linkOf(lastResponse, 'prev') : null;
    expect(prev).not.toBeNull();
    expect(prev).not.toContain('after=');
    const previous = (await (await get(prev ?? '')).json()) as { ids: number[] };
    expect(previous.ids).toEqual(expected.slice(15, 20));
  });

  it('appends to an existing Link header', async () => {
    const res = await get('/existing-link?limit=2');
    expect(res.headers.get('link')).toBe(
      '</docs>; rel="help", </existing-link?limit=2&after=end>; rel="next"',
    );
  });

  it('sets no header when there are no neighbouring pages', async () => {
    const res = await get('/no-pages');
    expect(res.headers.get('link')).toBeNull();
  });
});
