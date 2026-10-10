# Example: NestJS + TypeORM + PostgreSQL

`GET /posts` in a NestJS controller. `keysetParams` is applied as Nest middleware, the service
paginates a TypeORM query builder, and the controller sets the `Link` header.

## Run

From the repository root (requires Docker):

```sh
pnpm install
pnpm example:nestjs-typeorm
```

Then open <http://localhost:3000/posts?limit=5> and follow the `Link` header.

Environment variables: `DATABASE_URL`, `PORT`, `CURSOR_SECRET` (see `src/config.ts`).

## Files

- `src/app.module.ts`: registers `keysetParams` for the posts routes.
- `src/posts.service.ts`: `paginateQueryBuilder(qb, 'post', keyset)`.
- `src/posts.controller.ts`: returns the page and sets the `Link` header.
