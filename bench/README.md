# Benchmarks

Compares `OFFSET` and keyset pagination on a 1,000,000-row PostgreSQL table at page depths 1, 100,
1,000 and 10,000. Results are in [RESULTS.md](RESULTS.md), and the latency tables are copied into
the main README. Both files are written by the script, never edited by hand.

## Run

Requires Docker and Node 22.18 or later (the scripts run with Node's built-in TypeScript support).

```sh
pnpm bench        # build keyset-kit, start PostgreSQL, seed once, measure, write the results
pnpm bench:down   # stop PostgreSQL and delete its data
```

A full run takes a few minutes. `BENCH_ITERATIONS=10 node bench/run.ts --dry` prints a quick run
and the query plans without writing any files.

## Method

- **Data** ([seed.ts](seed.ts)): `posts(id, author_id, title, body, created_at timestamptz(3))`,
  1,000,000 rows from a fixed random seed. Creation times are spread over a year at one-second
  precision, so some rows share a timestamp and the `id` tie-breaker matters. They are unrelated
  to `id`, so the physical row order doesn't favour either strategy.
- **Query** ([run.ts](run.ts)): newest first (`ORDER BY created_at DESC, id DESC`), 20 rows per
  page plus one extra row to detect a next page, all columns. Page _n_ skips `(n - 1) × 20` rows.
- **Strategies**: both go through TypeORM. OFFSET uses `.offset().limit()`; keyset uses
  `paginateQueryBuilder` from the built `keyset-kit/typeorm`, with the cursor of the last row of
  the previous page (as a client would send it).
- **Scenarios**: once with only the primary key, once with a composite index on
  `(created_at DESC, id DESC)` that matches the sort.
- **Timing**: 5 warm-up runs, then 50 timed runs per strategy and depth (alternating which strategy
  goes first). Times are end-to-end from Node.js, so they include the round trip to the container
  and TypeORM's row mapping. The tables report the median and the 95th percentile.
- **Correctness check**: before timing, each depth asserts that both strategies return the same
  20 rows.
- **Plans**: the deepest page is run under `EXPLAIN (ANALYZE, BUFFERS)` with the exact SQL and
  parameters each strategy sent, captured from TypeORM's logger.

Only forward paging on a descending sort is measured, the common "newest first" feed. Ascending
sorts with PostgreSQL's default null order, and backwards paging, currently need an `IS NULL`
branch that keeps the query from being an index range (see "Sorting & nulls" in the docs).

PostgreSQL runs with default settings except `shared_buffers=512MB`, so the table stays in memory
and the results reflect query plans rather than disk speed. Absolute numbers depend on the machine;
the shape of the curves is what carries over.
