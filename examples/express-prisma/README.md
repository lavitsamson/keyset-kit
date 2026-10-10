# Example: Express + Prisma + PostgreSQL

`GET /posts` with keyset pagination, signed cursors, `?sort=` and `Link` headers.

## Run

From the repository root (requires Docker):

```sh
pnpm install
pnpm example:express-prisma
```

Then open <http://localhost:3000/posts?limit=5> and follow the `Link` header (or
`pageInfo.endCursor` as `?after=`). Try `?sort=-score` or an invalid `?sort=password` to see the
400 Problem Details response.

Environment variables: `DATABASE_URL`, `PORT`, `CURSOR_SECRET` (see `src/config.ts`).

## Files

- `src/app.ts`: the route, using `keysetParams`, `paginatePrisma` and `setLinkHeader`.
- `prisma/schema.prisma`: the model, with an index matching the default sort.
- `src/seed.ts`: creates the table and 200 posts (10 per timestamp, so ties occur).
