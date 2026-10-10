# keyset-kit

Tiny, type-safe keyset (cursor) pagination for Prisma, TypeORM, Mongoose and Express. Zero runtime dependencies.

<!-- Badges (CI, npm version, bundle size) are added once the GitHub repository and npm package are live. -->

> **Status:** pre-release, under active development. See [docs/PROGRESS.md](docs/PROGRESS.md).

## Why

`OFFSET` pagination gets slower the deeper you page, because the database still reads and throws
away every skipped row. It also returns duplicates or skips rows when data changes between
requests. Keyset pagination fixes both by continuing from the last row you saw, but getting
multi-column sorts, ties, nulls and tamper-proof cursors right is fiddly. `keyset-kit` handles
all of that in a few lines of code.

## Features

- **Correct under change**: no duplicates or skipped rows when data is inserted between requests.
- **Multi-column sorts** with per-field direction, ties broken by a unique field.
- **Null-aware ordering** (`nulls: 'first' | 'last'`), with PostgreSQL defaults.
- **Typed cursors**: Dates, bigints and decimals survive the round trip.
- **Tamper-proof cursors** (optional HMAC-SHA256 signing) that can't be reused under a different sort.
- **Forward and backward** pagination; `limit + 1` fetch, no count query.
- **Zero runtime dependencies**, fully typed: sort fields are checked against your model.

## Install

```sh
npm install keyset-kit
```

## Quick start

<!-- prettier-ignore -->
```ts
import { paginatePrisma } from 'keyset-kit/prisma';

app.get('/posts', async (req, res) => {
  const page = await paginatePrisma(prisma.post, { where: { published: true } }, {
    sort: [{ field: 'createdAt', direction: 'desc' }, { field: 'id', direction: 'asc' }],
    after: typeof req.query.after === 'string' ? req.query.after : null,
    secret: process.env.CURSOR_SECRET, // optional: sign cursors
  });
  res.json(page); // { data, pageInfo: { hasNextPage, endCursor, ... } }
});
```

The next request passes `?after=<endCursor>`. The sort must end with a unique column (here `id`).

## Entry points

| Import                | Purpose                                                 | Peer dependency  | Status  |
| --------------------- | ------------------------------------------------------- | ---------------- | ------- |
| `keyset-kit`          | Cursor encoding/signing, keyset condition AST, `toPage` | none             | ✅      |
| `keyset-kit/prisma`   | `paginatePrisma` (tested on PostgreSQL)                 | `@prisma/client` | ✅      |
| `keyset-kit/typeorm`  | `paginateQueryBuilder` (tested on PostgreSQL)           | `typeorm`        | ✅      |
| `keyset-kit/mongoose` | `paginateMongoose`                                      | `mongoose`       | planned |
| `keyset-kit/express`  | `keysetParams` middleware, `setLinkHeader`              | `express`        | planned |

## Development

Supports Node ≥ 22. Development uses Node 24 LTS (pinned in `.node-version`; [fnm](https://github.com/Schniz/fnm) picks it up automatically) and pnpm via Corepack (`corepack enable`; Corepack ships with Node 22 and 24).

```sh
pnpm install
pnpm generate        # Prisma client for the integration tests (needed before lint/typecheck)
pnpm lint            # ESLint + (pnpm format:check for Prettier)
pnpm typecheck
pnpm test            # unit + type tests
pnpm test:int        # integration tests on real databases (requires Docker)
pnpm test:coverage   # both, with coverage thresholds (requires Docker)
pnpm build           # tsup → dist/ (ESM + CJS + .d.ts)
pnpm check:package   # publint + are-the-types-wrong
pnpm size            # size-limit (core ≤ 3 kB min+gzip)
```

## Design decisions

- [ADR 0001: Build and language toolchain](docs/adr/0001-toolchain.md): why TypeScript 6 + tsup, Node ≥ 22, and pnpm's supply-chain guards.
- [ADR 0002: Cursor format, signing and ordering](docs/adr/0002-cursor-format-and-ordering.md): what's in a cursor, how signing and sort binding work, and how nulls and ties are ordered.
- [ADR 0003: Adapter design and the conformance suite](docs/adr/0003-adapter-design.md): one shared pipeline, structural ORM types, and a conformance suite every adapter must pass on a real database.

## Author

**Lavit Samson**, Senior Full-Stack Engineer · [linkedin.com/in/lavit-samson](https://linkedin.com/in/lavit-samson)

## License

[MIT](LICENSE)
