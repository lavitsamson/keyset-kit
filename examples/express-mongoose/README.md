# Example: Express + Mongoose + MongoDB

`GET /posts` with keyset pagination over a lean Mongoose query, using `_id` as the tie-breaker.

## Run

From the repository root (requires Docker):

```sh
pnpm install
pnpm example:express-mongoose
```

Then open <http://localhost:3000/posts?limit=5> and follow the `Link` header. Try `?sort=score`:
posts without a score come first, because MongoDB sorts missing fields like `null`, smallest.

Environment variables: `MONGODB_URL`, `PORT`, `CURSOR_SECRET` (see `src/config.ts`).
