# Getting started

## Install

```sh
npm install keyset-kit
```

`keyset-kit` has no runtime dependencies. Each adapter is a separate entry point that works with
the ORM you already have installed:

| Import                | Use it with                  | Supported versions |
| --------------------- | ---------------------------- | ------------------ |
| `keyset-kit`          | anything (core helpers)      | Node.js ≥ 22       |
| `keyset-kit/prisma`   | Prisma model delegates       | Prisma 6, 7        |
| `keyset-kit/typeorm`  | TypeORM `SelectQueryBuilder` | TypeORM 1          |
| `keyset-kit/mongoose` | Mongoose queries             | Mongoose 9         |
| `keyset-kit/express`  | Express routes (middleware)  | Express 5          |

## A paginated endpoint in ten lines

```ts
import { keysetParams, setLinkHeader } from 'keyset-kit/express';
import { paginatePrisma } from 'keyset-kit/prisma';

app.get(
  '/posts',
  keysetParams<Post>({
    allowedSort: ['createdAt', 'title'],
    defaultSort: [
      { field: 'createdAt', direction: 'desc' },
      { field: 'id', direction: 'asc' },
    ],
    secret: process.env.CURSOR_SECRET,
  }),
  async (req, res) => {
    const page = await paginatePrisma(prisma.post, { where: { published: true } }, req.keyset);
    setLinkHeader(res, req, page.pageInfo);
    res.json(page);
  },
);
```

A response looks like this:

```json
{
  "data": [{ "id": 42, "title": "…", "createdAt": "2026-01-03T10:00:00.000Z" }],
  "pageInfo": {
    "hasNextPage": true,
    "hasPreviousPage": false,
    "startCursor": "WzEsIjFxNm…",
    "endCursor": "WzEsIjFxNm…"
  }
}
```

The client asks for the next page with `?after=<endCursor>` (or follows the `Link` header), the
previous page with `?before=<startCursor>`, and can pass `?limit=` and `?sort=-createdAt,title`.

## The one rule: end with a unique field

Keyset pagination needs a **total order**: no two rows may compare equal. Always end the sort with
a unique, non-null column such as `id` (or `_id` in MongoDB). With the Express middleware, the last
field of `defaultSort` is appended to every client-chosen sort automatically. If two rows ever
share the last field, `keyset-kit` throws an error that tells you so.

## Without an adapter

The core works with any data source. Use `toPage` with rows you fetched yourself:

```ts
import { toPage } from 'keyset-kit';

const page = toPage(rows, { sort, limit: 20, after: req.query.after });
```

You fetch `limit + 1` rows in sort order (filtered with `buildKeysetCondition`); `toPage` trims the
extra row and builds the cursors. The adapters do exactly this for you.

## Runnable examples

The repository has three complete apps, each started with one command (Docker required):

- `examples/express-prisma`: Express + Prisma + PostgreSQL
- `examples/express-mongoose`: Express + Mongoose + MongoDB
- `examples/nestjs-typeorm`: NestJS + TypeORM + PostgreSQL
